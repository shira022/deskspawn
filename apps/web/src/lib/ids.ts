/**
 * フロントメッセージ ID 生成（衝突耐性）。
 *
 * `Date.now()` のみだと同一ミリ秒内の連続生成で ID が重複しうる。
 * Desktop の `save_chat_messages` は `client_id` に UNIQUE 制約を持つため、
 * 重複 ID は保存全体の失敗につながる（ADR-013 の ON CONFLICT は配列内重複を
 * upsert で吸収するが、そもそも重複させない方が安全）。
 */
export function newMessageId(prefix: "msg-bot" | "msg-err" | "msg-user" | "msg"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
