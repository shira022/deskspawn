/**
 * OPFS (Origin Private File System) storage for project source files.
 *
 * Provides a file-system-like interface for reading/writing project files
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

function projectDirName(projectId: string): string {
  return `project_${projectId}`;
}

async function ensureDir(dir: FileSystemDirectoryHandle, pathParts: string[]): Promise<FileSystemDirectoryHandle> {
  let current = dir;
  for (const part of pathParts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

async function readOpfsFile(projectId: string, filePath: string): Promise<string | null> {
  try {
    const root = await getOpfsRoot();
    const projectDir = await root.getDirectoryHandle(projectDirName(projectId), { create: false });
    const parts = filePath.split("/");
    const fileName = parts.pop()!;
    let current = projectDir;
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

async function writeOpfsFile(projectId: string, filePath: string, content: string): Promise<void> {
  const root = await getOpfsRoot();
  const projectDir = await root.getDirectoryHandle(projectDirName(projectId), { create: true });
  const parts = filePath.split("/");
  const fileName = parts.pop()!;
  const parentDir = await ensureDir(projectDir, parts);
  const fileHandle = await parentDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function deleteOpfsFile(projectId: string, filePath: string): Promise<void> {
  try {
    const root = await getOpfsRoot();
    const projectDir = await root.getDirectoryHandle(projectDirName(projectId), { create: false });
    const parts = filePath.split("/");
    const fileName = parts.pop()!;
    let current = projectDir;
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create: false });
    }
    await current.removeEntry(fileName);
  } catch {
    // File may not exist
  }
}

async function listOpfsFiles(projectId: string): Promise<FileInfo[]> {
  const result: FileInfo[] = [];
  try {
    const root = await getOpfsRoot();
    const projectDir = await root.getDirectoryHandle(projectDirName(projectId), { create: false });
    await walkOpfsDir(projectDir, "", result);
  } catch {
    // Project directory doesn't exist yet
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

async function deleteOpfsDir(projectId: string): Promise<void> {
  try {
    const root = await getOpfsRoot();
    await root.removeEntry(projectDirName(projectId), { recursive: true });
  } catch {
    // May not exist
  }
}

// ── IndexedDB Fallback Implementation ──────────────────────────────────────────
// Used when OPFS is not available (Firefox, Safari).

function idbProjectKey(projectId: string): string {
  return `project_files_${projectId}`;
}

interface IdbProjectStore {
  projectId: string;
  files: Record<string, string>;
}

async function readIdbFile(projectId: string, filePath: string): Promise<string | null> {
  const raw = await getSetting<IdbProjectStore>(idbProjectKey(projectId));
  return raw?.files?.[filePath] ?? null;
}

async function writeIdbFile(projectId: string, filePath: string, content: string): Promise<void> {
  const key = idbProjectKey(projectId);
  const raw = (await getSetting<IdbProjectStore>(key)) || { projectId, files: {} };
  raw.files[filePath] = content;
  await setSetting(key, raw);
}

async function deleteIdbFile(projectId: string, filePath: string): Promise<void> {
  const key = idbProjectKey(projectId);
  const raw = await getSetting<IdbProjectStore>(key);
  if (raw?.files) {
    delete raw.files[filePath];
    await setSetting(key, raw);
  }
}

async function listIdbFiles(projectId: string): Promise<FileInfo[]> {
  const key = idbProjectKey(projectId);
  const raw = await getSetting<IdbProjectStore>(key);
  if (!raw?.files) return [];
  return Object.entries(raw.files).map(([path, content]) => ({
    path,
    size: content.length,
    lastModified: new Date().toISOString(),
    isDirectory: false,
  }));
}

async function deleteIdbDir(projectId: string): Promise<void> {
  const key = idbProjectKey(projectId);
  await setSetting(key, { projectId, files: {} });
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

export async function readProjectFile(projectId: string, filePath: string): Promise<string | null> {
  if (await isOpfsAvailable()) {
    return readOpfsFile(projectId, filePath);
  }
  return readIdbFile(projectId, filePath);
}

export async function writeProjectFile(projectId: string, filePath: string, content: string): Promise<void> {
  if (await isOpfsAvailable()) {
    return writeOpfsFile(projectId, filePath, content);
  }
  return writeIdbFile(projectId, filePath, content);
}

export async function deleteProjectFile(projectId: string, filePath: string): Promise<void> {
  if (await isOpfsAvailable()) {
    return deleteOpfsFile(projectId, filePath);
  }
  return deleteIdbFile(projectId, filePath);
}

export async function listProjectFiles(projectId: string): Promise<FileInfo[]> {
  if (await isOpfsAvailable()) {
    return listOpfsFiles(projectId);
  }
  return listIdbFiles(projectId);
}

export async function deleteProjectDir(projectId: string): Promise<void> {
  if (await isOpfsAvailable()) {
    return deleteOpfsDir(projectId);
  }
  return deleteIdbDir(projectId);
}

/**
 * Check if a file or directory exists in the project.
 */
export async function projectFileExists(projectId: string, filePath: string): Promise<boolean> {
  const content = await readProjectFile(projectId, filePath);
  return content !== null;
}

/**
 * Read multiple project files at once (batch operation).
 */
export async function readProjectFiles(projectId: string, filePaths: string[]): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  for (const fp of filePaths) {
    result[fp] = await readProjectFile(projectId, fp);
  }
  return result;
}

/**
 * Write multiple project files at once (batch operation).
 */
export async function writeProjectFiles(projectId: string, files: FileEntry[]): Promise<void> {
  for (const f of files) {
    await writeProjectFile(projectId, f.path, f.content);
  }
}
