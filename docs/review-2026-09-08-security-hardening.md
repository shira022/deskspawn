# DeskSpawn 包括的レビュー結果 — fix/security-hardening-2026-08

**レビュー日**: 2026-09-08
**レビュー方法**: 5並列エージェント（sidecar SSRF/Auth/CORS / Rust セキュリティ層 / Frontend/CSP / 機能要件 / 非機能要件）+ 手動検証（pnpm audit, テスト実行, CSP確認, FIXME調査）

**全テスト結果**: 33ファイル571件 PASS（vitest）+ 9ファイル68件 PASS（vitest.ui.config）
**pnpm audit**: 2 moderate（qs via express 5.2.1）

---

## 🔴 HIGH — 即座に修正が必要

### 1. iframe sandbox が事実上無効化されている
**ファイル**: `packages/shared/src/components/preview/PreviewPanel.tsx:610`
**問題**: `sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"` に `allow-same-origin` が含まれている。`allow-scripts` + `allow-same-origin` の組み合わせは iframe sandbox 自体を無効化する（CWE-250）。生成されたアプリは親オリジン（`tauri://localhost`）として振る舞え、`window.parent.document` やローカルストレージにアクセス可能。
**修正**: `allow-same-origin` を削除。`allow-scripts` のみに限定。`allow-popups` は必要なら維持。127.0.0.1 上の dev server は別オリジンなので same-origin なしでも動作する。動作確認必須。

### 2. SSRF フォールバックで正規化がバイパスされる
**ファイル**: `apps/desktop/sidecar/src/server.ts:1595-1602`
**問題**: `storedCustomEndpoint = check.url ?? customEndpoint` — validateUpstreamUrl の結果が falsy でも raw customEndpoint が代入される。さらに `.trim()` 比較は生文字列同士で、正規化済みの既存値が未正規化値で上書きされるリスク。
**修正**:
```typescript
const check = validateUpstreamUrl(customEndpoint);
if (!check.ok) {
  res.status(400).json({ error: check.error, errorCode: 'INVALID_ENDPOINT' });
  return;
}
if (storedCustomEndpoint === check.url) return; // normalize済み同士で比較
storedCustomEndpoint = check.url!;
```

### 3. GET /projects/file のパストラバーサル
**ファイル**: `apps/desktop/sidecar/src/server.ts:1444-1452`
**問題**: `req.query.path` を appIdLike 検証なしで executors.readFile に渡す。Rust 側に委譲しているが、サイドカー側の最終防御が欠落。
**修正**: readFile 呼び出し前にパストラバーサル検証を追加:
```typescript
const resolved = path.resolve(filePath);
const root = path.resolve(executors.getWorkspaceDir());
if (!resolved.startsWith(root + path.sep) && resolved !== root) {
  res.status(400).json({ error: 'File path outside workspace', errorCode: 'INVALID_PATH' });
  return;
}
```

### 4. checkpointId のパストラバーサル
**ファイル**: `apps/desktop/sidecar/src/server.ts:1270,1294,1338,1488`
**問題**: checkpointId パラメータにフォーマット検証がない。`../../etc/passwd` 等のパスが path.join に渡される。
**修正**:
```typescript
const SAFE_CHECKPOINT_RE = /^[a-zA-Z0-9_-]{1,64}$/;
if (!SAFE_CHECKPOINT_RE.test(checkpointId)) {
  res.status(400).json({ error: 'Invalid checkpointId', errorCode: 'INVALID_CHECKPOINT_ID' });
  return;
}
```

### 5. execSync シェルインジェクション（killPortOwner）
**ファイル**: `apps/desktop/sidecar/src/server.ts:805-808,2151-2154`
**問題**: `` execSync(`kill -9 ${pid}`) `` — pid は lsof の出力で外部由来。lsof 出力が改竄された場合にシェルインジェクション可能。
**修正**: execFileSync を使ってシェル経由を排除:
```typescript
const pid = execFileSync('lsof', ['-ti', String(port)], { encoding: 'utf-8', timeout: 3000 }).trim();
if (pid) {
  for (const p of pid.split('\n')) {
    const num = parseInt(p, 10);
    if (!isNaN(num) && num > 1) execFileSync('kill', ['-9', String(num)], { timeout: 3000 });
  }
}
```

---

## 🟡 MEDIUM — 修正推奨

### 6. security_server.rs / harness.rs にテストが一切ない
**ファイル**: `apps/desktop/src-tauri/src/engine/security_server.rs`, `apps/desktop/src-tauri/src/commands/harness.rs`
**問題**: 認証トークン検証・パストラバーサル・ファイル操作・シェル実行のセキュリティガードが全て未テスト。外部プロセス（サイドカー）からアクセスされるため未テストは大きなリスク。
**修正**: tiny_http でモックサーバー立てて、認証なし/不正トークン/パストラバーサル/非許可拡張子の全パターンをテスト。

### 7. CSP connect-src が `https:` で全HTTPSを許可
**ファイル**: `apps/web/index.html:7`
**問題**: connect-src に `https:` が含まれ、XSS経由で任意の外部ホストへデータ送信可能。SECURITY.md では制限を記載しているが実態と乖離。
**修正**: 具体的なホストリストに絞る: `connect-src 'self' http://localhost:* http://127.0.0.1:* tauri://localhost https://api.openai.com ...`（カスタムエンドポイントはプロキシ経由なので不要）

