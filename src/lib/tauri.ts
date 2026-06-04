/**
 * Tauri 実行環境の検出ユーティリティ。
 *
 * DeskSpawn は Tauri 専用アプリケーションです。
 * この関数は常に true を返します。
 */

/**
 * 現在の実行環境が Tauri WebView 内かどうかを判定する。
 * DeskSpawn は Tauri 専用のため常に true を返す。
 */
export function isTauri(): boolean {
  return true;
}
