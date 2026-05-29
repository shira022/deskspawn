import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import type { Artifact, Action, TemplateAction } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// sidecar/src/tool-executors.ts → project root
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_WORKSPACE = path.resolve(PROJECT_ROOT, 'workspace');

// Security server (Rust) endpoint for all file/shell operations
const SECURITY_SERVER_PORT = process.env.DESKSPAWN_SECURITY_PORT;
const SECURITY_SERVER_URL = SECURITY_SERVER_PORT
  ? `http://127.0.0.1:${SECURITY_SERVER_PORT}`
  : null;

if (!SECURITY_SERVER_URL) {
  console.warn('[tool-executors] DESKSPAWN_SECURITY_PORT not set — security server unavailable!');
}

// Mutable workspace directory - can be changed via setWorkspaceDir()
let _workspaceDir = DEFAULT_WORKSPACE;

export function setWorkspaceDir(dir: string) {
  _workspaceDir = path.resolve(dir);
  console.log(`[tool-executors] Workspace dir set to: ${_workspaceDir}`);
  // Notify the Rust security server about the workspace change
  if (SECURITY_SERVER_URL) {
    fetch(`${SECURITY_SERVER_URL}/api/update-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: _workspaceDir }),
    }).catch((err) => console.warn('[tool-executors] Failed to update workspace in security server:', err.message));
  }
}

export function getWorkspaceDir(): string {
  return _workspaceDir;
}

// Shared constants
export const IGNORED_DIRS = ['node_modules', 'target', '.deskspawn', '.git', 'dist'];

// ── Security server HTTP helper ──────────────────────────────────────────────

function securityUrl(endpoint: string): string {
  if (!SECURITY_SERVER_URL) {
    throw new Error('Security server not available (DESKSPAWN_SECURITY_PORT not set)');
  }
  return `${SECURITY_SERVER_URL}${endpoint}`;
}

async function securityPost(endpoint: string, body: unknown): Promise<any> {
  const res = await fetch(securityUrl(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Security server error (${res.status})`);
  }
  return data;
}

// ── read_file ────────────────────────────────────────────────────────────────

export async function readFile(relativePath: string, _workspaceDir?: string): Promise<string> {
  // Always route through Rust security server for path validation
  const { content } = await securityPost('/api/read-file', { path: relativePath });
  return content;
}

// ── list_files ──────────────────────────────────────────────────────────────

export interface FileEntry {
  path: string;
  size: number;
  lastModified: string;
  isDirectory: boolean;
}

export async function listFiles(workspaceDir?: string): Promise<FileEntry[]> {
  const root = workspaceDir || getWorkspaceDir();
  const files: FileEntry[] = [];
  
  async function walk(dir: string, relative: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const rel = relative ? `${relative}/${e.name}` : e.name;
        
        // Skip excluded directories
        if (e.isDirectory()) {
          if (IGNORED_DIRS.includes(e.name)) continue;
          await walk(full, rel);
        } else {
          const stat = await fs.stat(full);
          files.push({
            path: rel,
            size: stat.size,
            lastModified: stat.mtime.toISOString(),
            isDirectory: false,
          });
        }
      }
    } catch { /* skip inaccessible dirs */ }
  }
  
  await walk(root, '');
  return files;
}

// ── apply_artifact ──────────────────────────────────────────────────────────

export interface ApplyResult {
  success: boolean;
  filesChanged: string[];
  shellCommandsRun: string[];
  errors?: string[];
}

// Maximum content size for a single file action before auto-splitting
const MAX_FILE_CONTENT_CHARS = 50_000;

