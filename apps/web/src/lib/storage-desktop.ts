/**
 * Desktop storage adapter — real files on disk via Rust IPC.
 *
 * Desktop-only (see ADR-008). The web version keeps IndexedDB/OPFS.
 * All project data lives under `~/deskspawn/projects/<projectId>/` and the
 * registry lives in `~/deskspawn/projects/projects.json`.
 *
 * API shape mirrors apps/web/src/lib/storage.ts so the shared engine and
 * UI can swap adapters transparently via isDesktopEnv().
 *
 * NOTE: @tauri-apps/api is imported dynamically so the web bundle is never
 * affected (matches the existing pattern in storage.ts for API keys).
 */

// ── Types (mirror of storage.ts) ──────────────────────────────────────────────

export interface StoredProject {
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

export async function listProjectsDesktop(): Promise<StoredProject[]> {
  const metas = await tauriInvoke<Array<{
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
  }>>("list_projects");
  return metas.map(mapProjectMeta);
}

export async function getProjectDesktop(id: string): Promise<StoredProject | null> {
  const projects = await listProjectsDesktop();
  return projects.find((p) => p.id === id) ?? null;
}

export async function saveProjectDesktop(project: StoredProject): Promise<void> {
  const existing = await getProjectDesktop(project.id);
  if (!existing) {
    const created = await tauriInvoke<{
      id: string;
      name: string;
      created_at: string;
      updated_at: string;
    }>("create_project", { name: project.name });
    if (created.id !== project.id) {
      console.warn(
        `[storage-desktop] backend id ${created.id} differs from caller id ${project.id}`,
      );
    }
  }
}

export async function deleteProjectDesktop(id: string): Promise<void> {
  await tauriInvoke("delete_project", { projectId: id });
}

// ── Project File Operations (real files on disk) ──────────────────────────────

/** List project source files (relative paths, excludes node_modules/.git). */
export async function listProjectFilesDesktop(projectId: string): Promise<string[]> {
  return tauriInvoke<string[]>("list_project_files", { projectId });
}

/** Read a single project file. Returns null if missing. */
export async function readProjectFileDesktop(
  projectId: string,
  path: string,
): Promise<string | null> {
  try {
    return await tauriInvoke<string>("read_project_file", { projectId, path });
  } catch {
    return null;
  }
}

/** Read multiple files; null entries for missing files. */
export async function readProjectFilesDesktop(
  projectId: string,
  paths: string[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const p of paths) {
    out[p] = await readProjectFileDesktop(projectId, p);
  }
  return out;
}

/** Write a single project file (creates parent dirs). */
export async function writeProjectFileDesktop(
  projectId: string,
  path: string,
  content: string,
): Promise<void> {
  await tauriInvoke("write_project_file", { projectId, path, content });
}

/** Write multiple files in one IPC round trip. Returns count written. */
export async function writeProjectFilesDesktop(
  projectId: string,
  files: Record<string, string>,
): Promise<number> {
  const entries = Object.entries(files);
  return tauriInvoke<number>("write_project_files", {
    projectId,
    files: entries,
  });
}

/** Desktop adapter detection used by storage.ts. */
export function isDesktopStorageActive(): boolean {
  return isDesktopRuntime();
}
