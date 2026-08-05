# ADR-003: Node Sidecar（AI専業）と Rust Backend（実行・セキュリティ）の分離

## Status
accepted

## Context
AI推論にはVercel AI SDKを使用したいが、これはNode.js/TypeScriptが本領である。一方、ファイル操作・シェル実行・APIキー管理などのセキュリティ境界はRust側に置くべきという設計判断があった。単一プロセスに全てを押し込むと、セキュリティ検証とAI機能開発が相互に干渉する。

## Decision
アーキテクチャを2プロセスに分離する：
- **Node Sidecar**：AI推論（AI SDK）・コード生成・プレビュー用Vite起動を担当。HTTP REST APIで提供
- **Rust Backend（Tauri）**：ファイルI/O・シェル実行のパス検証（Security Server）・APIキーのキーチェーン管理・ウィンドウ管理を担当

## Consequences
- AI機能とセキュリティ検証が独立して進化できる
- Sidecarは `bun build --compile` で単一バイナリ化し配布が容易
- プロセス間通信（HTTP）の契約管理が必要になる
- ポート管理・起動順序の複雑さが増す
