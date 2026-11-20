/**
 * Desktop runtime environment provider — Tauri IPC backed.
 *
 * The Rust side exposes a deliberately narrow surface: `check_runtime_env`
 * and `install_runtime_prerequisite` (kind is limited to bun | webview2).
 * Package ids and winget arguments stay in Rust; nothing from the UI is
 * forwarded to a shell.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  RuntimeCheckItem,
  RuntimeEnvProvider,
  RuntimeInstallProgress,
  RuntimePrerequisiteKind,
} from "@deskspawn/shared/lib/runtime-env";

interface WingetStatus {
  available: boolean;
  version?: string;
  message: string;
}

export const desktopRuntimeEnvProvider: RuntimeEnvProvider = {
  check: () => invoke<RuntimeCheckItem[]>("check_runtime_env"),

  install: (kind: RuntimePrerequisiteKind) =>
    invoke<RuntimeCheckItem[]>("install_runtime_prerequisite", { kind }),

  subscribeProgress: (cb: (progress: RuntimeInstallProgress) => void) =>
    listen<RuntimeInstallProgress>("runtime-install-progress", (event) =>
      cb(event.payload),
    ),

  isWingetAvailable: async () => {
    const status = await invoke<WingetStatus>("check_winget");
    return status.available;
  },
};