export async function applyArtifact(artifact: Artifact, workspaceDir?: string): Promise<ApplyResult> {
  const root = workspaceDir || getWorkspaceDir();
  const result: ApplyResult = {
    success: true,
    filesChanged: [],
    shellCommandsRun: [],
    errors: [],
  };

  if (!artifact.actions || !Array.isArray(artifact.actions)) {
    return { success: false, filesChanged: [], shellCommandsRun: [], errors: ['Missing actions array'] };
  }
  if (artifact.actions.length > 30) {
    return { success: false, filesChanged: [], shellCommandsRun: [], errors: ['Too many actions (max 30)'] };
  }

  // Split actions: file/diff/shell → Rust security server, template → local
  const securityActions: any[] = [];

  for (const action of artifact.actions as Action[]) {
    if (action.type === 'template') {
      // Template actions are handled locally (generate CRUD hooks within workspace)
      try {
        await executeTemplateAction(action, result, root);
      } catch (e) {
        result.errors!.push(`template: ${e}`);
        result.success = false;
      }
    } else if (action.type === 'file' && action.mode === 'file') {
      // Large file actions: write directly (avoids JSON serialization issues)
      if (action.content && action.content.length > MAX_FILE_CONTENT_CHARS) {
        console.log(`[split] Large file action (${action.content.length} chars) for ${action.filePath}, writing directly via Rust...`);
        try {
          await securityPost('/api/apply-artifact', {
            actions: [{ type: 'file', file_path: action.filePath, content: action.content, mode: 'file' }],
          });
          result.filesChanged.push(action.filePath);
          console.log(`[split] Direct write succeeded for ${action.filePath}`);
        } catch (e: any) {
          result.errors!.push(`file/file: ${e.message || e}`);
          result.success = false;
        }
      } else {
        securityActions.push({
          type: 'file',
          file_path: action.filePath,
          content: action.content,
          mode: 'file',
        });
      }
    } else if (action.type === 'file' && action.mode === 'diff') {
      securityActions.push({
        type: 'diff',
        file_path: action.filePath,
        search: action.search,
        content: action.replace,
      });
    } else if (action.type === 'shell') {
      securityActions.push({
        type: 'shell',
        command: action.command,
      });
    } else {
      result.errors!.push(`Unknown action type: ${JSON.stringify(action).substring(0, 100)}`);
      result.success = false;
    }
  }

  // Send file/diff/shell actions to Rust security server
  if (securityActions.length > 0) {
    try {
      const rustResult = await securityPost('/api/apply-artifact', {
        name: 'artifact',
        actions: securityActions,
      });
      result.filesChanged.push(...(rustResult.filesChanged || []));
      result.shellCommandsRun.push(...(rustResult.shellCommandsRun || []));
      if (rustResult.errors && rustResult.errors.length > 0) {
        result.errors!.push(...rustResult.errors);
        result.success = false;
      }
    } catch (e: any) {
      result.errors!.push(`Security server error: ${e.message || e}`);
      result.success = false;
    }
  }

  console.log(`[apply_artifact] result: success=${result.success} changed=${result.filesChanged.length} errors=${result.errors?.length || 0}`);

  return result;
}

// ── run_shell (via Rust security server) ─────────────────────────────────────

export interface ShellExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runShell(command: string): Promise<ShellExecResult> {
  try {
    const result = await securityPost('/api/run-shell', { command });
    return {
      success: result.exit_code === 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.exit_code ?? 1,
    };
  } catch (e: any) {
    return {
      success: false,
      stdout: '',
      stderr: e.message || 'Command execution failed',
      exitCode: 1,
    };
  }
}

// ── Template CRUD generation helpers ─────────────────────────────────────────

function toPascalCase(s: string): string {
  return s.split('_').filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function toSnakeCase(s: string): string {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase()).replace(/^_/, '');
}

function sqlToTsType(sqlType: string, nullable: boolean): string {
  let base = 'string';
  switch (sqlType.toUpperCase()) {
    case 'INTEGER': case 'INT': case 'BIGINT': base = 'number'; break;
    case 'REAL': case 'FLOAT': case 'DOUBLE': base = 'number'; break;
    case 'BOOLEAN': case 'BOOL': base = 'boolean'; break;
  }
  return nullable ? `${base} | null` : base;
}


