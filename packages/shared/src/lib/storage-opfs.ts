/**
 * OPFS (Origin Private File System) storage for app source files.
 *
 * Provides a file-system-like interface for reading/writing app files
 * (source code, config, etc.) within the browser's origin storage.
 *
 * Falls back to IndexedDB when OPFS is not available (Firefox, Safari).
 */

import { getSetting, setSetting } from "./storage";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileEntry {
  path: string;
  content: string;
}

export interface FileInfo {
  path: string;
  size: number;
  lastModified: string;
  isDirectory: boolean;
}

// ── OPFS Implementation ───────────────────────────────────────────────────────
// Uses the File System Access API's Origin Private File System.

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

function appDirName(appId: string): string {
  return `app_${appId}`;
}

async function ensureDir(dir: FileSystemDirectoryHandle, pathParts: string[]): Promise<FileSystemDirectoryHandle> {
  let current = dir;
  for (const part of pathParts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

async function readOpfsFile(appId: string, filePath: string): Promise<string | null> {
  try {
    const root = await getOpfsRoot();
    const appDir = await root.getDirectoryHandle(appDirName(appId), { create: false });
    const parts = filePath.split("/");
    const fileName = parts.pop()!;
    let current = appDir;
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create: false });
    }
    const fileHandle = await current.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

async function writeOpfsFile(appId: string, filePath: string, content: string): Promise<void> {
  const root = await getOpfsRoot();
  const appDir = await root.getDirectoryHandle(appDirName(appId), { create: true });
  const parts = filePath.split("/");
  const fileName = parts.pop()!;
  const parentDir = await ensureDir(appDir, parts);
  const fileHandle = await parentDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function deleteOpfsFile(appId: string, filePath: string): Promise<void> {
  try {
    const root = await getOpfsRoot();
    const appDir = await root.getDirectoryHandle(appDirName(appId), { create: false });
    const parts = filePath.split("/");
    const fileName = parts.pop()!;
    let current = appDir;
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create: false });
    }
    await current.removeEntry(fileName);
  } catch {
    // File may not exist
  }
}

async function listOpfsFiles(appId: string): Promise<FileInfo[]> {
  const result: FileInfo[] = [];
  try {
    const root = await getOpfsRoot();
    const appDir = await root.getDirectoryHandle(appDirName(appId), { create: false });
    await walkOpfsDir(appDir, "", result);
  } catch {
    // App directory doesn't exist yet
  }
  return result;
}

async function walkOpfsDir(
  dirHandle: FileSystemDirectoryHandle,
  prefix: string,
  result: FileInfo[],
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const [name, handle] of (dirHandle as any).entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      result.push({
        path,
        size: 0,
        lastModified: new Date().toISOString(),
        isDirectory: true,
      });
      await walkOpfsDir(handle, path, result);
    } else {
      const file = await (handle as FileSystemFileHandle).getFile();
      result.push({
        path,
        size: file.size,
        lastModified: new Date(file.lastModified).toISOString(),
        isDirectory: false,
      });
    }
  }
}

async function deleteOpfsDir(appId: string): Promise<void> {
  try {
    const root = await getOpfsRoot();
    await root.removeEntry(appDirName(appId), { recursive: true });
  } catch {
    // May not exist
  }
}

// ── IndexedDB Fallback Implementation ──────────────────────────────────────────
// Used when OPFS is not available (Firefox, Safari).

function idbAppKey(appId: string): string {
  return `app_files_${appId}`;
}

interface IdbAppStore {
  appId: string;
  files: Record<string, string>;
}

async function readIdbFile(appId: string, filePath: string): Promise<string | null> {
  const raw = await getSetting<IdbAppStore>(idbAppKey(appId));
  return raw?.files?.[filePath] ?? null;
}

async function writeIdbFile(appId: string, filePath: string, content: string): Promise<void> {
  const key = idbAppKey(appId);
  const raw = (await getSetting<IdbAppStore>(key)) || { appId, files: {} };
  raw.files[filePath] = content;
  await setSetting(key, raw);
}

async function deleteIdbFile(appId: string, filePath: string): Promise<void> {
  const key = idbAppKey(appId);
  const raw = await getSetting<IdbAppStore>(key);
  if (raw?.files) {
    delete raw.files[filePath];
    await setSetting(key, raw);
  }
}

async function listIdbFiles(appId: string): Promise<FileInfo[]> {
  const key = idbAppKey(appId);
  const raw = await getSetting<IdbAppStore>(key);
  if (!raw?.files) return [];
  return Object.entries(raw.files).map(([path, content]) => ({
    path,
    size: content.length,
    lastModified: new Date().toISOString(),
    isDirectory: false,
  }));
}

