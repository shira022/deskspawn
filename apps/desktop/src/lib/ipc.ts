/**
 * DeskSpawn Desktop — Tauri IPC Bridge
 *
 * Wraps Tauri invoke() calls for the frontend. In non-Tauri environments
 * (e.g., browser dev), falls back to mock implementations.
 *
 * 監査 2026-08-27: 実使用は getSidecarPort のみのため、未使用のラッパー
 * （saveAiConfig / sendChatMessage / readFile 等）を削除した。
 */

let tauriApi: typeof import("@tauri-apps/api/core") | null = null;

async function ensureTauri(): Promise<boolean> {
  if (tauriApi) return true;
  try {
    tauriApi = await import("@tauri-apps/api/core");
    return true;
  } catch {
    return false;
  }
}

// ── Sidecar Management ────────────────────────────────────────────────────

/** Sidecar の実際の待受ポートを取得する（Rust が sidecar-ready:<port> から捕捉）。 */
export async function getSidecarPort(): Promise<number> {
  if (!(await ensureTauri())) return 3009;
  try {
    return await tauriApi!.invoke<number>("sidecar_port");
  } catch {
    return 3009;
  }
}