async function executeTemplateAction(action: TemplateAction, result: ApplyResult, workspaceRoot: string) {
  const { tableName, columns: rawColumns } = action;
  const pascalName = toPascalCase(tableName);
  const snakeName = toSnakeCase(tableName);

  // ── Prevent duplicate timestamp columns ─────────────────────────────
  const AUTO_COLUMNS = ['created_at', 'updated_at'];
  const columns = rawColumns.filter((c: any) => !AUTO_COLUMNS.includes(c.name));

  let effectiveColumns = columns;
  if (columns.length === 0) {
    effectiveColumns = [
      { name: 'id', sqlType: 'INTEGER', nullable: false, primaryKey: true },
    ];
    result.errors?.push(`All columns were auto-generated timestamps; added default 'id' column.`);
  }

  const idTsType = effectiveColumns.find((c: any) => c.primaryKey)?.sqlType?.toUpperCase() === 'INTEGER' ? 'number' : 'string';

  // ── Generate TypeScript hooks using storage adapter ──────────────
  const tsColumns = effectiveColumns.filter((c: any) => c.name !== (effectiveColumns.find((col: any) => col.primaryKey)?.name || 'id'));
  const tsFields = tsColumns.map((c: any) => `  ${c.name}: ${sqlToTsType(c.sqlType, c.nullable)};`).join('\n');
  const collectionName = snakeName;

  const tsHooks = `// @deskspawn:generated table=${snakeName}
// Auto-generated React hooks for ${pascalName}
// Uses the storage adapter (@/lib/storage) — IndexedDB with auto file backup.

import { getStorage } from "@/lib/storage";

export interface ${pascalName} {
  id: ${idTsType};
${tsFields}
  created_at: string;
  updated_at: string | null;
}

const COLLECTION = "${collectionName}";

export async function get${pascalName}s(): Promise<${pascalName}[]> {
  return getStorage().getAll<${pascalName}>(COLLECTION);
}

export async function get${pascalName}ById(id: ${idTsType}): Promise<${pascalName} | null> {
  return getStorage().getById<${pascalName}>(COLLECTION, String(id));
}

export async function create${pascalName}(data: Omit<${pascalName}, "id" | "created_at" | "updated_at">): Promise<${pascalName}> {
  return getStorage().create<${pascalName}>(COLLECTION, data);
}

export async function update${pascalName}(id: ${idTsType}, data: Partial<Omit<${pascalName}, "id">>): Promise<${pascalName}> {
  return getStorage().update<${pascalName}>(COLLECTION, String(id), data);
}

export async function delete${pascalName}(id: ${idTsType}): Promise<void> {
  return getStorage().remove(COLLECTION, String(id));
}
// @deskspawn:end
`;

  const hooksPath = `src/hooks/use${pascalName}.ts`;
  await fs.mkdir(path.join(workspaceRoot, 'src', 'hooks'), { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, hooksPath), tsHooks, 'utf-8');
  result.filesChanged.push(hooksPath);

  console.log(`[template] Generated CRUD for ${tableName}: TS types + storage adapter hooks`);
}


// ── get_errors ──────────────────────────────────────────────────────────────

export interface ErrorEntry {
  type: 'typescript';
  /** Machine-readable pattern label for AI-driven auto-recovery. */
  pattern:
    | 'missing_module'
    | 'missing_component'
    | 'missing_command'
    | 'type_error'
    | 'syntax_error'
    | 'not_found'
    | 'unknown';
  message: string;
  filePath?: string;
  line?: number;
  /** Actionable suggestion in Japanese for the AI to self-correct. */
  suggestion?: string;
}

/**
 * Classify a TypeScript error message into a pattern label + suggestion.
 */
