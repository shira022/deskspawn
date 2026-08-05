# ADR-008: プロジェクト実体のディスク化（OPFS廃止）

## Status
accepted

## Context
Web版はブラウザ内蔵のOPFS（Origin Private File System）とIndexedDBにプロジェクトファイルを保存していた。デスクトップ版も当初これを踏襲し、フロントの編集データはOPFS、AIの作業データはpreviewコピーと、**同一プロジェクトの実体が2重化**していた。プレビュー表示のたびにフロントが全ファイルをsidecarへ送信する方式で、同期ずれやファイル欠落（package.json未作成時のbun install失敗等）が発生していた。

## Decision
デスクトップ版では**プロジェクト実体をディスク上の実ファイルに一本化**する。

- 保存先: `~/deskspawn/projects/<projectId>/`（ADR-007）
- ユーザー編集（フロントUI）とAI編集（sidecar）の**両方が同一ディレクトリを参照**
- ファイル読み書きはRust IPC経由（`engine/security.rs` の拡張子許可・パストラバーサル防御を適用）
- プレビューは実体ディレクトリで直接viteを起動（previewコピー廃止）
- Web版はOPFSを維持（プラットフォーム別分岐）

## Consequences
- 2重管理・同期問題が根本解消。エクスプローラーで直接ファイル確認が可能
- セキュリティ境界がRust側に集約され、パストラバーサル等のリスクを低減
- チェックポイント・スクリーンショット等が実体ディレクトリ配下の `.deskspawn/` に自己完結
- Web/Desktopで保存層が分岐するため、アダプタ（storage.ts / storage-desktop.ts）で透過的に切替
