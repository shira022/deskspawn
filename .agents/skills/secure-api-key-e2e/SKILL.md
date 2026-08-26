---
name: secure-api-key-e2e
version: 1.0.0
category: testing
tags: [e2e, api-key, security, leakage, deskpawn]
description: >
  DeskSpawn デスクトップ版の実API E2E（実際のプロバイダーに接続して
  チャット応答・プレビュー生成・チェックポイント保存まで検証）を
  セキュアに実行する手順。実APIキーの漏洩対策・自己責任・後始末を
  チェックリスト化する（ADR-015 準拠）。
metadata:
  version: "1.0.0"
  depends_on: [test-policy]
---

# Secure API-Key E2E

## 役割

> **English:** Safely run the real-API desktop E2E (chat response → preview →
> checkpoints) without leaking the real API key. Follows ADR-015.
>
> 実APIキーを使って DeskSpawn の実生成フローを検証する際の
> セキュリティ手順。キーの漏洩・コスト・後始末を開発者自己責任で
> 厳格に管理する。

## 前提（自己責任の明文化）

- 実API E2E（`DESKSPAWN_E2E_REAL=1`）は**開発者自己責任**。
- OS キーチェーンに API キーを保存する前提（本番と同じ経路）。
  保存も削除も開発者に委ねる。
- コスト・漏洩リスクも開発者責任。**CI では絶対に実API 不可**（ダミーのみ）。
- レート制限・低割当キーを推奨。本番キーは使わない。

## ステップ

### 1. 準備（漏洩対策）

```bash
cd <deskspawn-repo>
cp .env.example .env        # gitignore 済み・コミットされない
# .env に設定:
#   DESKSPAWN_E2E_REAL=1
#   DESKSPAWN_API_KEY=<key>
#   DESKSPAWN_E2E_PROVIDER=custom
#   DESKSPAWN_E2E_ENDPOINT=<endpoint>
#   DESKSPAWN_E2E_MODEL=<model>
#   DESKSPAWN_TEST_RESET=1   # E2E が実データ削除するためのガード
#   DESKSPAWN_KEYCHAIN_SERVICE=com.deskspawn.e2e   # E2E は必須（実APIでも実キーはテスト専用キーチェーンへ）
set -a; source .env; set +a   # シェル履歴に残さず読み込む
```

注意:
- キーをシェルに直接打たない（履歴に残る）。
- `.env` は gitignore 済みだが、誤ってステージしないよう `git status` で確認。
- **アプリを `DESKSPAWN_KEYCHAIN_SERVICE=com.deskspawn.e2e` 付きで起動してから** Playwright を実行する
  （beforeAll ガードが keyring service を検証・違反は abort。実APIモードでも実キーは
  テスト専用キーチェーンに保存され、本番 com.deskspawn は汚れない）。

### 2. 実行

```bash
pnpm test:e2e:real
# = playwright test e2e/desktop.spec.ts && node scripts/clean-test-results.mjs
```

`test:e2e:real` は:
- **desktop.spec.ts 限定**（web.spec.ts は CDP 不要で失敗するため）
- 実行後に **test-results/・playwright-report/ を自動削除**（漏洩対策）

`playwright.config.ts` は `DESKSPAWN_E2E_REAL=1` 時 **trace を自動オフ**（キー/プロンプトが trace.zip に残らない）。

### 3. 実アプリ生成のフル動作検証（開発者エージェント向け）

E2E は hello 応答まで（プロバイダー疎通）だが、**実アプリの生成 → プレビュー → チェックポイント**は
以下のスクリプトで検証する。**開発者の明示依頼時のみ実行**すること。

```bash
# デフォルト: ToDo アプリを作成（固定）
node scripts/verify-generate-app.mjs

# プロンプトを指定（開発者の要望に応じて変更可能）
node scripts/verify-generate-app.mjs "予定管理アプリを作成"

# 検証後に生成アプリを自動クリーンアップ（registry + ディレクトリ削除）
node scripts/verify-generate-app.mjs --cleanup
```

出力（JSON）:
```json
{
  "ok": true, "appId": "app-xxx", "appName": "Verify-123456",
  "prompt": "ToDoアプリを作成して",
  "aiResponded": true, "codeGenerated": true,
  "checkpoints": 1, "previewRendered": true, "elapsedMs": 50000
}
```

- **実行前にアプリを1インスタンスで起動**すること（多重起動はプレビュー競合で
  「Project has no package.json」の誤エラーになる — 実績 2026-08-21）
- 生成には数分・実コストがかかる。モデル応答が不安定な場合は再実行する。

### 4. 後始末（開発者責任）

