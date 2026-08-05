# ADR Template

## Title
（決定のタイトル — 簡潔に）

## Status
proposed / accepted / superseded / deprecated

## Context
（この決定に至った背景・問題・制約。個人情報・絶対パスは記載しないこと）

## Decision
（採用した解決策とその理由）

## Consequences
（決定による影響：良い面・悪い面・トレードオフ）

---

## 🔒 個人情報・機密情報の禁止（必須）

- ❌ ユーザー名・個人名・メールアドレス・APIキー・トークン・シークレット
- ❌ 絶対パス（例: `C:\Users\<user>\...`）→ 常に `~/` 相対表記 or `<USER_HOME>` プレースホルダを使用
- コミット前に自己チェックすること（decision-recorderスキルのチェックリスト参照）
