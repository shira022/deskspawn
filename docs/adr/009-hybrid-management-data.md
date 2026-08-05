# ADR-009: 管理データのハイブリッド化（JSON + SQLite）

## Status
accepted

## Context
デスクトップ版の管理データ（プロジェクト一覧・設定・チャット履歴）の保存形式を検討した。Web版はすべてIndexedDBに保存していたが、デスクトップ版では実ファイル前提（ADR-008）のため、保存形式の一本化が必要だった。チャット履歴は量的に増大し、JSONファイル単体では読み書きコストと破損リスクが高まる。

## Decision
管理データを用途に応じて**ハイブリッドで保存**する。

| データ | 形式 | 場所 |
|---|---|---|
| プロジェクト一覧 | JSON | `~/deskspawn/projects/projects.json` |
| アプリ設定 | JSON | `~/deskspawn/config/config.json` |
| チャット履歴 | **SQLite**（プロジェクトごと） | `~/deskspawn/projects/<id>/.deskspawn/chat.db` |

- チャットDBはRustが管理（`engine/storage.rs`、sqlx + SQLite、WALモード）
- フロントはRust IPC経由で `get_chat_history` / `append_chat_message` を呼ぶ
- APIキーは変更なしでOSキーチェーン（Windows Credential Manager）に保存

## Consequences
- チャット履歴の追加・取得がSQLの利点（インデックス・増分INSERT）で効率化
- プロジェクトごとにDBが自己完結し、削除時はディレクトリごと消すだけ
- 一覧・設定は人間可読なJSONで、バックアップ・手動編集が容易
- Rust側にDB管理層が加わるため、`engine/storage.rs` の責務が明確化
