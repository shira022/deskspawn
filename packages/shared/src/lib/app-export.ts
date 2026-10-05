/**
 * App export/import — zip-based backup and restore.
 *
 * Exports all app source files from OPFS into a downloadable .zip file,
 * and imports a .zip file back into OPFS + IndexedDB.
 */

import JSZip from "jszip";
import {
  listAppFiles,
  readAppFile,
  writeAppFiles,
} from "./storage-opfs";
import { getApp } from "./storage";

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
  /(^|\/)\.env$/, // シークレットを含み得る環境変数ファイル（M1）
  /(^|\/)\.env\.[^/]+$/, // .env.local / .env.production 等（.env.example はテンプレートとして許可）
];

/** zip エントリの単一ファイル上限（10MB） */
const MAX_ENTRY_SIZE = 10 * 1024 * 1024;
/** zip 全体の合計上限（50MB） */
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;
/** zip の最大ファイル数（1000） */
const MAX_FILE_COUNT = 1000;

/**
 * zip エントリパスの安全性チェック（zip slip 対策 / M1）。
 * - `..` による親ディレクトリ脱出を拒否
 * - 絶対パス / Windows ドライブパス / バックスラッシュを拒否
 */
export function isZipEntrySafe(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\")) return false;
  if (path.length >= 2 && path.charCodeAt(1) === 0x3a /* ':' */) return false;
  for (const comp of path.split("/")) {
    if (!comp || comp === "." || comp === "..") return false;
  }
  return true;
}

// ── Export ─────────────────────────────────────────────────────────────────────

/**
 * Export an app as a .zip file and trigger a browser download.
 *
 * @param appId - The app ID to export.
 * @param appName - Human-readable name for the filename and metadata.
 * @returns The blob URL for the generated zip, or null on failure.
 */
export async function exportAppAsZip(
  appId: string,
  appName: string,
): Promise<void> {
  const zip = new JSZip();

  // 1. Read app metadata from IndexedDB
  const app = await getApp(appId);
  const meta: ExportMetadata = {
    name: app?.name ?? appName,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
  };
  zip.file("deskspawn.json", JSON.stringify(meta, null, 2));

  // 2. Read all source files from OPFS and add to zip
  const files = await listAppFiles(appId);
  let fileCount = 0;

  for (const file of files) {
    if (file.isDirectory) continue;

    // Skip excluded patterns
    if (EXCLUDED_PATTERNS.some((p) => p.test(file.path))) continue;
    if (!isZipEntrySafe(file.path)) continue;

    const content = await readAppFile(appId, file.path);
    if (content !== null) {
      if (content.length > MAX_ENTRY_SIZE) {
        throw new Error(`File too large to export: ${file.path}`);
      }
      zip.file(file.path, content);
      fileCount++;
      if (fileCount > MAX_FILE_COUNT) {
        throw new Error("Too many files to export (max 1000)");
      }
    }
  }

  if (fileCount === 0) {
    throw new Error("No source files found to export");
  }

  // 3. Generate zip blob and trigger download
  const blob = await zip.generateAsync({ type: "blob" });
  const safeName = appName.replace(/[^a-zA-Z0-9_\-]/g, "_");
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
  appId: string;
  appName: string;
  filesImported: number;
}

/**
 * Import an app from a .zip file.
 *
 * Parses the zip, reads metadata, writes all source files to OPFS,
 * and registers the app in IndexedDB.
 *
 * @param file - The .zip file to import (from a file input).
 * @param newAppId - A freshly generated UUID for this app.
 * @returns ImportResult with the new app ID and name.
 */
export async function importAppFromZip(
  file: File,
  newAppId: string,
): Promise<ImportResult> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. Read metadata
  const metaFile = zip.file("deskspawn.json");
  let appName = file.name
    .replace(/\.deskspawn\.zip$/i, "")
    .replace(/\.zip$/i, "")
    .trim();
  if (metaFile) {
    try {
      const metaText = await metaFile.async("string");
      const meta: ExportMetadata = JSON.parse(metaText);
      if (meta.name) appName = meta.name;
    } catch {
      // Use filename-derived name as fallback
    }
  }

  // 2. Collect all source files from the zip (skip metadata, excluded dirs)
  const entries: Array<{ path: string; content: string }> = [];
  let totalSize = 0;

  for (const [path, zipEntry] of Object.entries(zip.files)) {
    // Skip directories and metadata
    if (zipEntry.dir) continue;
    if (path === "deskspawn.json") continue;

    // Skip excluded patterns
    if (EXCLUDED_PATTERNS.some((p) => p.test(path))) continue;
    // zip slip 対策: 親ディレクトリ脱出・絶対パスを拒否
    if (!isZipEntrySafe(path)) {
      throw new Error(`Unsafe zip entry rejected: ${path}`);
    }
    if (entries.length >= MAX_FILE_COUNT) {
      throw new Error("Too many files in archive (max 1000)");
    }

    const content = await zipEntry.async("string");
    // サイズ制限（単一・合計）
    if (content.length > MAX_ENTRY_SIZE) {
      throw new Error(`File too large in archive: ${path}`);
    }
    totalSize += content.length;
    if (totalSize > MAX_TOTAL_SIZE) {
      throw new Error("Archive too large (max 50MB total)");
    }
    entries.push({ path, content });
  }

  if (entries.length === 0) {
    throw new Error("No source files found in the archive");
  }

  // 3. Write all files to OPFS
  await writeAppFiles(newAppId, entries);

  return {
    appId: newAppId,
    appName,
    filesImported: entries.length,
  };
}
