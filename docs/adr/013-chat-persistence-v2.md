# ADR-013: チャット履歴の完全永続化（スキーマv2 + 逐次保存）

## Status
accepted

## Context
デスクトップ版のチャット履歴が「ユーザーメッセージのみ表示・AI応答が表示されない」問題（2026-08 実測）。DB を直接調査した結果、**空ではなくユーザー1件のみ・AI応答0件** だった。原因は4点:

1. `chat_messages` スキーマが `role` + `content` のみ（AI応答のフェーズ詳細・ログ等を格納する余地がない）
2. 「最後1件だけ append」方式の欠陥（生成完了時のメッセージ追加が永続化されない経路があった）
3. エラー握りつぶし（`persistChatHistory` の `.catch(() => {})` で保存失敗が不可視）
4. 復元時に `{role, content}` だけに変換して破棄（UI は既に stepLogs/phaseOutputs に対応済みだったのに失われた）

要件: AI応答本文・フェーズ詳細（phaseOutputs）・ステップログ（stepLogs）・usage（トークン/コスト）・checkpointId・タイムスタンプを SQLite に完全保存し、再起動後も復元可能にすること。生成途中でアプリが閉じても途中まで保存される耐性を持つこと。DB は Rust 側が所有（フロントは直接 SQLite を触らない、ADR-009 方式）。

## Decision

1. **スキーマv2**: `chat_messages` に `client_id TEXT UNIQUE`（フロントの `msg-…` ID）+ `payload TEXT`（メッセージオブジェクト全体の JSON）を追加。v1→v2 は `PRAGMA table_info` による列チェック + `ALTER TABLE` + バックフィル（既存行は `legacy-<id>` 形式の client_id）で自動移行。payload NULL の行はフォールバック表示（既存データを維持）
2. **保存APIは全件置換（原子的）**: `append_chat_message` を廃止 → `save_chat_messages(app_id, Vec<ChatMessage>)` を新設。トランザクション内で `DELETE` + `INSERT … ON CONFLICT(app_id, client_id) DO UPDATE` を実行。フロントが同一 `client_id` を配列内で重複送信しても UNIQUE 制約違反にならず最後の行が勝つ（2026-08 レビュー指摘対応）。編集・再生成・truncate 時の重複 append バグも同時に解消
3. **D2（逐次保存）**: 生成開始時に空のアシスタントプレースホルダー（`newMessageId("msg-bot")` = `msg-bot-<randomUUID>`。同一ミリ秒内の連続生成でも衝突しない）を保存 → ステップログ/フェーズ詳細を `updateMessage` のたびに逐次 upsert → 完了・空レスポンス・Abort・エラー時に最終化。途中でアプリが閉じても途中まで残る。復元時に content が空のまま残った行は「生成が中断されました」表示にフォールバック（空の吹き出しを出さない）
4. **エラー可視化**: `persistChatHistory` は boolean を返し、失敗時は `saveFailed` フラグ + UI の琥珀色バナーで表示（握りつぶし廃止）
5. **フロント保存の直列化**: 保存キューで並行 write を防止（IndexedDB 側も同様）。加えて `persistChatHistory` は前回保存成功時と同一内容のスナップショットをキャッシュし、**同一内容の連続保存（同一ステートでの updateMessage 多重呼び出し等）は書き込み自体をスキップ**して無駄な全件置換コストを抑制（保存失敗時はキャッシュしないため必ず再試行される）

## Consequences
- ✅ 再起動後もチャット全文・フェーズ詳細（4フェーズ）・ステップログ・usage が復元される（実機 E2E 実証済み）
- ✅ 生成中断時も途中までのログが残る
- ✅ payload JSON 列方式のため、将来の型追加にスキーマ変更不要
- ⚠️ 全件置換のため会話が長くなると保存コストが増える（現状は許容範囲。将来は差分更新に変更可）
- ⚠️ 既存 v1 データの履歴は内容のみ保持（元のタイムスタンプは再保存時に失われる）
- 関連: ADR-009（ハイブリッド管理データ）

---