function classifyTsError(message: string, filePath?: string): Pick<ErrorEntry, 'pattern' | 'suggestion'> {
  const m = message.toLowerCase();

  // Missing module import (e.g. lucide-react)
  if (m.includes('cannot find module') || m.includes('cannot find name') || m.includes('module not found')) {
    const missing = message.match(/['"]([^'"]+)['"]/)?.[1];
    return {
      pattern: 'missing_module',
      suggestion: missing
        ? `モジュール '${missing}' が見つかりません。run_shell で "npm install ${missing}" を実行してください。`
        : '不足しているモジュールがあります。npm install でインストールしてください。',
    };
  }

  // Missing UI component (e.g. @/components/ui/Button)
  if (m.includes('cannot find module') && filePath?.includes('@/components/ui/')) {
    return {
      pattern: 'missing_component',
      suggestion: `${filePath} が見つかりません。適用可能な shadcn/ui パターンがない場合、よりシンプルな Tailwind CSS ベースのコンポーネントを作成してください。例: div + Tailwind utility classes + lucide-react アイコン。`,
    };
  }

  // URI resolve issue (import path not found)
  if (m.includes('failed to resolve') && (filePath?.includes('@/') || filePath?.includes('/ui/'))) {
    return {
      pattern: 'missing_component',
      suggestion: `'${filePath}' のインポートパスが間違っているか、ファイルが存在しません。ファイルを作成するか、パスを修正してください。`,
    };
  }

  // Type error (assignability, type mismatch)
  if (m.includes('is not assignable') || m.includes('type') && m.includes('is not') || m.includes('property') && m.includes('does not exist')) {
    return {
      pattern: 'type_error',
      suggestion: '型定義と実際の使用が一致していません。型定義ファイル (src/types/*.ts) を確認し、必要に応じて修正または新しい型を追加してください。',
    };
  }

  // Syntax error
  if (m.includes('unterminated') || m.includes('unexpected token') || m.includes('expression expected')) {
    return {
      pattern: 'syntax_error',
      suggestion: '構文エラーです。括弧やセミコロン、引用符が正しく閉じられているか確認してください。',
    };
  }

  // Default
  return { pattern: 'type_error', suggestion: undefined };
}

/**
 * Run TypeScript compiler check and return structured errors.
 * Shell execution goes through the Rust security server.
 */
async function getTsErrors(): Promise<ErrorEntry[]> {
  const errors: ErrorEntry[] = [];
  try {
    // Run tsc via the Rust security server (validated command allowlist)
    const result = await securityPost('/api/run-shell', { command: 'npx tsc --noEmit' });
    // If exit code is 0, no errors — success path returns stdout
    if (result.exit_code === 0) return errors;
    const output = result.stderr || result.stdout || '';
    for (const line of output.split('\n')) {
      const match = line.match(/^(.+?)\((\d+),\d+\):\s+(error\s+\w+):\s+(.+)/);
      if (match) {
        const filePath = match[1];
        const lineNum = parseInt(match[2], 10);
        const message = line.trim();
        const { pattern, suggestion } = classifyTsError(message, filePath);
        errors.push({
          type: 'typescript' as const,
          pattern,
          message,
          filePath,
          line: lineNum,
          suggestion,
        });
      }
    }
  } catch (e: any) {
    console.warn('[getTsErrors] Failed to run tsc via security server:', e.message || e);
  }
  return errors;
}

/**
 * Collect all project errors (TypeScript).
 * Each error includes a pattern classification and actionable suggestion
 * so the AI agent can autonomously decide how to fix it.
 */
export async function getErrors(_workspaceDir?: string): Promise<ErrorEntry[]> {
  const errors: ErrorEntry[] = [];

  // Gather TS errors (shell execution via Rust security server)
  const tsErrors = await getTsErrors();
  errors.push(...tsErrors);

  return errors;
}

// ── Checkpoint System ──────────────────────────────────────────────────────────

const CHECKPOINTS_DIR_NAME = 'checkpoints';

/**
 * Create a full snapshot of the project source files (excluding ignored dirs).
 * Returns a unique checkpoint ID. If `checkpointId` is provided, uses that
 * instead of generating a random one (useful for the initial checkpoint).
 */
