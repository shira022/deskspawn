/**
 * プラットフォーム判定の共通ヘルパー
 *
 * デスクトップ（Tauri）では main.tsx が window.__DESKSPAWN_DESKTOP__ = true を
 * 設定する。Web 版とデスクトップ版で UI/UX が異なる部分は、このヘルパーで
 * 分岐する（差異部のみ分岐・共通 UI は共通コードを維持）。
 */

/** デスクトップ（Tauri）環境かどうか — 実行時に評価する */
export function isDesktopEnv(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as unknown as { __DESKSPAWN_DESKTOP__?: boolean }).__DESKSPAWN_DESKTOP__ === true
  );
}
