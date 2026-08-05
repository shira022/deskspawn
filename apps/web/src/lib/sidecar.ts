/**
 * Sidecar 接続情報（デスクトップ専用）
 *
 * WSL2 の localhostForwarding がゾンビ共有ソケットを残すため、サイドカーは
 * 起動のたびにフォールバックしてポートが変わり得る（3009 → 3010 → …）。
 * Rust 側（getSidecarPort）が実際のポートを検出し、main.tsx が
 * window.__DESKSPAWN_SIDECAR_PORT__ に設定する。共有コードは実行時に
 * このグローバルを読むことで、どのポートでも正しく接続できる。
 */

const DEFAULT_SIDECAR_PORT = 3009;

/** デスクトップのサイドカーポート（未設定時はデフォルト） */
export function getSidecarPort(): number {
  if (typeof window !== "undefined") {
    const p = (window as unknown as { __DESKSPAWN_SIDECAR_PORT__?: number })
      .__DESKSPAWN_SIDECAR_PORT__;
    if (typeof p === "number" && p > 0) return p;
  }
  return DEFAULT_SIDECAR_PORT;
}

/** サイドカーのベースURL */
export function sidecarBase(): string {
  return `http://localhost:${getSidecarPort()}`;
}
