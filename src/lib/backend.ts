/**
 * Unified DeskSpawn backend call layer.
 *
 * DeskSpawn は Tauri 専用アプリケーションです。
 * すべてのバックエンドコマンドは Tauri IPC（invoke）経由で Rust バックエンドに送信されます。
 */

// ── Command typeヘルパー ────────────────────────────────────────────────────

type BackendCommand =
  | "load_ai_config"
  | "save_ai_config"
  | "check_environment"
  | "check_winget"
  | "install_with_winget"
  | "restart_sidecar"
  | "restart_tauri"
  | "open_url"
  | "sidecar_port"
  | "sidecar_status"
  | "open_in_vscode";

// ── Unified call ─────────────────────────────────────────────────────────────

/**
 * DeskSpawn のバックエンドコマンドを実行する。
 * Tauri IPC（invoke）経由で Rust バックエンドに処理を委譲する。
 *
 * @param cmd  コマンド名（Tauri の `#[tauri::command]` と一致）
 * @param args コマンド引数（オプショナル）
 * @returns    コマンド実行結果
 */
export async function callBackend<T = unknown>(
  cmd: BackendCommand,
  args?: Record<string, unknown>,
): Promise<T> {
  // Tauri IPC で Rust バックエンドを呼び出す
  // isTauri() は常に true（DeskSpawn は Tauri 専用）
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
