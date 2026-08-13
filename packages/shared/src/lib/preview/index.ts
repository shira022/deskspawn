/**
 * プレビューシステム — 公開API
 *
 * 使用方法:
 * ```ts
 * import { previewManager } from ".";
 *
 * // アプリ選択時に起動
 * await previewManager.boot(appId);
 *
 * // コード変更後に同期
 * await previewManager.syncAndReload(appId);
 *
 * // 状態変更を監視
 * const unsub = previewManager.onStateChange((state) => {
 *   console.log(state.status, state.url);
 * });
 * ```
 */

import { PreviewManager } from "./webcontainer";
import { DesktopPreviewManager } from "./desktop";
import { isDesktopEnv } from "../platform";
export type { PreviewState, PreviewStatus, ErrorEntry } from "./types";
export { PreviewManager, DesktopPreviewManager };

type PreviewManagerImpl = PreviewManager | DesktopPreviewManager;

let previewImpl: PreviewManagerImpl | null = null;

function getPreviewImpl(): PreviewManagerImpl {
  if (!previewImpl) {
    previewImpl = isDesktopEnv() ? new DesktopPreviewManager() : new PreviewManager();
  }
  return previewImpl;
}

/**
 * アプリケーション全体で共有するプレビューマネージャーのシングルトンインスタンス。
 * PreviewPanel や tool-executors から参照される。
 *
 * - Desktop: サイドカーがローカルVite dev serverを起動（外部依存なし）
 * - Web:     WebContainer（ブラウザ内Node.js）
 *
 * Proxyによる遅延初期化で、main.tsx のフラグ設定順序（registerDesktopServices →
 * __DESKSPAWN_DESKTOP__ = true）に依存しない。モジュール評価時ではなく
 * 初回プロパティアクセス時に環境フラグを評価する。
 */
export const previewManager = new Proxy({} as PreviewManagerImpl, {
  get(_target, prop) {
    const impl = getPreviewImpl();
    const value = (impl as unknown as Record<PropertyKey, unknown>)[prop];
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(impl);
    }
    return value;
  },
}) as PreviewManagerImpl;