async function deleteIdbDir(appId: string): Promise<void> {
  const key = idbAppKey(appId);
  await setSetting(key, { appId, files: {} });
}

// ── Auto-detect OPFS availability ─────────────────────────────────────────────

let _opfsAvailable: boolean | null = null;

export async function isOpfsAvailable(): Promise<boolean> {
  if (_opfsAvailable !== null) return _opfsAvailable;
  try {
    const root = await navigator.storage?.getDirectory();
    if (root) {
      const testHandle = await root.getFileHandle("__ds_opfs_test", { create: true });
      const writer = await testHandle.createWritable();
      await writer.write("t");
      await writer.close();
      await root.removeEntry("__ds_opfs_test");
      _opfsAvailable = true;
    } else {
      _opfsAvailable = false;
    }
  } catch {
    _opfsAvailable = false;
  }
  return _opfsAvailable;
}

// ── Unified API (auto-routes to OPFS or IndexedDB) ────────────────────────────

/**
 * Desktop uses real files via Rust IPC (ADR-008); Web uses OPFS/IndexedDB.
 * The desktop adapter is imported lazily so the web bundle stays unaffected.
 */
function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { __DESKSPAWN_DESKTOP__?: boolean }).__DESKSPAWN_DESKTOP__);
}

export async function readAppFile(appId: string, filePath: string): Promise<string | null> {
  if (isDesktopRuntime()) {
    const { readAppFileDesktop } = await import("./storage-desktop");
    return readAppFileDesktop(appId, filePath);
  }
  if (await isOpfsAvailable()) {
    return readOpfsFile(appId, filePath);
  }
  return readIdbFile(appId, filePath);
}

export async function writeAppFile(appId: string, filePath: string, content: string): Promise<void> {
  if (isDesktopRuntime()) {
    const { writeAppFileDesktop } = await import("./storage-desktop");
    return writeAppFileDesktop(appId, filePath, content);
  }
  if (await isOpfsAvailable()) {
    return writeOpfsFile(appId, filePath, content);
  }
  return writeIdbFile(appId, filePath, content);
}

export async function deleteAppFile(appId: string, filePath: string): Promise<void> {
  if (isDesktopRuntime()) {
    // C1 fix (2026-08-12): previously wrote an empty string, leaving 0-byte
    // files behind. Now does a real deletion via Rust IPC.
    const { deleteAppFileDesktop } = await import("./storage-desktop");
    return deleteAppFileDesktop(appId, filePath);
  }
  if (await isOpfsAvailable()) {
    return deleteOpfsFile(appId, filePath);
  }
  return deleteIdbFile(appId, filePath);
}

export async function listAppFiles(appId: string): Promise<FileInfo[]> {
  if (isDesktopRuntime()) {
    const { listAppFilesDesktop } = await import("./storage-desktop");
    const relPaths = await listAppFilesDesktop(appId);
    // Map to FileInfo shape (web interface compatibility).
    return relPaths.map((p) => ({
      path: p,
      size: 0,
      lastModified: "",
      isDirectory: false,
    }));
  }
  if (await isOpfsAvailable()) {
    return listOpfsFiles(appId);
  }
  return listIdbFiles(appId);
}

export async function deleteAppDir(appId: string): Promise<void> {
  if (isDesktopRuntime()) {
    // C2 fix (2026-08-12): deleting the whole app is the responsibility of
    // deleteApp (Rust `delete_app` removes registry + directory). Calling
    // deleteAppDesktop here would double-delete — AppSwitcher already calls
    // deleteStoredApp() first. Desktop: no-op.
    return;
  }
  if (await isOpfsAvailable()) {
    return deleteOpfsDir(appId);
  }
  return deleteIdbDir(appId);
}

/**
 * Check if a file or directory exists in the app.
 */
export async function appFileExists(appId: string, filePath: string): Promise<boolean> {
  const content = await readAppFile(appId, filePath);
  return content !== null;
}

/**
 * Read multiple app files at once (batch operation).
 */
export async function readAppFiles(appId: string, filePaths: string[]): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  for (const fp of filePaths) {
    result[fp] = await readAppFile(appId, fp);
  }
  return result;
}

/**
 * Write multiple app files at once (batch operation).
 */
export async function writeAppFiles(appId: string, files: FileEntry[]): Promise<void> {
  for (const f of files) {
    await writeAppFile(appId, f.path, f.content);
  }
}
