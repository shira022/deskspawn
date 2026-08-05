/**
 * Project export/import — zip-based backup and restore.
 *
 * Exports all project source files from OPFS into a downloadable .zip file,
 * and imports a .zip file back into OPFS + IndexedDB.
 */

import JSZip from "jszip";
import {
  listProjectFiles,
  readProjectFile,
  writeProjectFiles,
} from "@/lib/storage-opfs";
import { getProject } from "@/lib/storage";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExportMetadata {
  name: string;
  version: string;
  exportedAt: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const EXPORT_VERSION = "1.0";
const EXCLUDED_PATTERNS = [
  /^node_modules\//,
  /^\.git\//,
  /^dist\//,
  /^\.deskspawn\//,
  /^\.cache\//,
];

// ── Export ─────────────────────────────────────────────────────────────────────

/**
 * Export a project as a .zip file and trigger a browser download.
 *
 * @param projectId - The project ID to export.
 * @param projectName - Human-readable name for the filename and metadata.
 * @returns The blob URL for the generated zip, or null on failure.
 */
export async function exportProjectAsZip(
  projectId: string,
  projectName: string,
): Promise<void> {
  const zip = new JSZip();

  // 1. Read project metadata from IndexedDB
  const project = await getProject(projectId);
  const meta: ExportMetadata = {
    name: project?.name ?? projectName,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
  };
  zip.file("deskspawn.json", JSON.stringify(meta, null, 2));

  // 2. Read all source files from OPFS and add to zip
  const files = await listProjectFiles(projectId);
  let fileCount = 0;

  for (const file of files) {
    if (file.isDirectory) continue;

    // Skip excluded patterns
    if (EXCLUDED_PATTERNS.some((p) => p.test(file.path))) continue;

    const content = await readProjectFile(projectId, file.path);
    if (content !== null) {
      zip.file(file.path, content);
      fileCount++;
    }
  }

  if (fileCount === 0) {
    throw new Error("No source files found to export");
  }

  // 3. Generate zip blob and trigger download
  const blob = await zip.generateAsync({ type: "blob" });
  const safeName = projectName.replace(/[^a-zA-Z0-9_\-]/g, "_");
  const filename = `${safeName}.deskspawn.zip`;

  triggerDownload(blob, filename);
}

/**
 * Trigger a browser file download from a Blob.
 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a short delay to ensure the download has started
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── Import ─────────────────────────────────────────────────────────────────────

export interface ImportResult {
  projectId: string;
  projectName: string;
  filesImported: number;
}

/**
 * Import a project from a .zip file.
 *
 * Parses the zip, reads metadata, writes all source files to OPFS,
 * and registers the project in IndexedDB.
 *
 * @param file - The .zip file to import (from a file input).
 * @param newProjectId - A freshly generated UUID for this project.
 * @returns ImportResult with the new project ID and name.
 */
export async function importProjectFromZip(
  file: File,
  newProjectId: string,
): Promise<ImportResult> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. Read metadata
  const metaFile = zip.file("deskspawn.json");
  let projectName = file.name
    .replace(/\.deskspawn\.zip$/i, "")
    .replace(/\.zip$/i, "")
    .trim();
  if (metaFile) {
    try {
      const metaText = await metaFile.async("string");
      const meta: ExportMetadata = JSON.parse(metaText);
      if (meta.name) projectName = meta.name;
    } catch {
      // Use filename-derived name as fallback
    }
  }

  // 2. Collect all source files from the zip (skip metadata, excluded dirs)
  const entries: Array<{ path: string; content: string }> = [];

  for (const [path, zipEntry] of Object.entries(zip.files)) {
    // Skip directories and metadata
    if (zipEntry.dir) continue;
    if (path === "deskspawn.json") continue;

    // Skip excluded patterns
    if (EXCLUDED_PATTERNS.some((p) => p.test(path))) continue;

    const content = await zipEntry.async("string");
    entries.push({ path, content });
  }

  if (entries.length === 0) {
    throw new Error("No source files found in the archive");
  }

  // 3. Write all files to OPFS
  await writeProjectFiles(newProjectId, entries);

  return {
    projectId: newProjectId,
    projectName,
    filesImported: entries.length,
  };
}
