import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import type { Artifact, Action, FileAction, DiffAction, TemplateAction, ShellAction } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// sidecar/src/tool-executors.ts → project root → workspace/
const WORKSPACE_DIR = path.resolve(__dirname, '..', '..', 'workspace');

export function getWorkspaceDir(): string {
  return WORKSPACE_DIR;
}

// ── read_file ────────────────────────────────────────────────────────────────

export async function readFile(relativePath: string): Promise<string> {
  const fullPath = path.resolve(WORKSPACE_DIR, relativePath);
  if (!fullPath.startsWith(WORKSPACE_DIR)) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }
  const content = await fs.readFile(fullPath, 'utf-8');
  return content;
}

// ── list_files ──────────────────────────────────────────────────────────────

export interface FileEntry {
  path: string;
  size: number;
  lastModified: string;
  isDirectory: boolean;
}

export async function listFiles(): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  
  async function walk(dir: string, relative: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const rel = relative ? `${relative}/${e.name}` : e.name;
        
        // Skip excluded directories
        if (e.isDirectory()) {
          if (['node_modules', 'target', '.deskspawn', '.git', 'dist'].includes(e.name)) continue;
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
  
  await walk(WORKSPACE_DIR, '');
  return files;
}

// ── apply_artifact ──────────────────────────────────────────────────────────

export interface ApplyResult {
  success: boolean;
  filesChanged: string[];
  shellCommandsRun: string[];
  errors?: string[];
}

export async function applyArtifact(jsonStr: string): Promise<ApplyResult> {
  const result: ApplyResult = {
    success: true,
    filesChanged: [],
    shellCommandsRun: [],
    errors: [],
  };

  let artifact: Artifact;
  try {
    artifact = JSON.parse(jsonStr);
  } catch (e) {
    return { success: false, filesChanged: [], shellCommandsRun: [], errors: [`JSON parse error: ${e}`] };
  }

  if (!artifact.actions || !Array.isArray(artifact.actions)) {
    return { success: false, filesChanged: [], shellCommandsRun: [], errors: ['Missing actions array'] };
  }
  if (artifact.actions.length > 30) {
    return { success: false, filesChanged: [], shellCommandsRun: [], errors: ['Too many actions (max 30)'] };
  }

  for (const action of artifact.actions as Action[]) {
    try {
      if (action.type === 'file' && action.mode === 'file') {
        await executeFileAction(action, result);
      } else if (action.type === 'file' && action.mode === 'diff') {
        await executeDiffAction(action, result);
      } else if (action.type === 'shell') {
        await executeShellAction(action, result);
      } else if (action.type === 'template') {
        await executeTemplateAction(action, result);
      } else {
        result.errors!.push(`Unknown action type: ${JSON.stringify(action).substring(0, 100)}`);
        result.success = false;
      }
    } catch (e) {
      result.errors!.push(`${action.type}/${(action as any).mode}: ${e}`);
      result.success = false;
    }
  }
  console.log(`[apply_artifact] result: success=${result.success} changed=${result.filesChanged} errors=${result.errors?.length || 0}`);

  return result;
}

async function executeFileAction(action: FileAction, result: ApplyResult) {
  const fullPath = path.resolve(WORKSPACE_DIR, action.filePath);
  if (!fullPath.startsWith(WORKSPACE_DIR)) {
    throw new Error(`Path traversal: ${action.filePath}`);
  }
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, action.content, 'utf-8');
  result.filesChanged.push(action.filePath);
}

async function executeDiffAction(action: DiffAction, result: ApplyResult) {
  const fullPath = path.resolve(WORKSPACE_DIR, action.filePath);
  if (!fullPath.startsWith(WORKSPACE_DIR)) {
    throw new Error(`Path traversal: ${action.filePath}`);
  }
  const content = await fs.readFile(fullPath, 'utf-8');
  if (!content.includes(action.search)) {
    throw new Error(`Search pattern not found in ${action.filePath}: "${action.search.substring(0, 80)}..."`);
  }
  // Count occurrences - must be unique
  const count = content.split(action.search).length - 1;
  if (count === 0) {
    throw new Error(`Search pattern not found: ${action.filePath}`);
  }
  if (count > 1) {
    throw new Error(`Search pattern matches ${count} times (must be unique): ${action.filePath}`);
  }
  const newContent = content.replace(action.search, action.replace);
  await fs.writeFile(fullPath, newContent, 'utf-8');
  result.filesChanged.push(action.filePath);
}

