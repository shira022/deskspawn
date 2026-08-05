# ADR-002: データベース基盤の Prisma → sqlx 変更

## Status
accepted

## Context
初期設計ではDBアクセスにPrisma（Node.jsベース）を検討した。しかしアーキテクチャがRust（Tauri）をシェルとする方針に確定し、DBアクセス層をRustネイティブに統一する方が、プロセス境界を減らし、型安全性とパフォーマンスの両面で優位と判断した。

## Decision
Rust製のsqlx（SQLite対応・コンパイル時クエリ検証）をDB基盤として採用する。Prismaは不採用とする。

## Consequences
- Rustプロセス内でDBに直接アクセスでき、Nodeプロセスを経由しない
- コンパイル時のクエリ検証により実行時エラーが減少
- SQLiteのマイグレーションは `sqlx migrate` で管理