1. **キーチェーンから実キーを削除**する:
   - Windows: コントロールパネル → 資格情報マネージャー → Windows 資格情報 → **`com.deskspawn.e2e`** エントリを削除
     （E2E は必ずテスト専用キーチェーンに保存される。本番 `com.deskspawn` には無い）
   - または app の AI 設定でキーを削除
2. **生成されたテストアプリ**を削除（registry + ディレクトリ）or ダミーモードの E2E でリセット。
3. `test-results/`・`playwright-report/` が無いことを確認（クリーンスクリプト clean-test-results.mjs が自動クリーン済み）。
4. `.env` からキーを取り除く（不要なら .env 自体を削除）。

### 5. 検証（寄生キーの監査）

```bash
# リポジトリ内に実キー形式が残っていないか
grep -rnE 'sk-(proj|ant|test)|AIza[0-9A-Za-z_-]{30,}|gsk_' e2e/ scripts/ docs/ .env.example
# git ステージングに .env が混ざってないか
git status --short | grep -i '\.env'
```

## Pitfalls

- `pnpm test:e2e`（real でない方）は web.spec.ts も実行し、CDP サーバー不在で失敗する → **実API は必ず `pnpm test:e2e:real`**。
- credentials.json（file フォールバック）は**ユーザープロファイル内のみ**保存。プロファイル外は拒否（ADR-015）。
- trace が `retain-on-failure` のままだと失敗時にキー/プロンプトが残る → 実API 時は config が自動オフにするが、手動実行する場合は `--trace off` を付ける。
- **多重起動禁止**: deskspawn-desktop を2つ以上起動すると、プレビュー（サイドカー）が競合し
  「Project has no package.json」等の誤エラーになる。必ず `Get-Process deskspawn-desktop` で
  1つのみ確認してから実行（実績 2026-08-21）。
- **プレビュー起動タイミング**: 生成中（package.json 未生成）にプレビュー boot が失敗しても、
  PreviewPanel は生成完了後に**自動再試行**する（2026-08-21 修正）。それでもエラーが残る場合は
  アプリ再起動 or プレビュー再試行ボタン。
- **実API の応答は不安定**: モデルによって応答なし/長遅延がある（レート制限・一時不調）。
  スクリプトがタイムアウトしたら再実行する（実コストは発生）。

## クリーンアップ（検証完了の定義に含める）

実API検証は **生成 → 確認 → 適切な後始末**までが完了（2026-08-21 ユーザー要件として確定）。
生成アプリが実データに残ったままは「未完了」扱い。

- `verify-generate-app.mjs --cleanup` で生成アプリを自動削除（sidecar `/api/preview/stop` → `delete_app` IPC の順・プレビューがファイルをロックするため）。
- 手動検証が溜まったら **apps.json の registry と `apps/app-*` ディレクトリを突き合わせて残骸を確認**:
  - registry に無い**孤立ディレクトリ**は UI から消せない → 直接削除。
  - config.json の `currentApp` も None にリセット（`delete_app` は 2026-08-21 から削除対象が currentApp の場合自動クリアするよう修正済みだが、手動削除分は手で直す）。
- プレビュープロセス（bun/node/vite）が node_modules をロックし remove が失敗する → 先に停止。
- 削除前に apps.json・config.json のバックアップを /tmp に取る。

## キーチェーン分離（テスト専用 service を推奨）

- 実API E2E は `DESKSPAWN_KEYCHAIN_SERVICE=com.deskspawn.e2e` で起動し、**テスト専用キーチェーン**に保存する（2026-08-21 ユーザー合意）。
  - 本番キーチェーン（com.deskspawn）を汚さず、既存の実キーを上書きしない。
  - アプリの保存挙動は service 名が違うだけなので実使用検証として十分。
  - 実キーの保存・削除は開発者に委ねる（ADR-015）。テスト後は `com.deskspawn.e2e` のキーチェーンエントリ削除を案内。
- E2E beforeAll で `get_keyring_service()` を invoke し `com.deskspawn.e2e` でなければ**テスト全体を中止**（ガード・実API モードも本番 service は許可しない）。

## プロバイダー別の .env（エンドポイント要否）

| プロバイダー | endpoint | 備考 |
|---|---|---|
| openai / anthropic | ❌ 不要 | provider + api_key + model のみ |
| custom / azure-openai / ollama | ✅ 必須 | ollama は api_key 不要 |
| amazon-bedrock | ❌ 不要 | **region** 必須 |

## 参照

- `docs/adr/015-real-api-e2e-self-responsibility.md`
- `docs/user-flow-spec.md` — Real-API E2E 節
- `test-policy` スキル — シークレット・セキュリティ原則
- `CONTRIBUTING.md` — E2E modes