async function executeShellAction(action: ShellAction, result: ApplyResult) {
  const cmd = action.command.trim();
  // Simple allowlist check
  const allowed = ['npm', 'npx', 'cargo', 'sqlx'];
  const firstWord = cmd.split(/\s+/)[0];
  if (!allowed.includes(firstWord)) {
    throw new Error(`Command not allowed: ${firstWord}. Allowed: ${allowed.join(', ')}`);
  }
  try {
    execSync(cmd, { cwd: WORKSPACE_DIR, encoding: 'utf-8', timeout: 120_000, stdio: 'pipe' });
    result.shellCommandsRun.push(cmd);
  } catch (e: any) {
    result.errors!.push(`Shell command failed: ${cmd}\n${e.stderr || e.message}`);
  }
}

async function executeTemplateAction(action: TemplateAction, result: ApplyResult) {
  const { tableName, columns } = action;
  const pascalName = tableName.charAt(0).toUpperCase() + tableName.slice(1);
  
  // SQL migration
  const colDefs = columns.map((c: any) => {
    let def = `  ${c.name} ${c.sqlType}`;
    if (!c.nullable) def += ' NOT NULL';
    if (c.defaultValue !== undefined) def += ` DEFAULT ${c.defaultValue}`;
    return def;
  }).join(',\n');
  
  const migration = `-- @deskspawn:generated ${tableName}_crud
CREATE TABLE IF NOT EXISTS ${tableName} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
${colDefs},
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- @deskspawn:end
`;
  const migPath = `migrations/0001_create_${tableName}.sql`;
  await fs.mkdir(path.join(WORKSPACE_DIR, 'migrations'), { recursive: true });
  await fs.writeFile(path.join(WORKSPACE_DIR, migPath), migration, 'utf-8');
  result.filesChanged.push(migPath);
  
  // TypeScript types
  const tsFields = columns.map((c: any) => {
    let tsType = 'string';
    if (c.sqlType === 'INTEGER') tsType = 'number';
    else if (c.sqlType === 'REAL') tsType = 'number';
    else if (c.sqlType === 'BOOLEAN') tsType = 'boolean';
    return `  ${c.name}: ${tsType};`;
  }).join('\n');
  
  const typesFile = `// @deskspawn:generated ${tableName}_types
export interface ${pascalName} {
  id: number;
${tsFields}
  created_at: string;
}
// @deskspawn:end
`;
  const typesPath = `src/types/${tableName}.ts`;
  await fs.mkdir(path.join(WORKSPACE_DIR, 'src/types'), { recursive: true });
  await fs.writeFile(path.join(WORKSPACE_DIR, typesPath), typesFile, 'utf-8');
  result.filesChanged.push(typesPath);
}

// ── get_errors ──────────────────────────────────────────────────────────────

export async function getErrors(): Promise<{ type: string; message: string; filePath?: string }[]> {
  const errors: { type: string; message: string; filePath?: string }[] = [];
  
  try {
    execSync('npx tsc --noEmit', { cwd: WORKSPACE_DIR, encoding: 'utf-8', timeout: 30_000, stdio: 'pipe' });
  } catch (e: any) {
    const output = e.stdout || e.stderr || e.message || '';
    for (const line of output.split('\n')) {
      const match = line.match(/^(.+?)\((\d+),\d+\):\s+(error\s+\w+):\s+(.+)/);
      if (match) {
        errors.push({ type: 'typescript', message: line.trim(), filePath: match[1] });
      }
    }
  }
  
  return errors;
}
