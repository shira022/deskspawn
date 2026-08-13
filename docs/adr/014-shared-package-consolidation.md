# ADR-014: 共有コードを packages/shared に集約（Web/Desktop 双方向の import 源を一元化）

## Status
accepted

## Context
ADR-006 の「UI真共有」方針により、デスクトップ版は Web 版のコンポーネントを
`@` alias（`apps/desktop/vite.config.ts` → `apps/web/src`）で import していた。
この構成はコード重複を排除できた一方、以下の問題があった：

- 「デスクトップ版でも使っているコードが `apps/web/` ディレクトリにある」構造が
  リポジトリを読む人に紛らわしい（過去にユーザーから指摘あり）
- `apps/web/src` が「Web 専用」と「両プラットフォーム共有」の混在領域になり、
  所有権が不明瞭
- 既に `packages/ui`・`packages/ai-core` への部分移行が始まっていたが途中で停止
  （`apps/web/src/components/ui/` と `packages/ui` に重複が残存）

## Decision
共有アプリコード（UI・チャット・AIエンジン・ストレージ・i18n・状態管理・型）を
`packages/shared/src/` に集約し、Web 版・デスクトップ版の両方が
`@deskspawn/shared` alias（vite/tsconfig で `packages/shared/src` を指す）経由で
import する単一パッケージ構成へ移行する。

- `apps/web/src` には Web 専用エントリのみ残す：
  `main.tsx`・`App.tsx`・`index.css`・`vite-env.d.ts`・`routes/`・`test/`（9ファイル）
- `apps/desktop/src` は従来どおり薄いラッパー（5ファイル）のまま
- Web 専用実装（`storage-opfs`・`preview/webcontainer`）も `packages/shared` 内に同居
  （`isDesktopEnv()` 実行時分岐で切替）。共有コンポーネントが Web 実装を直接
  import しているため、パッケージ外部に残すと逆依存（shared → apps/web）が発生
  するため
- `packages/shared/src` 内の相互 import は相対パスに統一（alias 非依存で自己完結）

### 移行の詳細
- `git mv` で `apps/web/src/{components,engine,hooks,lib,locales,store,types}` を
  `packages/shared/src/` へ移動（115ファイル）
- shared 内の `@/` import を相対パスに機械変換（226箇所）
- web/desktop の `vite.config.ts`・`tsconfig*.json` に `@deskspawn/shared` alias 追加
- `eslint.config.js` をリポジトリルートへ移動（shared も lint 対象に。
  React アプリ / sidecar の2セクション構成）
- vitest の include を `packages/shared/src/**` に拡張（テストはコードの隣に移動）
- Tailwind の `@source` を `packages/shared/src` に向ける（両アプリの index.css）
- `packages/shared/package.json` 新設（依存は web から移動）

## Consequences
- ✅ `apps/web/src` = Web 専用エントリ、`packages/shared` = 共有コード、と所有権が明確
- ✅ ドキュメント（README Who-uses-what）が嘘を言わなくなる
- ✅ `packages/ui` との重複問題は解消の下地ができた（shared 内に同居するため）
- ⚠️ `@` alias（`apps/web/src`）と `@deskspawn/shared` の2系統が残る
  （web エントリ内の相互参照は `@`、共有コードは `@deskspawn/shared`）
- ⚠️ Web 専用実装（storage-opfs / webcontainer）が「shared 内の web 専用コード」と
  して同居するため、パッケージ名と実態の厳密一致はしない
  （逆依存回避のための意図的妥協）
- ⚠️ 大規模な import 書き換えのため、レビュー時は tsc/vitest/build/eslint の
  全ゲート + E2E で確認する

## Supersedes
- （なし。ADR-006 の UI真共有方針を維持したまま、共有コードの所在を変更するもの）
