/**
 * Desktop storage adapter — real files on disk via Rust IPC.
 *
 * Desktop-only (see ADR-008). The web version keeps IndexedDB/OPFS.
 * All project data lives under `~/deskspawn/projects/<projectId>/` and the
 * registry lives in `~/deskspawn/projects/projects.json`.
 *
 * API shape mirrors apps/web/src/lib/storage.ts so the shared engine and
 * UI can swap adapters transparently via isDesktopEnv().
 */

import { invoke } from "@tauri-apps/api/core";

// ── Types (mirror of storage.ts) ──────────────────────────────────────────────

export interface StoredProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ── Project Operations (Rust IPC) ─────────────────────────────────────────────

/** Map Rust ProjectMeta (snake_case) to the shared StoredProject shape. */
function mapProjectMeta(meta: {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}): StoredProject {
  return {
    id: meta.id,
    name: meta.name,
    createdAt: meta.created_at,
    updatedAt: meta.updated_at,
  };
}

export async function listProjects(): Promise<StoredProject[]> {
  const metas = await invoke<Array<{
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
  }>>("list_projects");
  return metas.map(mapProjectMeta);
}

export async function getProject(id: string): Promise<StoredProject | null> {
  const projects = await listProjects();
  return projects.find((p) => p.id === id) ?? null;
}

export async function saveProject(project: StoredProject): Promise<void> {
  // The registry is source of truth on disk; create updates name only.
  // (Rust create_project requires a name; for updates we keep it simple and
  //  treat save as create-if-missing with the given metadata.)
  const existing = await getProject(project.id);
  if (!existing) {
    const created = await invoke<{
      id: string;
      name: string;
      created_at: string;
      updated_at: string;
    }>("create_project", { name: project.name });
    // Keep the caller's id if the backend assigned a different one? The
    // backend always generates its own id; propagate it back.
    if (created.id !== project.id) {
      // The caller created the project before backend registration; rename
      // is not supported — log a warning for now.
      console.warn(
        `[storage-desktop] backend id ${created.id} differs from caller id ${project.id}`,
      );
    }
  }
}

export async function deleteProject(id: string): Promise<void> {
  await invoke("delete_project", { projectId: id });
}

// ── Project File Operations (real files on disk) ──────────────────────────────

/** List project source files (relative paths, excludes node_modules/.git). */
export async function listProjectFiles(projectId: string): Promise<string[]> {
  return invoke<string[]>("list_project_files", { projectId });
}

/** Read a single project file. Returns null if missing. */
export async function readProjectFile(
  projectId: string,
  path: string,
): Promise<string | null> {
  try {
    return await invoke<string>("read_project_file", { projectId, path });
  } catch {
    return null;
  }
}

/** Read multiple files; null entries for missing files. */
export async function readProjectFiles(
  projectId: string,
  paths: string[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const p of paths) {
    out[p] = await readProjectFile(projectId, p);
  }
  return out;
}

/** Write a single project file (creates parent dirs). */
export async function writeProjectFile(
  projectId: string,
  path: string,
  content: string,
): Promise<void> {
  await invoke("write_project_file", { projectId, path, content });
}

/** Write multiple files in one IPC round trip. Returns count written. */
export async function writeProjectFiles(
  projectId: string,
  files: Record<string, string>,
): Promise<number> {
  const entries = Object.entries(files);
  return invoke<number>("write_project_files", {
    projectId,
    files: entries,
  });
}

// ── Chat History (persisted per-project in SQLite; stub until P3) ─────────────

export async function getChatHistory(projectId: string): Promise<any[]> {
  // P3: reads ~/deskspawn/projects/<id>/.deskspawn/chat.db via Rust IPC.
  // For now the engine keeps chat in memory; returning [] keeps parity with
  // a fresh web project.
  void projectId;
  return [];
}

export async function saveChatHistory(
  projectId: string,
  _messages: any[],
): Promise<void> {
  void projectId;
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
