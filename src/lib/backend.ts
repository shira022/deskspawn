/**
 * Unified DeskSpawn backend call layer.
 *
 * 本番 (Tauri WebView) → Tauri IPC (invoke)
 * 開発プレビュー (Vite)   → ブラウザ用フォールバック
 *
 * 呼び出し元のコードは共通で、実行環境によってルーティングが自動切替される。
 */

import { SIDECAR_BASE } from "@/lib/constants";
import type { EnvCheckItem } from "@/types";

const STORAGE_KEY = "deskspawn_ai_config";

// ── Tauri detection ──────────────────────────────────────────────────────────

/**
 * Tauri v2 では `window.__TAURI_INTERNALS__` が常に存在する。
 * `window.__TAURI__` は `withGlobalTauri: true` の場合のみ。
 * @see https://v2.tauri.app/reference/config/#withglobaltauri
 */
function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as any).__TAURI_INTERNALS__
  );
}

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
  | "sidecar_status";

// ── Unified call ─────────────────────────────────────────────────────────────

/**
 * DeskSpawn のバックエンドコマンドを実行する。
 *
 * @param cmd  コマンド名（Tauri の `#[tauri::command]` と一致）
 * @param args コマンド引数（オプショナル）
 * @returns    コマンド実行結果
 */
export async function callBackend<T = unknown>(
  cmd: BackendCommand,
  args?: Record<string, unknown>,
): Promise<T> {
  // ── Tauri モード ──────────────────────────────────────────────────────────
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }

  // ── ブラウザ / プレビューモード ──────────────────────────────────────────
  return browserFallback<T>(cmd, args);
}

// ── Browser fallbacks ────────────────────────────────────────────────────────

async function browserFallback<T>(
  cmd: BackendCommand,
  args?: Record<string, unknown>,
): Promise<T> {
  switch (cmd) {
    // ── AI Config ──────────────────────────────────────────────────────────
    case "load_ai_config": {
      const raw = localStorage.getItem(STORAGE_KEY);
      return (raw ? JSON.parse(raw) : null) as T;
    }

    case "save_ai_config": {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(args?.config));
      return undefined as T;
    }

    // ── Environment checks ──────────────────────────────────────────────────
    case "check_environment": {
      const isWindows =
        typeof navigator !== "undefined" &&
        (navigator.platform ?? "").toLowerCase().includes("win");

      // Try sidecar first for real shell checks
      try {
        const res = await fetch(`${SIDECAR_BASE}/api/backend/invoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd, args: args ?? {} }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json();
          return data.result as T;
        }
      } catch {
        // Sidecar unavailable → fall through to mock
      }

      // Inline mock: only Node.js is required to run DeskSpawn
      const mockResults: EnvCheckItem[] = [
        {
          name: "Node.js",
          description: "Runtime >= 20 LTS",
          checkCommand: "node --version",
          status: "ok",
          downloadUrl: "https://nodejs.org/",
          wingetPackage: "OpenJS.NodeJS.LTS",
          sizeMb: 30,
        },
      ];

      // Windows-only checks (for Tauri compilation)
      if (isWindows) {
        mockResults.push(
          {
            name: "Rust",
            description: "Rust compiler and toolchain",
            checkCommand: "rustc --version",
            status: "fail",
            downloadUrl: "https://rustup.rs/",
            wingetPackage: "Rustlang.Rustup",
            sizeMb: 400,
          },
          {
            name: "VS Build Tools",
            description: "MSVC compiler for native compilation",
            checkCommand: "vswhere",
            status: "fail",
            downloadUrl:
              "https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022",
            wingetPackage: "Microsoft.VisualStudio.2022.BuildTools",
            sizeMb: 4500,
          },
          {
            name: "WebView2",
            description: "Required for Tauri WebView",
            checkCommand: "reg query",
            status: "fail",
            downloadUrl:
              "https://developer.microsoft.com/microsoft-edge/webview2/",
            wingetPackage: "Microsoft.EdgeWebView2Runtime",
            sizeMb: 120,
          },
        );
      }

      return mockResults as T;
    }

    case "check_winget": {
      const isWindows =
        typeof navigator !== "undefined" &&
        (navigator.platform ?? "").toLowerCase().includes("win");

      // Try sidecar first
      try {
        const res = await fetch(`${SIDECAR_BASE}/api/backend/invoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd, args: args ?? {} }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json();
          return data.result as T;
        }
      } catch {
        // Sidecar unavailable → fall through to mock
      }

      return {
        available: isWindows,
        message: isWindows
          ? "winget is available"
          : "winget is not available on this platform",
      } as T;
    }

    case "install_with_winget":
      throw new Error(
        "install_with_winget is not available in browser mode. " +
          "Run `tauri dev` or install the packages manually.",
      );

    // ── Restart commands (not applicable in browser) ────────────────────────
    case "restart_sidecar":
      console.warn(
        "[preview] restart_sidecar is not available in browser mode. " +
          "Restart the sidecar process manually.",
      );
      return undefined as T;

    case "restart_tauri":
      console.warn(
        "[preview] restart_tauri is not available in browser mode. " +
          "Run `tauri dev` to restart the Tauri app.",
      );
      return undefined as T;

    // ── Sidecar status ────────────────────────────────────────────────────
    case "sidecar_port":
      return 3001 as T;

    case "sidecar_status":
      return { running: true, ready: true, pid: null, port: 3001 } as T;

    // ── Open URL ───────────────────────────────────────────────────────────
    case "open_url":
      if (args?.url && typeof args.url === "string") {
        window.open(args.url, "_blank");
      }
      return undefined as T;

    default:
      throw new Error(
        `Unknown backend command '${cmd}' - not available in browser mode.`,
      );
  }
}
