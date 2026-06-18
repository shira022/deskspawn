/**
 * Project Seeding Utility — filesystem → OPFS
 *
 * When a project was created by the desktop (Tauri) version, its source files
 * exist on the filesystem but not in OPFS/IndexedDB. This utility fetches
 * them from the dev server API (configured in vite.config.ts) and writes
 * them into browser storage so the preview can access them.
 *
 * Usage:
 *   await seedProjectFromFilesystem("fdffec8c-6b5e-4acb-bd03-67f6eb1ffea2");
 *   await seedProjectFromWorkspace();
 */

import { listProjectFiles, writeProjectFile, projectFileExists } from "./storage-opfs";

const API_BASE = "/api/project-files";

interface ProjectFilesResponse {
  files: Record<string, string>;
  projectId: string;
}

/**
 * Seed a specific project's files from the filesystem into OPFS.
 * Skips files that already exist in OPFS (unless force=true).
 */
export async function seedProjectFromFilesystem(
  projectId: string,
  options?: { force?: boolean },
): Promise<{ seeded: number; skipped: number }> {
  try {
    const res = await fetch(`${API_BASE}/${projectId}`);
    if (!res.ok) {
      console.warn(`[seed] Project ${projectId} not found on filesystem, skipping`);
      return { seeded: 0, skipped: 0 };
    }

    const data: ProjectFilesResponse = await res.json();
    return writeFilesToOpfs(projectId, data.files, options);
  } catch (e) {
    console.warn(`[seed] Failed to seed project ${projectId}:`, e);
    return { seeded: 0, skipped: 0 };
  }
}

/**
 * Seed the current workspace files into OPFS for the given project ID.
 * This is used when the AI agent has generated code that exists in the
 * workspace/ directory on the filesystem but hasn't been synced to OPFS yet.
 */
export async function seedProjectFromWorkspace(
  projectId: string,
  options?: { force?: boolean },
): Promise<{ seeded: number; skipped: number }> {
  try {
    const res = await fetch(`${API_BASE}/_workspace_?type=workspace`);
    if (!res.ok) {
      console.warn(`[seed] Workspace files not found, skipping`);
      return { seeded: 0, skipped: 0 };
    }

    const data: ProjectFilesResponse = await res.json();
    return writeFilesToOpfs(projectId, data.files, options);
  } catch (e) {
    console.warn(`[seed] Failed to seed workspace:`, e);
    return { seeded: 0, skipped: 0 };
  }
}

/**
 * Write a set of files to OPFS for the given project.
 */
async function writeFilesToOpfs(
  projectId: string,
  files: Record<string, string>,
  options?: { force?: boolean },
): Promise<{ seeded: number; skipped: number }> {
  let seeded = 0;
  let skipped = 0;

  for (const [filePath, content] of Object.entries(files)) {
    // Skip node_modules and lockfiles
    if (filePath.startsWith("node_modules/") || filePath === "package-lock.json") continue;

    if (!options?.force) {
      const exists = await projectFileExists(projectId, filePath);
      if (exists) {
        skipped++;
        continue;
      }
    }

    try {
      await writeProjectFile(projectId, filePath, content);
      seeded++;
    } catch (e) {
      console.warn(`[seed] Failed to write ${filePath}:`, e);
    }
  }

  if (seeded > 0) {
    console.log(`[seed] Seeded ${seeded} files into OPFS for project ${projectId}${skipped > 0 ? ` (${skipped} skipped)` : ""}`);
  }

  return { seeded, skipped };
}

/**
 * Check if a project has any source files in OPFS.
 */
export async function hasProjectFiles(projectId: string): Promise<boolean> {
  try {
    const files = await listProjectFiles(projectId);
    // Filter to meaningful source files (ignore package-lock.json, node_modules, etc.)
    const sourceFiles = files.filter(
      (f) =>
        !f.isDirectory &&
        !f.path.startsWith("node_modules/") &&
        f.path !== "package-lock.json" &&
        (f.path.startsWith("src/") || f.path.startsWith("public/") || f.path === "index.html"),
    );
    return sourceFiles.length > 0;
  } catch {
    return false;
  }
}
