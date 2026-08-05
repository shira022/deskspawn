# ADR-010: 生成アプリのフルスタック化（Hono + bun:sqlite）

## Status
accepted

## Context
v0.2.0以前の生成アプリは純粋なSPA（Vite + React + Tailwind、永続化はIndexedDB）だった。デスクトップ版は実ファイル環境（ADR-008）であるため、**サーバーサイドを持つフルスタックアプリ**を生成できる余地が生まれた。バックエンドの技術選定では、AI生成の学習データ量（Expressが最多）と、軽量性・型安全性・テスト容易性のトレードオフを検討した。

## Decision
デスクトップ版の生成アプリを**フルスタック化**する（Web版はSPAを維持）。

| 層 | 技術 | 理由 |
|---|---|---|
| フロント | Vite + React 18 + Tailwind v4 | 既存踏襲 |
| API | **Hono** | 超軽量・TypeScriptネイティブ・Web標準・`app.request()`でサーバー起動なしにテスト可能 |
| DB | **bun:sqlite**（素のSQL + 薄いヘルパー層） | bun同梱で追加依存ゼロ。将来Drizzle移行時はヘルパー層のみ変更 |
| ランタイム | bun | Windowsホスト最小化（Nodeインストール不要） |

- DBパスは `DATABASE_URL` で抽象化（デフォルト `./data/app.db`、将来のクラウドDB/認証環境に接続可能な余地を残す。実装はしない）
- APIサーバーはsidecarが子プロセス管理（デフォルト4174、+10まで自動フォールバック、vite proxyを実ポートに自動パッチ）
- bunは`export default { port, fetch }`で自動起動（明示的なBun.serve呼び出しは二重バインドでEADDRINUSEになるため禁止）
- テストランナーは`bun test`（vitestはbun上でvite-nodeのURL解決に問題があったため不採用。bun testはvitest互換API）

## Consequences
- 生成アプリがAPI + DBを持つ本格的なフルスタックになる（デスクトップ版のみ）
- Honoの`app.request()`でテスト駆動の品質ループ（ADR-012）が容易に
- bun 1つでinstall・dev server・SQLite・テストが完結し、ユーザー環境が最小
- テンプレートがWeb/Desktopで分岐（`getTemplateFiles(language, isDesktop)`）