export async function createCheckpoint(workspaceDir: string, checkpointId?: string): Promise<string> {
  const deskspawnDir = path.join(workspaceDir, '.deskspawn');
  const checkpointsDir = path.join(deskspawnDir, CHECKPOINTS_DIR_NAME);
  fsSync.mkdirSync(checkpointsDir, { recursive: true });

  const id = checkpointId || crypto.randomUUID();
  const destDir = path.join(checkpointsDir, id);
  fsSync.mkdirSync(destDir, { recursive: true });

  copyProjectFilesSync(workspaceDir, destDir, workspaceDir);
  console.log(`[checkpoint] Created checkpoint ${id} (${destDir})`);
  return id;
}

/**
 * Restore project files from a checkpoint.
 */
export async function restoreCheckpoint(workspaceDir: string, checkpointId: string): Promise<void> {
  const srcDir = path.join(workspaceDir, '.deskspawn', CHECKPOINTS_DIR_NAME, checkpointId);

  if (!fsSync.existsSync(srcDir)) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }

  // Remove all project source files (preserve .deskspawn, node_modules, target, dist, .git)
  clearProjectFilesSync(workspaceDir);

  // Copy back from checkpoint
  copyProjectFilesSync(srcDir, workspaceDir, srcDir);
  console.log(`[checkpoint] Restored checkpoint ${checkpointId}`);
}

/**
 * List checkpoints for a workspace, newest first.
 */
export function listCheckpoints(workspaceDir: string): { id: string; createdAt: Date }[] {
  const checkpointsDir = path.join(workspaceDir, '.deskspawn', CHECKPOINTS_DIR_NAME);
  if (!fsSync.existsSync(checkpointsDir)) return [];

  const entries = fsSync.readdirSync(checkpointsDir, { withFileTypes: true });
  const checkpoints: { id: string; createdAt: Date }[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const stat = fsSync.statSync(path.join(checkpointsDir, entry.name));
      checkpoints.push({ id: entry.name, createdAt: stat.birthtime || stat.mtime });
    }
  }

  checkpoints.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return checkpoints;
}

/**
 * Delete all checkpoints created after the given checkpoint ID.
 * The checkpoints list is newest-first, so we keep everything from `checkpointId` and older.
 */
export function deleteCheckpointsAfter(workspaceDir: string, beforeCheckpointId: string): void {
  const all = listCheckpoints(workspaceDir);
  const idx = all.findIndex((cp) => cp.id === beforeCheckpointId);
  if (idx === -1) return; // not found, nothing to do

  // `all` is newest-first, so the first `idx` entries are newer than beforeCheckpointId
  const toDelete = all.slice(0, idx);
  const checkpointsDir = path.join(workspaceDir, '.deskspawn', CHECKPOINTS_DIR_NAME);
  for (const cp of toDelete) {
    const cpDir = path.join(checkpointsDir, cp.id);
    try {
      fsSync.rmSync(cpDir, { recursive: true, force: true });
      console.log(`[checkpoint] Deleted checkpoint ${cp.id}`);
    } catch (e) {
      console.warn(`[checkpoint] Failed to delete ${cp.id}:`, e);
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function copyProjectFilesSync(srcDir: string, dstDir: string, rootDir: string) {
  const entries = fsSync.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    // Skip ignored directories (relative to the root)
    if (entry.isDirectory() && IGNORED_DIRS.includes(entry.name)) continue;

    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);

    if (entry.isDirectory()) {
      fsSync.mkdirSync(dstPath, { recursive: true });
      copyProjectFilesSync(srcPath, dstPath, rootDir);
    } else {
      try {
        fsSync.copyFileSync(srcPath, dstPath);
      } catch (e) {
        console.warn(`[checkpoint] Failed to copy ${srcPath}: ${e}`);
      }
    }
  }
}

function clearProjectFilesSync(workspaceDir: string) {
  const entries = fsSync.readdirSync(workspaceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.includes(entry.name)) continue;
    const fullPath = path.join(workspaceDir, entry.name);
    try {
      fsSync.rmSync(fullPath, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[checkpoint] Failed to remove ${fullPath}: ${e}`);
    }
  }
}
