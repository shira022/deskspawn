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

/** Delete a single app file (real deletion — C1 fix 2026-08-12). */
export async function deleteAppFileDesktop(appId: string, path: string): Promise<void> {
  await tauriInvoke("delete_app_file", { appId, path });
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

// ── Chat History (per-app SQLite via Rust IPC, ADR-009 / ADR-013) ──────────
//
// v2 (ADR-013): the FULL frontend message object (stepLogs, phaseOutputs,
// usage, checkpointId, timestamp) is stored as a JSON `payload` column so a
// reload restores the chat exactly as the UI rendered it. Writes are
// replace-all (the frontend sends its complete message list) and serialized
// through a promise queue so overlapping add/update calls cannot race.

/** Chat message row shape returned by the Rust backend. */
export interface ChatMessageRow {
  client_id: string | null;
  role: string;
  content: string;
  payload: string | null;
  created_at: string | null;
}

/** Serialized write queue — guarantees replace-all saves cannot interleave. */
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Load chat history from the app's SQLite DB (full fidelity). */
export async function getChatHistoryDesktop(appId: string): Promise<any[]> {
  try {
    const rows = await tauriInvoke<ChatMessageRow[]>("get_chat_history", { appId });
    return rows.map((m) => {
      if (m.payload) {
        try {
          const parsed = JSON.parse(m.payload);
          if (parsed && typeof parsed === "object" && typeof parsed.role === "string") {
            return parsed;
          }
        } catch {
          // Fall through to the column-based reconstruction below.
        }
      }
      // Legacy v1 row (no payload): reconstruct a minimal frontend message.
      return {
        id: m.client_id ?? `legacy-${m.created_at ?? Date.now()}`,
        role: m.role,
        content: m.content,
        timestamp: (m.created_at ? Date.parse(m.created_at) : NaN) || Date.now(),
      };
    });
  } catch (e) {
    console.error("[storage-desktop] get_chat_history failed:", e);
    return [];
  }
}

/** Replace-all save of the app's complete chat history (atomic on the Rust side). */
export async function saveChatHistoryDesktop(
  appId: string,
  messages: any[],
): Promise<void> {
  const input = messages
    .filter((m) => m && typeof m.role === "string")
    .map((m) => ({
      client_id:
        typeof m.id === "string" && m.id.length > 0
          ? m.id
          : `msg-${typeof m.timestamp === "number" ? m.timestamp : Date.now()}`,
      role: m.role,
      content: typeof m.content === "string" ? m.content : "",
      payload: JSON.stringify(m),
      created_at: undefined,
    }));
  return enqueueWrite(async () => {
    await tauriInvoke("save_chat_messages", { appId, messages: input });
  });
}
