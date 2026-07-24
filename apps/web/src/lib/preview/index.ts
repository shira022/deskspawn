/**
 * プレビューシステム — 公開API
 *
 * 使用方法:
 * ```ts
 * import { previewManager } from "@/lib/preview";
 *
 * // プロジェクト選択時に起動
 * await previewManager.boot(projectId);
 *
 * // コード変更後に同期
 * await previewManager.syncAndReload(projectId);
 *
 * // 状態変更を監視
 * const unsub = previewManager.onStateChange((state) => {
 *   console.log(state.status, state.url);
 * });
 * ```
 */

import { PreviewManager } from "./webcontainer";
export type { PreviewState, PreviewStatus, ErrorEntry } from "./types";
export { PreviewManager };

/**
 * アプリケーション全体で共有するプレビューマネージャーのシングルトンインスタンス。
 * PreviewPanel や tool-executors から参照される。
 */
export const previewManager = new PreviewManager();
