/**
 * Desktop service registration.
 *
 * Desktop reuses the web app's service implementations (via @/* aliases).
 * Platform-specific behavior (e.g., API key via Tauri IPC) is handled
 * transparently inside lib/storage.ts with try/catch fallback.
 *
 * This file exists to satisfy the import in main.tsx — it delegates
 * to the web app's service registration.
 */

import { registerWebServices } from "@deskspawn/shared/lib/services/index";

/**
 * Register desktop services.
 *
 * Sets the desktop environment flag BEFORE delegating to the shared web
 * registration, so isDesktopEnv() guards inside registerWebServices (C7:
 * desktop must NOT register WebStorageService) evaluate correctly no matter
 * which call site runs first (main.tsx body, or the module-level call in
 * App.tsx which executes during import graph evaluation).
 */
export function registerDesktopServices(): void {
  (window as unknown as { __DESKSPAWN_DESKTOP__?: boolean }).__DESKSPAWN_DESKTOP__ = true;
  registerWebServices();
}