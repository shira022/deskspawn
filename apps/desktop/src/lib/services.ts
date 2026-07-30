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

export { registerWebServices as registerDesktopServices } from "@/lib/services/index";
