/**
 * Sidecar 接続情報（デスクトップ専用）
 *
 * WSL2 の localhostForwarding がゾンビ共有ソケットを残すため、サイドカーは
 * 起動のたびにフォールバックしてポートが変わり得る（3009 → 3010 → …）。
 * Rust 側（getSidecarPort）が実際のポートを検出し、main.tsx が
 * window.__DESKSPAWN_SIDECAR_PORT__ に設定する。共有コードは実行時に
 * このグローバルを読むことで、どのポートでも正しく接続できる。
 *
 * セキュリティ（H1）: サイドカーのローカル HTTP API は認証トークン
 * （X-DeskSpawn-Token）を要求する。トークンは Rust の IPC
 * （get_sidecar_token）経由でのみ取得でき、外部オリジンの Web ページからは
 * 到達できない。すべてのサイドカー呼び出しは sidecarFetch() を使うこと。
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

// ── H1: 認証トークン ──────────────────────────────────────────────────────────

let cachedToken: string | null = null;

/** サイドカー認証トークンを取得する（Tauri IPC 経由・キャッシュ付き）。 */
export async function getSidecarToken(): Promise<string> {
  if (cachedToken !== null) return cachedToken;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const token = await invoke<string>("get_sidecar_token");
    cachedToken = token;
    return token;
  } catch {
    return "";
  }
}

/** 認証トークンを付与してサイドカー API を呼ぶ（非デスクトップでは素の fetch）。 */
export async function sidecarFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = await getSidecarToken();
  if (token) {
    headers.set("X-DeskSpawn-Token", token);
  }
  return fetch(`${sidecarBase()}${path}`, { ...init, headers });
}
