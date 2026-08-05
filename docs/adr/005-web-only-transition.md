# ADR-005: Web-Only転換（Tauri/Sidecar削除・Cloudflare Pages・IndexedDB化）

## Status
superseded

## Context
v1.0.0時点で、デスクトップアプリの配布・メンテナンスコスト（署名・インストーラ・プラットフォーム差異）が開発速度のボトルネックとなった。ユーザーがブラウザから即座に試せる形態が優先され、Web版への転換が決定された。

## Decision
デスクトップ（Tauri）・Sidecarを一時的に削除し、純Webアプリとして再構築する：
- デプロイ先：Cloudflare Pages
- データ永続化：IndexedDB（ブラウザ内蔵）
- AI：ブラウザから直接プロバイダーAPIを呼ぶ方式

## Consequences
- インストール不要で即試用可能になり、配布コストが激減
- IndexedDBの永続化はブラウザ拡張機能等からアクセス可能で、セキュリティ面で課題（後のデスクトップ復活の伏線）
- デスクトップ版の資産（Security Server等）は休眠状態で保持

## Superseded by
ADR-006（デスクトップ版復活）
