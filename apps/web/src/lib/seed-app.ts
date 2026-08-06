/**
 * App Seeding Utility — filesystem → OPFS
 *
 * When an app was created by the desktop (Tauri) version, its source files
 * exist on the filesystem but not in OPFS/IndexedDB. This utility fetches
 * them from the dev server API (configured in vite.config.ts) and writes
 * them into browser storage so the preview can access them.
 *
 * Usage:
 *   await seedAppFromFilesystem("fdffec8c-6b5e-4acb-bd03-67f6eb1ffea2");
 *   await seedAppFromWorkspace();
 */

import { listAppFiles, writeAppFile, appFileExists } from "./storage-opfs";

const API_BASE = "/api/app-files";

interface AppFilesResponse {
  files: Record<string, string>;
  appId: string;
}

/**
 * Seed a specific app's files from the filesystem into OPFS.
 * Skips files that already exist in OPFS (unless force=true).
 */
export async function seedAppFromFilesystem(
  appId: string,
  options?: { force?: boolean },
): Promise<{ seeded: number; skipped: number }> {
  try {
    const res = await fetch(`${API_BASE}/${appId}`);
    if (!res.ok) {
      console.warn(`[seed] App ${appId} not found on filesystem, skipping`);
      return { seeded: 0, skipped: 0 };
    }

    const data: AppFilesResponse = await res.json();
    return writeFilesToOpfs(appId, data.files, options);
  } catch (e) {
    console.warn(`[seed] Failed to seed app ${appId}:`, e);
    return { seeded: 0, skipped: 0 };
  }
}

/**
 * Seed the current workspace files into OPFS for the given app ID.
 * This is used when the AI agent has generated code that exists in the
 * workspace/ directory on the filesystem but hasn't been synced to OPFS yet.
 */
export async function seedAppFromWorkspace(
  appId: string,
  options?: { force?: boolean },
): Promise<{ seeded: number; skipped: number }> {
  try {
    const res = await fetch(`${API_BASE}/_workspace_?type=workspace`);
    if (!res.ok) {
      console.warn(`[seed] Workspace files not found, skipping`);
      return { seeded: 0, skipped: 0 };
    }

    const data: AppFilesResponse = await res.json();
    return writeFilesToOpfs(appId, data.files, options);
  } catch (e) {
    console.warn(`[seed] Failed to seed workspace:`, e);
    return { seeded: 0, skipped: 0 };
  }
}

/**
 * Write a set of files to OPFS for the given app.
 */
async function writeFilesToOpfs(
  appId: string,
  files: Record<string, string>,
  options?: { force?: boolean },
): Promise<{ seeded: number; skipped: number }> {
  let seeded = 0;
  let skipped = 0;

  for (const [filePath, content] of Object.entries(files)) {
    // Skip node_modules and lockfiles
    if (filePath.startsWith("node_modules/") || filePath === "package-lock.json") continue;

    if (!options?.force) {
      const exists = await appFileExists(appId, filePath);
      if (exists) {
        skipped++;
        continue;
      }
    }

    try {
      await writeAppFile(appId, filePath, content);
      seeded++;
    } catch (e) {
      console.warn(`[seed] Failed to write ${filePath}:`, e);
    }
  }

  if (seeded > 0) {
    console.log(`[seed] Seeded ${seeded} files into OPFS for app ${appId}${skipped > 0 ? ` (${skipped} skipped)` : ""}`);
  }

  return { seeded, skipped };
}

/**
 * Check if an app has any source files in OPFS.
 */
export async function hasAppFiles(appId: string): Promise<boolean> {
  try {
    const files = await listAppFiles(appId);
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
