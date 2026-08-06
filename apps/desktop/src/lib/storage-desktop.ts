/**
 * Desktop storage adapter — real files on disk via Rust IPC.
 *
 * Desktop-only (see ADR-008). The web version keeps IndexedDB/OPFS.
 * All app data lives under `~/deskspawn/apps/<appId>/` and the
 * registry lives in `~/deskspawn/apps/apps.json`.
 *
 * API shape mirrors apps/web/src/lib/storage.ts so the shared engine and
 * UI can swap adapters transparently via isDesktopEnv().
 */

import { invoke } from "@tauri-apps/api/core";

// ── Types (mirror of storage.ts) ──────────────────────────────────────────────

export interface StoredApp {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ── App Operations (Rust IPC) ─────────────────────────────────────────────

/** Map Rust AppMeta (snake_case) to the shared StoredApp shape. */
function mapAppMeta(meta: {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}): StoredApp {
  return {
    id: meta.id,
    name: meta.name,
    createdAt: meta.created_at,
    updatedAt: meta.updated_at,
  };
}

export async function listApps(): Promise<StoredApp[]> {
  const metas = await invoke<Array<{
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
  }>>("list_apps");
  return metas.map(mapAppMeta);
}

export async function getApp(id: string): Promise<StoredApp | null> {
  const apps = await listApps();
  return apps.find((p) => p.id === id) ?? null;
}

export async function saveApp(app: StoredApp): Promise<void> {
  // The registry is source of truth on disk; create updates name only.
  // (Rust create_app requires a name; for updates we keep it simple and
  //  treat save as create-if-missing with the given metadata.)
  const existing = await getApp(app.id);
  if (!existing) {
    const created = await invoke<{
      id: string;
      name: string;
      created_at: string;
      updated_at: string;
    }>("create_app", { name: app.name });
    // Keep the caller's id if the backend assigned a different one? The
    // backend always generates its own id; propagate it back.
    if (created.id !== app.id) {
      // The caller created the app before backend registration; rename
      // is not supported — log a warning for now.
      console.warn(
        `[storage-desktop] backend id ${created.id} differs from caller id ${app.id}`,
      );
    }
  }
}

export async function deleteApp(id: string): Promise<void> {
  await invoke("delete_app", { appId: id });
}

// ── App File Operations (real files on disk) ──────────────────────────────

/** List app source files (relative paths, excludes node_modules/.git). */
export async function listAppFiles(appId: string): Promise<string[]> {
  return invoke<string[]>("list_app_files", { appId });
}

/** Read a single app file. Returns null if missing. */
export async function readAppFile(
  appId: string,
  path: string,
): Promise<string | null> {
  try {
    return await invoke<string>("read_app_file", { appId, path });
  } catch {
    return null;
  }
}

/** Read multiple files; null entries for missing files. */
export async function readAppFiles(
  appId: string,
  paths: string[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const p of paths) {
    out[p] = await readAppFile(appId, p);
  }
  return out;
}

/** Write a single app file (creates parent dirs). */
export async function writeAppFile(
  appId: string,
  path: string,
  content: string,
): Promise<void> {
  await invoke("write_app_file", { appId, path, content });
}

/** Write multiple files in one IPC round trip. Returns count written. */
export async function writeAppFiles(
  appId: string,
  files: Record<string, string>,
): Promise<number> {
  const entries = Object.entries(files);
  return invoke<number>("write_app_files", {
    appId,
    files: entries,
  });
}

// ── Chat History (persisted per-app in SQLite; stub until P3) ─────────────

export async function getChatHistory(appId: string): Promise<any[]> {
  // P3: reads ~/deskspawn/apps/<id>/.deskspawn/chat.db via Rust IPC.
  // For now the engine keeps chat in memory; returning [] keeps parity with
  // a fresh web app.
  void appId;
  return [];
}

export async function saveChatHistory(
  appId: string,
  _messages: any[],
): Promise<void> {
  void appId;
  // P3: writes chat.db via Rust IPC.
}

// ── Settings (per-provider config; API keys stay in OS keychain) ──────────────

export async function saveProviderConfig(
  provider: string,
  config: unknown,
): Promise<void> {
  // P3: config persisted to ~/deskspawn/config/config.json via Rust IPC.
  // For now keep in localStorage so the desktop app behaves like web during
  // the transition.
  localStorage.setItem(`provider_config_${provider}`, JSON.stringify(config));
}

export async function loadProviderConfig(
  provider: string,
): Promise<unknown | null> {
  const raw = localStorage.getItem(`provider_config_${provider}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
