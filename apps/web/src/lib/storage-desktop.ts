/**
 * Desktop storage adapter — real files on disk via Rust IPC.
 *
 * Desktop-only (see ADR-008). The web version keeps IndexedDB/OPFS.
 * All app data lives under `~/deskspawn/apps/<appId>/` and the
 * registry lives in `~/deskspawn/apps/apps.json`.
 *
 * API shape mirrors apps/web/src/lib/storage.ts so the shared engine and
 * UI can swap adapters transparently via isDesktopEnv().
 *
 * NOTE: @tauri-apps/api is imported dynamically so the web bundle is never
 * affected (matches the existing pattern in storage.ts for API keys).
 */

// ── Types (mirror of storage.ts) ──────────────────────────────────────────────

export interface StoredApp {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ── Tauri IPC helper ──────────────────────────────────────────────────────────

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** True when running inside Tauri (desktop). */
function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { __DESKSPAWN_DESKTOP__?: boolean }).__DESKSPAWN_DESKTOP__);
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

export async function listAppsDesktop(): Promise<StoredApp[]> {
  const metas = await tauriInvoke<Array<{
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
  }>>("list_apps");
  return metas.map(mapAppMeta);
}

export async function getAppDesktop(id: string): Promise<StoredApp | null> {
  const apps = await listAppsDesktop();
  return apps.find((p) => p.id === id) ?? null;
}

/**
 * Persist an app. On desktop the Rust backend owns the registry and
 * assigns its own id (`app-...`); that id is returned so callers use the
 * REAL directory id (the caller's temporary UUID would not match any
 * on-disk app dir).
 */
export async function saveAppDesktop(app: StoredApp): Promise<string> {
  const existing = await getAppDesktop(app.id);
  if (existing) {
    return existing.id;
  }
  const created = await tauriInvoke<{
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
  }>("create_app", { name: app.name });
  return created.id;
}

export async function deleteAppDesktop(id: string): Promise<void> {
  await tauriInvoke("delete_app", { appId: id });
}

// ── App File Operations (real files on disk) ──────────────────────────────

/** List app source files (relative paths, excludes node_modules/.git). */
export async function listAppFilesDesktop(appId: string): Promise<string[]> {
  return tauriInvoke<string[]>("list_app_files", { appId });
}

/** Read a single app file. Returns null if missing. */
export async function readAppFileDesktop(
  appId: string,
  path: string,
): Promise<string | null> {
  try {
    return await tauriInvoke<string>("read_app_file", { appId, path });
  } catch {
    return null;
  }
}

/** Read multiple files; null entries for missing files. */
export async function readAppFilesDesktop(
  appId: string,
  paths: string[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const p of paths) {
    out[p] = await readAppFileDesktop(appId, p);
  }
  return out;
}

/** Write a single app file (creates parent dirs). */
export async function writeAppFileDesktop(
  appId: string,
  path: string,
  content: string,
): Promise<void> {
  await tauriInvoke("write_app_file", { appId, path, content });
}

/** Write multiple files in one IPC round trip. Returns count written. */
export async function writeAppFilesDesktop(
  appId: string,
  files: Record<string, string>,
): Promise<number> {
  const entries = Object.entries(files);
  return tauriInvoke<number>("write_app_files", {
    appId,
    files: entries,
  });
}

/** Desktop adapter detection used by storage.ts. */
export function isDesktopStorageActive(): boolean {
  return isDesktopRuntime();
}

// ── Chat History (persisted per-app in SQLite via Rust IPC, ADR-009) ──────

/** Chat message shape returned by the Rust backend. */
export interface ChatMessage {
  id: number;
  role: string;
  content: string;
  created_at: string;
}

/** Load chat history from the app's SQLite DB (Rust side). */
export async function getChatHistoryDesktop(appId: string): Promise<any[]> {
  try {
    const msgs = await tauriInvoke<ChatMessage[]>("get_chat_history", { appId });
    return msgs.map((m) => ({ role: m.role, content: m.content }));
  } catch (e) {
    console.warn("[storage-desktop] get_chat_history failed:", e);
    return [];
  }
}

/** Append the latest chat message to the app's SQLite DB (Rust side). */
export async function saveChatHistoryDesktop(
  appId: string,
  messages: any[],
): Promise<void> {
  try {
    // Persist incrementally: the last message is the new one.
    const last = messages[messages.length - 1];
    if (last && typeof last.role === "string" && typeof last.content === "string") {
      await tauriInvoke("append_chat_message", {
        appId,
        role: last.role,
        content: last.content,
      });
    }
  } catch (e) {
    console.warn("[storage-desktop] append_chat_message failed:", e);
  }
}
