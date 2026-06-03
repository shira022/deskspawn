/**
 * Tauri 実行環境の検出ユーティリティ。
 *
 * Tauri v2 では `window.__TAURI_INTERNALS__` が常に存在する。
 * このプロパティは Tauri が公式に公開している検出方法であり、
 * `@tauri-apps/api/core` の invoke が利用可能かどうかの指標となる。
 *
 * @see https://v2.tauri.app/reference/config/#withglobaltauri
 */

/**
 * 現在の実行環境が Tauri WebView 内かどうかを判定する。
 * ブラウザ（Vite dev server）の場合は false を返す。
 */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as any).__TAURI_INTERNALS__
  );
}
