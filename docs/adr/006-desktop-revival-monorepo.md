# ADR-006: デスクトップ版復活（monorepo化・UI真共有・Tauri v2 + Sidecar再導入）

## Status
accepted

## Context
Web版（IndexedDB永続化）はセキュリティ面で課題があり（ブラウザ拡張機能からのアクセス可能性）、本格的な開発プラットフォームとしてはデスクトップ版のローカルファイル管理が求められた。またWeb版は「試用・体験用」として価値があるため、両立が決定された。

## Decision
モノレポ構成（pnpm workspace）でデスクトップ版を復活させる：
- `apps/web`：Web版（体験用・SPA・IndexedDB・現行維持）
- `apps/desktop`：Tauri v2 + React（デスクトップ版・本編）
- `packages/ui`・`packages/ai-core`：共有コード
- **UI真共有**：デスクトップはWebのコンポーネントをimport（別実装禁止・差異部のみ分岐）
- 環境判定は `isDesktopEnv()`（`window.__DESKSPAWN_DESKTOP__`）に一元化

## Consequences
- コード重複が排除され、UI/UXの一貫性が保たれる
- デスクトップ版はローカル完結（vite + sidecar）でオフライン動作可能
- Web版とデスクトップ版のストレージは別管理（同期しない）方針に

## Supersedes
ADR-005