### 8. CSP frame-ancestors 未指定
**ファイル**: `apps/web/index.html:7`
**問題**: メタタグに `frame-ancestors` がなく、クリックジャッキング保護が未適用。SECURITY.md には `frame-ancestors 'none'` が記載されているが実装されていない。
**修正**: メタタグに追加（ただしブラウザがメタタグ版を無視するケースがあるため、HTTP ヘッダーでの配置も検討）。

### 9. CSP worker-src 未指定
**ファイル**: `apps/web/index.html:7`
**問題**: WebWorker/ServiceWorker 経由の攻撃パスが未ブロック。WebContainer が ServiceWorker を使う場合に要設定。
**修正**: `worker-src 'self'` を追加。

### 10. /v1 プロキシ レスポンスヘッダが無制限に転送
**ファイル**: `apps/desktop/sidecar/src/server.ts:1777-1799`
**問題**: upstream の全レスポンスヘッダが転送される。Set-Cookie, Cache-Control 等のセキュリティ上重要なヘッダが混合される可能性。
**修正**: ホワイトリスト化: `['content-type', 'x-request-id', 'x-ratelimit-remaining']` のみ転送。

### 11. /data-backup のボディ構造検証なし
**ファイル**: `apps/desktop/sidecar/src/server.ts:1824-1835`
**問題**: req.body をそのまま JSON.stringify してディスク書き出し。構造検証がない。
**修正**: 書き込み前に `collections` の型・配列チェックを追加。

### 12. name パラメータ HTML エスケープなし
**ファイル**: `apps/desktop/sidecar/src/server.ts:394`
**問題**: createProjectDir のテンプレートリテラルで name がエスケープなしで HTML に埋め込まれている。
**修正**: HTML エスケープ関数を追加して `${escapeHtml(name)}` に変更。name の長さ制限（100文字）も追加。

### 13. vitest coverage threshold が不十分
**ファイル**: `apps/web/vitest.config.ts:41-47`
**問題**: statements:25, branches:20, functions:20, lines:25 は gate として最低ライン。大部分未カバー。
**修正**: 段階的に引き上げる。Security テストファイル（47行・2テスト）の拡充を先にやる。

### 14. vitest.ui.config.ts がCI未実行
**ファイル**: `.github/workflows/ci.yml`
**問題**: vitest.ui.config.ts は CI で実行されていない。UI コンポーネントテストがCIで検出されない。
**修正**: ci.yml に vitest.ui.config.ts の実行ステップを追加。

---

## 🟢 LOW — 改善提案

| # | 場所 | 内容 |
|---|---|---|
| 15 | server.ts:258 | AUTH_TOKEN未設定時 warn のみ（devモード）。production で未設定なら起動拒否を検討 |
| 16 | server.ts:1804 | プロキシエラー時に error.message を返す（内部情報漏洩リスク）。汎用メッセージに変更推奨 |
| 17 | server.ts:304 | express.json limit: '10mb' は設定ルートでは過大（defense-in-depth） |
| 18 | security.rs:327 | finallIsBlocked に `::` の未指定アドレス検証が未追加（validateUpstreamUrlでカバー済み） |
| 19 | server.ts:394 | CORS の methods 制限なし（任意メソッド許可）。defense-in-depth として ['GET','POST','PUT','DELETE'] を明示 |
| 20 | pnpm audit | qs via express 5.2.1（moderate）。`"qs": "6.14.0"` を overrides に追加 |
| 21 | package.json | `pnpm.overrides` は deprecated。pnpm-workspace.yaml への移行検討 |
| 22 | storage.ts:98-105 | Web版 API キーが IndexedDB 平文。ブラウザ拡張からのアクセスリスクを UI で警告推奨 |
| 23 | tool-executors.ts:71-81 | FORBIDDEN_TS_PATTERNS に new WebSocket() / new Worker() / navigator.sendBeacon() の追加検討 |
| 24 | security-hardening.test.ts | セキュリティテストが2件のみ（CORS削除検証, sanitizeIdentifier）。CSP/sandbox/storage の検証テスト追加推奨 |

---

## ✅ 問題なし（確認済み）

| 観点 | 結果 |
|---|---|
| IPC配線整合 | lib.rs 30コマンド ↔ commands/*.rs ↔ フロント invoke() 完全一致 |
| API キー保存 | OSキーチェーン → credentials.json(0o600) → フロントに空文字+フラグのみ。レガキーIDB掃除済み |
| テンプレート生成 | getTemplateFiles(lang, isDesktop) に分岐済み。FORBIDDEN パターン正常動作 |
| チャット永続化 | save_chat_messages 全件保存 + payload JSON + フロント appendOnly |
| i18n | ja/en 346キー完全一致。未定義キーなし |
| ルーティング | React Router /app と /chat の2ルート。RESTORE_PROMPTガード正常 |
| バージョン整合 | 0.4.2 全ファイル一致（check-versions.mjs で検証済み） |
| テスト実行 | 571件 + 68件 全PASS |
| SECURITY.md | 最新状態に更新済み。SSRF禁止、legacyキー削除、CSP修正が反映 |
| ADR | 001-015 全存在 |

---

## 優先度アクションプラン

1. **即座（本PRに含める）**: #1 iframe sandbox、#2 SSRF fallback、#3 /projects/file パス検証、#4 checkpointId バリデーション、#5 execSync → execFileSync
2. **次PR**: #6 Rust テスト追加、#7-9 CSP 修正、#10 ヘッダホワイトリスト
3. **Ongoing**: #13 threshold 引上げ、#14 CI に ui.config 追加、#20 qs override
