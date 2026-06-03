/**
 * HTTP server for the DeskSpawn sidecar.
 * Provides a REST API for the frontend to call for AI-powered code generation.
 * For dev/demo mode, tools are executed directly (not via Rust IPC).
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { ChildProcess, spawn, execSync, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getModel } from './providers.js';
import { tools } from './tools.js';
import * as executors from './tool-executors.js';
import { getModelsForProvider } from './models-fetcher.js';
import { takeScreenshot } from './screenshot.js';
import { runWithTriage, getPhaseLabel } from './orchestrator.js';
import { initMCPClients, getMCPTools, closeMCPClients } from './mcp-client.js';
// preview import removed — no longer needed (no Tauri backend)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ── In-memory API key store (received from Rust backend, never from frontend) ─
let storedApiKey: string | null = null;
const PROJECTS_DIR = path.join(PROJECT_ROOT, 'projects');
const PROJECTS_JSON = path.join(PROJECTS_DIR, 'projects.json');
const TEMPLATE_DIR = path.join(PROJECT_ROOT, 'templates', 'react-template');
const WORKSPACE_DEV_PORT = 5174;
let workspaceDevActualPort = WORKSPACE_DEV_PORT;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Port resolution with fallback ────────────────────────────────────────────
const DESIRED_PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
let ACTUAL_PORT = DESIRED_PORT;

// ── Unhandled error resilience ───────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[sidecar] UNCAUGHT EXCEPTION — sidecar continuing:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[sidecar] UNHANDLED REJECTION — sidecar continuing:', reason);
});

// ── Workspace dev server process management ─────────────────────────────────

let workspaceDevProcess: ChildProcess | null = null;
let workspaceDevReady = false;

// ── Project registry helpers ─────────────────────────────────────────────────

interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

function ensureProjectsDir() {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

function readProjectsJson(): ProjectMeta[] {
  ensureProjectsDir();
  try {
    if (fs.existsSync(PROJECTS_JSON)) {
      const raw = fs.readFileSync(PROJECTS_JSON, 'utf-8');
      return JSON.parse(raw) as ProjectMeta[];
    }
  } catch (e) {
    console.warn('[projects] Failed to read projects.json, starting fresh:', e);
  }
  return [];
}

function saveProjectsJson(projects: ProjectMeta[]) {
  ensureProjectsDir();
  fs.writeFileSync(PROJECTS_JSON, JSON.stringify(projects, null, 2), 'utf-8');
}

function createProjectDir(projectId: string, name: string): string {
  const projectDir = path.join(PROJECTS_DIR, projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  // Copy template files
  if (fs.existsSync(TEMPLATE_DIR)) {
    copyDir(TEMPLATE_DIR, projectDir);
    console.log(`[projects] Copied template to ${projectDir}`);
  } else {
    // Minimal scaffold (fallback)
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'src', 'main.tsx'), `
import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-8">
    <div className="text-center space-y-4">
      <h1 className="text-2xl font-bold">${name}</h1>
      <p className="text-muted-foreground">Your new app has been created.</p>
      <p className="text-sm text-muted-foreground">Use the AI chat to build your app.</p>
    </div>
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
`);
    fs.writeFileSync(path.join(projectDir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${name}</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>`);

    const pkg = {
      name: name.toLowerCase().replace(/\s+/g, '-'),
      private: true, version: '0.1.0', type: 'module',
      scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
      dependencies: {
        react: '^18.3.1', 'react-dom': '^18.3.1',
        clsx: '^2.1.1', 'tailwind-merge': '^2.6.0',
      },
      devDependencies: {
        '@tailwindcss/vite': '^4.3.0', '@types/react': '^18.3.12',
        '@types/react-dom': '^18.3.1', '@vitejs/plugin-react': '^4.3.4',
        tailwindcss: '^4.3.0', typescript: '~5.6.3', vite: '^6.0.0',
      },
    };
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify(pkg, null, 2));
    fs.writeFileSync(path.join(projectDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler',
        jsx: 'react-jsx', strict: true, esModuleInterop: true,
        skipLibCheck: true, forceConsistentCasingInFileNames: true,
        baseUrl: '.', paths: { '@/*': ['./src/*'] },
      }, include: ['src'],
    }, null, 2));
    fs.writeFileSync(path.join(projectDir, 'vite.config.ts'), `
import path from "path";
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { port: ${WORKSPACE_DEV_PORT}, strictPort: false, watch: { ignored: ['**/.deskspawn/**'] } },
  css: { transformer: 'lightningcss' },
});
`);
  }

  // Generate IndexedDB storage adapter
  generateStorageAdapterFiles(projectDir);

  // Write project metadata
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    name, createdAt: now, updatedAt: now,
  }, null, 2));

  return projectDir;
}

const BACKUP_FILENAME = '.deskspawn/data-backup.json';

/**
 * Generate IndexedDB storage adapter files in src/lib/.
 */
function generateStorageAdapterFiles(projectDir: string) {
  const libDir = path.join(projectDir, 'src', 'lib');
  fs.mkdirSync(libDir, { recursive: true });

  // ── Common interface ──────────────────────────────────────────────
  fs.writeFileSync(path.join(libDir, 'storage.ts'), `// ============================================================
// Storage Adapter Interface
// ============================================================
//
// 全てのデータ保存操作はこのインターフェースを通じて行います。
// 実装は storage-idb.ts (IndexedDB) にあります。
//
// ============================================================

export interface StorageAdapter {
  getAll<T extends { id: string }>(collection: string): Promise<T[]>;
  getById<T extends { id: string }>(collection: string, id: string): Promise<T | null>;
  create<T extends { id: string }>(collection: string, item: Omit<T, 'id' | 'created_at' | 'updated_at'>): Promise<T>;
  update<T extends { id: string }>(collection: string, id: string, item: Partial<Omit<T, 'id'>>): Promise<T>;
  remove(collection: string, id: string): Promise<void>;
  clear(collection: string): Promise<void>;
}

let _instance: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!_instance) throw new Error('Storage not initialized. Call initStorage() first.');
  return _instance;
}

export async function initStorage(appId?: string): Promise<StorageAdapter> {
  const { IndexedDBAdapter } = await import('./storage-idb');
  _instance = await IndexedDBAdapter.create(appId);
  return _instance!;
}
`);

  // ── IndexedDB with auto file backup ───────────────────────────────
  fs.writeFileSync(path.join(libDir, 'storage-idb.ts'), `// ============================================================
// IndexedDB Storage Adapter + Auto File Backup
// ============================================================
//
// IndexedDB をプライマリストレージとして使用し、全変更を
// DeskSpawn サイドカー経由でファイルにも書き出します。
// アプリ起動時に IndexedDB が空の場合はバックアップから復元します。
//
// ============================================================

import type { StorageAdapter } from './storage';

const BACKUP_URL = "http://localhost:3001/data-backup";

export class IndexedDBAdapter implements StorageAdapter {
  private db: IDBDatabase | null = null;
  private dbName: string;

  private constructor(dbName: string) {
    this.dbName = dbName;
  }

  static async create(appId?: string): Promise<IndexedDBAdapter> {
    const name = appId ? \`deskspawn_app_\${appId}\` : 'deskspawn_app';
    const adapter = new IndexedDBAdapter(name);
    await adapter.init();
    return adapter;
  }

  private async init() {
    this.db = await openDB(this.dbName);
    // 起動時: IndexedDB が空ならバックアップから復元
    if (this.db && (await this.isEmpty())) {
      await this.restoreFromBackup();
    }
  }

  private async isEmpty(): Promise<boolean> {
    // Check if any collection exists with data
    const storeNames = Array.from(this.db!.objectStoreNames).filter(n => n !== '_meta');
    for (const name of storeNames) {
      const count = await new Promise<number>((resolve, reject) => {
        const tx = this.db!.transaction(name, 'readonly');
        const req = tx.objectStore(name).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (count > 0) return false;
    }
    return true;
  }

  private async exportAllCollections(): Promise<Record<string, unknown[]>> {
    const data: Record<string, unknown[]> = {};
    const storeNames = Array.from(this.db!.objectStoreNames).filter(n => n !== '_meta');
    for (const name of storeNames) {
      const items = await new Promise<unknown[]>((resolve, reject) => {
        const tx = this.db!.transaction(name, 'readonly');
        const req = tx.objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      data[name] = items;
    }
    return data;
  }

  private async syncBackup(): Promise<void> {
    try {
      const data = await this.exportAllCollections();
      await fetch(BACKUP_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collections: data }),
      });
    } catch {
      // サイドカーが利用不可でもアプリは動作継続
    }
  }

  private async restoreFromBackup(): Promise<void> {
    try {
      const res = await fetch(BACKUP_URL);
      if (!res.ok) return;
      const { collections } = await res.json();
      if (!collections || typeof collections !== 'object') return;

      for (const [collection, items] of Object.entries(collections)) {
        if (!Array.isArray(items) || items.length === 0) continue;
        await this.ensureCollection(collection);
        const tx = this.db!.transaction(collection, 'readwrite');
        const store = tx.objectStore(collection);
        for (const item of items) {
          store.put(item);
        }
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
      console.log(\`[storage] Restored \${Object.keys(collections).length} collections from backup\`);
    } catch {
      // サイドカーが利用不可でもアプリは動作継続
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async ensureCollection(collection: string): Promise<void> {
    const newDb = await ensureCollectionInternal(this.db!, collection);
    if (newDb) this.db = newDb;
  }

  private async mutate<T>(fn: () => Promise<T>): Promise<T> {
    const result = await fn();
    this.syncBackup(); // fire-and-forget: 変更のたびにファイルバックアップ
    return result;
  }

  // ── StorageAdapter implementation ─────────────────────────────────

  async getAll<T extends { id: string }>(collection: string): Promise<T[]> {
    await this.ensureCollection(collection);
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(collection, 'readonly');
      const req = tx.objectStore(collection).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  }

  async getById<T extends { id: string }>(collection: string, id: string): Promise<T | null> {
    await this.ensureCollection(collection);
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(collection, 'readonly');
      const req = tx.objectStore(collection).get(id);
      req.onsuccess = () => resolve((req.result as T) || null);
      req.onerror = () => reject(req.error);
    });
  }

  async create<T extends { id: string }>(collection: string, item: Omit<T, 'id' | 'created_at' | 'updated_at'>): Promise<T> {
    return this.mutate(async () => {
      await this.ensureCollection(collection);
      const now = new Date().toISOString();
      const doc = { ...item, id: crypto.randomUUID(), created_at: now, updated_at: now };
      return new Promise<T>((resolve, reject) => {
        const tx = this.db!.transaction(collection, 'readwrite');
        const req = tx.objectStore(collection).add(doc);
        req.onsuccess = () => resolve(doc as unknown as T);
        req.onerror = () => reject(req.error);
      });
    });
  }

  async update<T extends { id: string }>(collection: string, id: string, item: Partial<Omit<T, 'id'>>): Promise<T> {
    return this.mutate(async () => {
      await this.ensureCollection(collection);
      return new Promise<T>((resolve, reject) => {
        const tx = this.db!.transaction(collection, 'readwrite');
        const store = tx.objectStore(collection);
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const updated = { ...getReq.result, ...item, id, updated_at: new Date().toISOString() };
          const putReq = store.put(updated);
          putReq.onsuccess = () => resolve(updated as T);
          putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
      });
    });
  }

  async remove(collection: string, id: string): Promise<void> {
    return this.mutate(async () => {
      await this.ensureCollection(collection);
      return new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction(collection, 'readwrite');
        const req = tx.objectStore(collection).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  async clear(collection: string): Promise<void> {
    return this.mutate(async () => {
      await this.ensureCollection(collection);
      return new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction(collection, 'readwrite');
        const req = tx.objectStore(collection).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }
}

// ── Module-level helpers ───────────────────────────────────────────────

function openDB(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('_meta')) {
        db.createObjectStore('_meta', { keyPath: 'key' });
      }
    };
    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
    request.onerror = (event) => reject((event.target as IDBOpenDBRequest).error);
  });
}

async function ensureCollectionInternal(db: IDBDatabase, collection: string): Promise<IDBDatabase | null> {
  if (db.objectStoreNames.contains(collection)) return null;
  return new Promise((resolve, reject) => {
    const version = db.version + 1;
    db.close();
    const request = indexedDB.open(db.name, version);
    request.onupgradeneeded = (event) => {
      const newDb = (event.target as IDBOpenDBRequest).result;
      if (!newDb.objectStoreNames.contains(collection)) {
        newDb.createObjectStore(collection, { keyPath: 'id' });
      }
    };
    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
    request.onerror = (event) => reject((event.target as IDBOpenDBRequest).error);
  });
}
`);
}


function copyDir(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      if (executors.IGNORED_DIRS.includes(entry.name)) continue;
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// ── Workspace dev server management ──────────────────────────────────────────

/**
 * Ensure the project's Vite config ignores .deskspawn/ so checkpoint
 * file operations don't trigger unnecessary HMR full-page reloads.
 */
function patchViteConfigForDotDeskspawn(projectDir: string) {
  const viteConfigPath = path.join(projectDir, 'vite.config.ts');
  try {
    if (!fs.existsSync(viteConfigPath)) return;
    let content = fs.readFileSync(viteConfigPath, 'utf-8');
    // Only patch if the watch.ignored for .deskspawn is not already present
    if (content.includes('.deskspawn')) return;

    // Add watch.ignored before the closing of the server block.
    // Heuristic: find `strictPort: false` and insert after it.
    const search = 'strictPort: false';
    if (content.includes(search)) {
      const replacement = `${search},\n    watch: { ignored: ['**/.deskspawn/**'] }`;
      content = content.replace(search, replacement);
      fs.writeFileSync(viteConfigPath, content, 'utf-8');
      console.log(`[devserver] Patched vite.config.ts to ignore .deskspawn/`);
    }
  } catch (e) {
    console.warn(`[devserver] Failed to patch vite.config.ts:`, e);
  }
}

function stopWorkspaceDevServer() {
  if (workspaceDevProcess) {
    console.log('[devserver] Stopping workspace dev server...');
    workspaceDevProcess.kill('SIGTERM');
    // Also kill any child processes
    try { process.kill(-workspaceDevProcess.pid!, 'SIGTERM'); } catch {}
    workspaceDevProcess = null;
    workspaceDevReady = false;
  }
}

/**
 * Kill any orphan process that might be holding the workspace dev port,
 * e.g. from a previous Tauri session that didn't clean up.
 */
function killOrphanDevServer() {
  try {
    const pid = execSync(`lsof -ti:${WORKSPACE_DEV_PORT} 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 }).trim();
    if (pid) {
      console.log(`[devserver] Killing orphan process (PID: ${pid}) on port ${WORKSPACE_DEV_PORT}...`);
      execSync(`kill -9 ${pid} 2>/dev/null`, { timeout: 3000 });
      // Give the port time to be released
      execSync(`sleep 0.5`);
    }
  } catch {
    // No orphan process — good
  }
}

function startWorkspaceDevServer(dir: string) {
  stopWorkspaceDevServer();
  killOrphanDevServer();

  console.log(`[devserver] Starting dev server in ${dir}...`);
  workspaceDevReady = false;

  // Ensure the project's vite.config.ts ignores .deskspawn/ to prevent
  // unnecessary HMR reloads when checkpoints are created/restored.
  patchViteConfigForDotDeskspawn(dir);

  const child = spawn('npm', ['run', 'dev'], {
    cwd: dir,
    stdio: 'pipe',
    detached: true,
    shell: true,
    env: { ...process.env, PORT: String(WORKSPACE_DEV_PORT) },
  });

  workspaceDevProcess = child;

  child.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    console.log(`[devserver] ${text.trim()}`);
    // Parse actual port from Vite's "Local:" line, e.g. "➜  Local:   http://localhost:5174/"
    const portMatch = text.match(/Local:\s+https?:\/\/localhost:(\d+)/);
    if (portMatch) {
      const parsedPort = parseInt(portMatch[1], 10);
      if (!isNaN(parsedPort)) {
        workspaceDevActualPort = parsedPort;
        console.log(`[devserver] Detected actual port: ${parsedPort}`);
      }
      workspaceDevReady = true;
      console.log('[devserver] Workspace dev server is ready');
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    console.warn(`[devserver:err] ${data.toString().trim()}`);
  });

  child.on('exit', (code) => {
    console.log(`[devserver] Exited with code ${code}`);
    workspaceDevReady = false;
    if (workspaceDevProcess === child) {
      workspaceDevProcess = null;
    }
  });

  child.on('error', (err) => {
    console.error(`[devserver] Failed to start: ${err.message}`);
    workspaceDevReady = false;
    workspaceDevProcess = null;
  });
}

function installDeps(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[projects] Installing dependencies in ${dir}...`);
    const child = spawn('npm', ['install', '--ignore-scripts'], {
      cwd: dir,
      stdio: 'pipe',
      shell: true,
    });
    let output = '';
    child.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { output += d.toString(); });
    child.on('exit', (code) => {
      if (code === 0) {
        console.log('[projects] Dependencies installed');
        resolve();
      } else {
        reject(new Error(`npm install exited with code ${code}: ${output.slice(-200)}`));
      }
    });
    child.on('error', reject);
  });
}

// ── Project Management Endpoints ─────────────────────────────────────────────

// List all projects
app.get('/projects/list', (_req, res) => {
  try {
    const projects = readProjectsJson();
    res.json({ projects });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Create new project
app.post('/projects/new', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }

    const projectId = crypto.randomUUID();
    const now = new Date().toISOString();
    const projectMeta: ProjectMeta = {
      id: projectId,
      name: name.trim(),
      createdAt: now,
      updatedAt: now,
    };

    // Create project directory
    const projectDir = createProjectDir(projectId, projectMeta.name);

    // Register in registry
    const projects = readProjectsJson();
    projects.push(projectMeta);
    saveProjectsJson(projects);

    // Switch workspace to new project
    executors.setWorkspaceDir(projectDir);

    // Kill old dev server while npm install runs
    stopWorkspaceDevServer();

    // Install deps and start dev server
    installDeps(projectDir)
      .then(async () => {
        startWorkspaceDevServer(projectDir);
        // Create initial checkpoint
        try {
          await executors.createCheckpoint(projectDir, 'initial');
          console.log('[projects] Initial checkpoint created');
        } catch (e) {
          console.warn('[projects] Failed to create initial checkpoint:', e);
        }
      })
      .catch((e) => console.error('[projects] Failed to setup:', e));

    res.json({ project: projectMeta, projects });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Switch to an existing project
app.post('/projects/switch', (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }

    const projects = readProjectsJson();
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const projectDir = path.join(PROJECTS_DIR, projectId);
    if (!fs.existsSync(projectDir)) {
      res.status(404).json({ error: 'Project directory not found' });
      return;
    }

    // Update metadata
    project.updatedAt = new Date().toISOString();
    saveProjectsJson(projects);

    // Switch workspace
    executors.setWorkspaceDir(projectDir);

    startWorkspaceDevServer(projectDir);

    res.json({ project, projects });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a project
app.delete('/projects/:id', (req, res) => {
  try {
    const { id } = req.params;

    const projects = readProjectsJson();
    const projectIndex = projects.findIndex((p) => p.id === id);

    if (projectIndex === -1) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Don't allow deleting the currently active project
    const workspaceDir = executors.getWorkspaceDir();
    if (path.basename(workspaceDir) === id) {
      res.status(400).json({ error: 'Cannot delete the currently active project. Switch to a different project first.' });
      return;
    }

    // Remove from registry
    projects.splice(projectIndex, 1);
    saveProjectsJson(projects);

    // Delete project directory
    const projectDir = path.join(PROJECTS_DIR, id);
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      console.log(`[projects] Deleted project directory: ${projectDir}`);
    }

    res.json({ success: true, projects });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get current project info
app.get('/projects/current', (_req, res) => {
  const workspaceDir = executors.getWorkspaceDir();
  const projectJsonPath = path.join(workspaceDir, 'project.json');
  let project: ProjectMeta | null = null;

  if (fs.existsSync(projectJsonPath)) {
    try {
      const raw = fs.readFileSync(projectJsonPath, 'utf-8');
      const meta = JSON.parse(raw);
      const projects = readProjectsJson();
      project = projects.find((p) => p.id === path.basename(workspaceDir)) || null;
      if (project && meta.name) project.name = meta.name;
    } catch {}
  }

  res.json({
    project,
    workspaceDir,
    devServerReady: workspaceDevReady,
  });
});

// Check if workspace dev server is ready
// ── File listing and reading ────────────────────────────────────────────────

app.get('/projects/files', async (_req, res) => {
  try {
    const files = await executors.listFiles();
    res.json({ files });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/projects/file', async (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }
    const content = await executors.readFile(filePath);
    res.json({ path: filePath, content });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Project readiness ─────────────────────────────────────────────────────

app.get('/projects/ready', (_req, res) => {
  res.json({
    ready: workspaceDevReady,
    workspaceDir: executors.getWorkspaceDir(),
    port: workspaceDevActualPort,
  });
});

// ── Checkpoint endpoints ───────────────────────────────────────────────────────

app.post('/projects/checkpoint', async (_req, res) => {
  try {
    const workspaceDir = executors.getWorkspaceDir();
    const id = await executors.createCheckpoint(workspaceDir);
    res.json({ id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/projects/restore', async (req, res) => {
  try {
    const { checkpointId } = req.body;
    if (!checkpointId) {
      res.status(400).json({ error: 'checkpointId is required' });
      return;
    }
    const workspaceDir = executors.getWorkspaceDir();
    await executors.restoreCheckpoint(workspaceDir, checkpointId);
    // Restart dev server
    stopWorkspaceDevServer();
    startWorkspaceDevServer(workspaceDir);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/projects/checkpoints', (_req, res) => {
  try {
    const workspaceDir = executors.getWorkspaceDir();
    const checkpoints = executors.listCheckpoints(workspaceDir);
    // Return chronologically (oldest first) for frontend navigation
    checkpoints.reverse();
    res.json({ checkpoints });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/projects/checkpoints/cleanup', (req, res) => {
  try {
    const { keepCheckpointId } = req.body;
    if (!keepCheckpointId) {
      res.status(400).json({ error: 'keepCheckpointId is required' });
      return;
    }
    const workspaceDir = executors.getWorkspaceDir();
    executors.deleteCheckpointsAfter(workspaceDir, keepCheckpointId);
    const remaining = executors.listCheckpoints(workspaceDir).reverse();
    res.json({ checkpoints: remaining });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Chat history persistence (survives page reload) ──────────────────────────

const CHAT_HISTORY_FILENAME = 'chat-history.json';

/** Read chat history from the current project's .deskspawn directory. */
app.get('/chat/history', (_req, res) => {
  try {
    const workspaceDir = executors.getWorkspaceDir();
    const historyPath = path.join(workspaceDir, '.deskspawn', CHAT_HISTORY_FILENAME);
    if (fs.existsSync(historyPath)) {
      const raw = fs.readFileSync(historyPath, 'utf-8');
      const messages = JSON.parse(raw);
      res.json({ messages });
    } else {
      res.json({ messages: [] });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Persist chat history to the current project's .deskspawn directory. */
app.post('/chat/history', (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      res.status(400).json({ error: 'messages array is required' });
      return;
    }
    const workspaceDir = executors.getWorkspaceDir();
    const deskspawnDir = path.join(workspaceDir, '.deskspawn');
    fs.mkdirSync(deskspawnDir, { recursive: true });
    const historyPath = path.join(deskspawnDir, CHAT_HISTORY_FILENAME);
    fs.writeFileSync(historyPath, JSON.stringify(messages), 'utf-8');
    res.json({ success: true, count: messages.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── API key management (from Rust backend, never from frontend) ───────────────

/**
 * Receive API key from the Rust backend (after keychain save or on startup).
 * The key is stored only in process memory — never written to disk.
 * The frontend NEVER has access to this endpoint.
 */
app.post('/api/config', (req, res) => {
  const { apiKey } = req.body || {};
  if (typeof apiKey === 'string') {
    storedApiKey = apiKey;
    console.log('[api/config] API key updated in sidecar memory');
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'apiKey string required' });
  }
});

// ── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', workspace: executors.getWorkspaceDir() });
});

// ── Model discovery endpoint ──────────────────────────────────────────────────

app.get('/api/models', async (req, res) => {
  try {
    const provider = (req.query.provider as string) || 'openai';
    const customEndpoint = req.query.customEndpoint as string | undefined;
    // Use stored key when frontend doesn't provide one.
    // undefined lets provider SDKs fall back to environment variables.
    const apiKey = (req.query.apiKey as string) || storedApiKey || undefined;

    const models = await getModelsForProvider(provider, customEndpoint, apiKey);
    res.json({ models });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to fetch models: ${error?.message || error}` });
  }
});

// ── Chat endpoint ────────────────────────────────────────────────────────────

app.post('/chat', async (req, res) => {
  const { messages, config } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array required' });
    return;
  }

  try {
    // Capture workspace dir at request start to prevent race condition
    // if project is switched mid-generation.
    const workspaceDir = executors.getWorkspaceDir();

    // Use stored API key (from Rust backend) when frontend doesn't send one.
    // This ensures the frontend NEVER needs to hold the raw API key.
    // API keys come exclusively from keychain/file (Tauri) or localStorage
    // (browser). Environment variables are NEVER used as fallback.
    const resolvedApiKey = config?.apiKey || storedApiKey || undefined;

    const model = getModel({
      provider: config?.provider || 'ollama',
      model: config?.model,
      apiKey: resolvedApiKey,
      customEndpoint: config?.customEndpoint,
      temperature: config?.temperature ?? 0.2,
      maxTokens: config?.maxTokens,
    });

    // Build message history (system message goes to `system` param, not in messages array)
    const aiMessages = messages.map((m: any) => ({
      role: m.role as 'user' | 'assistant' | 'tool',
      content: m.content,
      ...(m.tool_calls ? { toolCalls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { toolCallId: m.tool_call_id } : {}),
    }));

    // Set up SSE for streaming (declare early so tools can use it)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendSSE = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Log diagnostic info for debugging
    console.log(`[chat] Request: provider=${config?.provider || 'ollama'} model=${config?.model || 'default'} msgs=${(messages || []).length} lastRole=${(messages || []).at(-1)?.role || 'none'} lastContent=${((messages || []).at(-1)?.content || '').substring(0, 80)}`);

    // ── Abort support: cancel when client disconnects ─────────────
    const abortController = new AbortController();
    const signal = abortController.signal;
    let generationDone = false;
    // Track client disconnection — use `close` on the response (res) instead of
    // request (req) to avoid false positives from request stream cleanup.
    res.on('close', () => {
      if (!generationDone && !abortController.signal.aborted) {
        abortController.abort();
        console.log('[chat] Client disconnected, aborting generation');
      }
    });

    // ── Build all tool execute functions ──────────────────────────────────
    // These are later filtered by phase in the multi-agent pipeline.
    const allToolExecs: Record<string, any> = {
      read_file: {
        ...tools.read_file,
        execute: async ({ path: filePath }: { path: string }) => {
          try {
            const content = await executors.readFile(filePath, workspaceDir);
            console.log(`[exec] read_file(${filePath}) => ${content.length} chars`);
            sendSSE({
              type: 'tool_result',
              toolName: 'read_file',
              result: `${content.length} chars read from ${filePath}`,
              detail: { file: filePath, size: content.length },
            });
            return content;
          } catch (e: any) {
            const errMsg = `Failed to read ${filePath}: ${e?.message || e}`;
            console.warn(`[exec] read_file error: ${errMsg}`);
            sendSSE({
              type: 'tool_result',
              toolName: 'read_file',
              result: `❌ ${errMsg}`,
              detail: { file: filePath, error: e?.message || String(e) },
            });
            return `❌ ${errMsg}`;
          }
        },
      },
      list_files: {
        ...tools.list_files,
        execute: async () => {
          try {
            const files = await executors.listFiles(workspaceDir);
            sendSSE({
              type: 'tool_result',
              toolName: 'list_files',
              result: `${files.length} files found`,
            });
            return files;
          } catch (e: any) {
            const errMsg = `Failed to list files: ${e?.message || e}`;
            console.warn(`[exec] list_files error: ${errMsg}`);
            sendSSE({
              type: 'tool_result',
              toolName: 'list_files',
              result: `❌ ${errMsg}`,
            });
            return [];
          }
        },
      },
      apply_artifact: {
        ...tools.apply_artifact,
        execute: async (input: { id: string; title: string; actions: unknown[] }) => {
          const artifact: import('./types.js').Artifact = {
            id: input.id,
            title: input.title,
            actions: input.actions as any,
          };
          console.log(`[exec] apply_artifact id=${artifact.id} title=${artifact.title} actions=${artifact.actions.length}`);
          try {
            const result = await executors.applyArtifact(artifact, workspaceDir);
            sendSSE({
              type: 'tool_result',
              toolName: 'apply_artifact',
              result: result.success
                ? `${result.filesChanged.length} files changed: ${result.filesChanged.join(', ')}`
                : `Failed: ${(result.errors || []).join('; ')}`,
              detail: {
                filesChanged: result.filesChanged,
                errors: result.errors,
              },
            });
            return result;
          } catch (e: any) {
            const errMsg = `Failed to apply artifact: ${e?.message || e}`;
            console.warn(`[exec] apply_artifact error: ${errMsg}`);
            sendSSE({
              type: 'tool_result',
              toolName: 'apply_artifact',
              result: `❌ ${errMsg}`,
              detail: { error: e?.message || String(e) },
            });
            return { success: false, filesChanged: [], shellCommandsRun: [], errors: [errMsg] };
          }
        },
      },
      run_shell: {
        ...tools.run_shell,
        execute: async ({ command }: { command: string }) => {
          console.log(`[exec] run_shell: ${command}`);
          const result = await executors.runShell(command);
          const emoji = result.success ? '✅' : '❌';
          const msg = result.success
            ? `${emoji} ${command}`
            : `${emoji} ${command}: ${result.stderr}`.substring(0, 200);
          sendSSE({
            type: 'tool_result',
            toolName: 'run_shell',
            result: msg,
          });
          return result;
        },
      },
      get_errors: {
        ...tools.get_errors,
        execute: async () => {
          try {
            const errors = await executors.getErrors(workspaceDir);
            const summary = errors.length === 0
              ? 'No errors found'
              : `${errors.length} errors found`;
            const details = errors.map((e: any) => ({
              type: e.type,
              pattern: e.pattern,
              filePath: e.filePath,
              line: e.line,
              message: e.message?.substring(0, 200),
              suggestion: e.suggestion,
            }));
            sendSSE({
              type: 'tool_result',
              toolName: 'get_errors',
              result: summary,
              detail: { errors: details },
            });
            return errors;
          } catch (e: any) {
            const errMsg = `Failed to get errors: ${e?.message || e}`;
            console.warn(`[exec] get_errors error: ${errMsg}`);
            sendSSE({
              type: 'tool_result',
              toolName: 'get_errors',
              result: `❌ ${errMsg}`,
              detail: { error: e?.message || String(e) },
            });
            return [];
          }
        },
      },
      // ── MCP tools (grep.app GitHub code search) ────────────────
      ...(() => {
        const mcp = getMCPTools();
        if (mcp) {
          console.log(`[mcp] Exposing tools: ${Object.keys(mcp).join(', ')}`);
          return mcp;
        }
        return {};
      })(),

      take_screenshot: {
        ...tools.take_screenshot,
        execute: async (input: {
          target?: string;
          mode?: 'browser';
          fullPage?: boolean;
          width?: number;
          height?: number;
          viewports?: Array<{ width: number; height: number; label?: string }>;
          compareWithPrevious?: boolean;
          waitAfterLoad?: number;
        }) => {
          const startTime = Date.now();
          const mode = input.mode ?? 'browser';
          const target = input.target ?? 'http://localhost:5174';
          console.log(`[exec] take_screenshot target=${target} mode=${mode}` +
            (input.viewports ? ` viewports=${input.viewports.length}` : '') +
            (input.compareWithPrevious ? ' diff=true' : ''));

          try {
            const result = await takeScreenshot({
              target,
              mode,
              fullPage: input.fullPage ?? true,
              width: input.width ?? 1280,
              height: input.height ?? 720,
              viewports: input.viewports,
              compareWithPrevious: input.compareWithPrevious ?? false,
              waitAfterLoad: input.waitAfterLoad ?? 1500,
            });

            const elapsed = Date.now() - startTime;
            const imageSizeKb = Math.round((result.layer1.length * 3) / 4 / 1024);
            const isResponsive = result.responsive && result.responsive.length > 0;
            const hasDiff = result.diff !== undefined;

            console.log(
              `[exec] take_screenshot OK: ${elapsed}ms` +
              (isResponsive ? `, responsive=${result.responsive!.length}` : '') +
              (hasDiff ? `, diff=${result.diff!.changedPercent}% changed` : '') +
              `, image=${imageSizeKb}KB` +
              `, elements=${result.layer2.elements.length}` +
              `, errors=${result.layer2.consoleErrors.length}`,
            );

            let sseResult = isResponsive
              ? `📱 Responsive: ${result.responsive!.length} viewports captured`
              : `📸 Screenshot captured (${imageSizeKb}KB)`;
            if (hasDiff) {
              const d = result.diff!;
              sseResult += d.hasChanges
                ? `\n🔄 Diff: ${d.changedPercent}% changed (${d.changedPixels}px)`
                : `\n✅ No visual changes since last screenshot`;
            }
            sseResult += `\n${result.layer3.substring(0, 500)}`;

            sendSSE({
              type: 'tool_result',
              toolName: 'take_screenshot',
              result: sseResult,
            });

            return JSON.stringify(result);
          } catch (e: any) {
            const errMsg = `Screenshot failed: ${e?.message || e}`;
            console.warn(`[exec] take_screenshot error: ${errMsg}`);
            sendSSE({
              type: 'tool_result',
              toolName: 'take_screenshot',
              result: `❌ ${errMsg}`,
              detail: { error: e?.message || String(e) },
            });
            return `❌ ${errMsg}`;
          }
        },
      },
    };

    // ── Triage + Multi-Agent Pipeline ────────────────────────────────────
    // Phase 0: Lightweight triage classifies request complexity.
    //   - "single": runs only Coder phase (fast path)
    //   - "multi":  runs full pipeline (Planner → Coder → Verifier → Visual QA)
    //
    // Tool builder: filters allToolExecs to only the tools allowed per phase.
    // Pipeline hooks: translate orchestrator events to SSE for the frontend.
    //
    try {
      // Notify frontend that triage is starting
      sendSSE({ type: 'triage_start', label: 'Analyzing request...' });

      const pipelineResult = await runWithTriage(
        model,
        aiMessages,
        // Build filtered tool set for each phase
        (toolNames: string[]) => {
          const subset: Record<string, any> = {};
          for (const name of toolNames) {
            if (allToolExecs[name]) {
              subset[name] = allToolExecs[name];
            }
          }
          return subset;
        },
        signal,
        // Pipeline lifecycle hooks → SSE events
        {
          onPhaseStart: (phase) => {
            console.log(`[pipeline] Starting phase: ${phase}`);
            sendSSE({
              type: 'phase_start',
              phase,
              label: getPhaseLabel(phase),
            });
          },

          onPhaseEnd: (phase, result) => {
            console.log(`[pipeline] Phase ${phase} done: steps=${result.stepCount} textLen=${result.text?.length || 0}`);
            sendSSE({
              type: 'phase_end',
              phase,
              steps: result.stepCount,
              usage: result.usage,
            });
          },

          onPhaseDetail: (phase, text) => {
            sendSSE({
              type: 'phase_detail',
              phase,
              text,
              label: getPhaseLabel(phase),
            });
          },

          onToolCall: (phase, toolName, args) => {
            console.log(`[pipeline] ${phase}: ${toolName}()`, JSON.stringify(args).substring(0, 100));
            sendSSE({ type: 'tool_call', phase, toolName, args });
          },

          onStepProgress: (phase, { step, maxSteps }) => {
            sendSSE({ type: 'step_progress', phase, step, maxSteps });
          },

          onRateLimit: (phase, retryCount, maxRetries, waitMs) => {
            console.log(`[pipeline] ${phase}: rate limit (${retryCount}/${maxRetries}), waiting ${waitMs}ms`);
            sendSSE({ type: 'rate_limit', phase, retryCount, maxRetries, waitMs });
          },

          onContinuation: (phase, round, maxRounds) => {
            console.log(`[pipeline] ${phase}: auto-continuation ${round}/${maxRounds}`);
            sendSSE({ type: 'continuation', phase, round, maxRounds });
          },

          onTriageResult: (result) => {
            console.log(`[triage] mode=${result.mode} reason="${result.reason}"`);
            sendSSE({ type: 'triage_result', mode: result.mode, reason: result.reason });
          },
        },
      );

      // ── Send final result ────────────────────────────────────────────
      generationDone = true;

      const { text: finalText, usage: totalUsage, phases } = pipelineResult;

      // ── Create single checkpoint after pipeline completes ──────────
      if (workspaceDir && phases.length > 0) {
        executors.createCheckpoint(workspaceDir)
          .then((id: string) => {
            sendSSE({ type: 'checkpoint', phase: 'all', id });
          })
          .catch((e: any) => console.warn('[pipeline] Failed to create final checkpoint:', e));
      }

      sendSSE({
        type: 'text',
        text: finalText || '⚠️ Response generation failed. Please try again.',
        usage: totalUsage,
        phases,
      });
      console.log(`[done] textLen=${finalText?.length || 0} phases=${phases.join(',')} usage=${JSON.stringify(totalUsage)}`);
    } catch (error: any) {
      generationDone = true;
      if (error?.name === 'AbortError' || error?.message === 'This operation was aborted') {
        console.log('[pipeline] Generation aborted (client disconnected)');
      } else {
        try {
          const isRateLimit = /rate limit|rate_limit|429|too many requests/i.test(
            String(error?.message || error),
          );
          const errorMsg = error?.message || String(error || '');
          sendSSE({
            type: 'error',
            error: errorMsg,
            errorCode: isRateLimit ? 'RATE_LIMIT' : 'GENERATION_FAILED',
          });
        } catch {
          // Best-effort
        }
      }
    }

    // Best-effort stream end — don't let a write error crash the handler
    try {
      sendSSE({ type: 'done' });
    } catch {}
    try {
      res.end();
    } catch {}
  } catch (error: any) {
    // If we already flushed SSE headers, send error as SSE event instead of HTTP 500
    // which would fail silently (headers already sent).
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', error: `Server error: ${error?.message || error}` })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch {
      // Headers not yet sent or response already ended — fall back to JSON
      try {
        if (!res.headersSent) {
          res.status(500).json({ error: `Server error: ${error?.message || error}` });
        }
      } catch {}
    }
  }
});

// ── Data backup endpoint ─────────────────────────────────────────────────────

// Backup: store app data to project file
app.put('/data-backup', (req, res) => {
  try {
    const workspaceDir = executors.getWorkspaceDir();
    const backupPath = path.join(workspaceDir, BACKUP_FILENAME);
    const dir = path.dirname(backupPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify(req.body), 'utf-8');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Backup: read app data from project file
app.get('/data-backup', (_req, res) => {
  try {
    const workspaceDir = executors.getWorkspaceDir();
    const backupPath = path.join(workspaceDir, BACKUP_FILENAME);
    if (!fs.existsSync(backupPath)) {
      res.status(404).json({ error: 'No backup found' });
      return;
    }
    const raw = fs.readFileSync(backupPath, 'utf-8');
    res.json(JSON.parse(raw));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Export/Import ────────────────────────────────────────────────────────────

// Export project as .deskspawn file
app.get('/projects/:id/export', (req, res) => {
  try {
    const { id } = req.params;
    const projectDir = path.join(PROJECTS_DIR, id);
    if (!fs.existsSync(projectDir)) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const exportDir = path.join(projectDir, '.deskspawn', 'export');
    fs.mkdirSync(exportDir, { recursive: true });

    // Collect project files (excluding ignored dirs)
    const filesToExport: Array<{ path: string; content: string }> = [];
    function collectFiles(dir: string, relative: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (executors.IGNORED_DIRS.includes(entry.name) || entry.name === '.deskspawn') continue;
          collectFiles(path.join(dir, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
        } else {
          const fullPath = path.join(dir, entry.name);
          const content = fs.readFileSync(fullPath, 'utf-8');
          filesToExport.push({ path: relative ? `${relative}/${entry.name}` : entry.name, content });
        }
      }
    }
    collectFiles(projectDir, '');

    // Write export files to temp dir
    for (const file of filesToExport) {
      const outPath = path.join(exportDir, file.path);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, file.content, 'utf-8');
    }

    // Write metadata
    const projMeta = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'));
    fs.writeFileSync(path.join(exportDir, 'deskspawn.json'), JSON.stringify({
      name: projMeta.name,
      version: '1.0',
      exportedAt: new Date().toISOString(),
    }, null, 2));

    // Create zip archive (use execFileSync to avoid shell injection from project name)
    const zipName = `${projMeta.name.toLowerCase().replace(/[^a-z0-9-]/g, '')}.deskspawn`;
    execFileSync('zip', ['-r', zipName, '.'], { cwd: exportDir, timeout: 30000 });

    // Send the zip file
    const zipPath = path.join(exportDir, zipName);
    res.download(zipPath, zipName, () => {
      // Cleanup temp export directory
      fs.rmSync(exportDir, { recursive: true, force: true });
    });
  } catch (e: any) {
    res.status(500).json({ error: `Export failed: ${e.message}` });
  }
});

// Import project from .deskspawn file (base64-encoded zip)
app.post('/projects/import', async (req, res) => {
  try {
    const { fileBase64 } = req.body;
    if (!fileBase64 || typeof fileBase64 !== 'string') {
      res.status(400).json({ error: 'fileBase64 is required' });
      return;
    }

    // Decode base64 to temp zip file
    const tempDir = path.join(PROJECTS_DIR, '.import-temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const zipPath = path.join(tempDir, 'import.deskspawn');
    fs.writeFileSync(zipPath, Buffer.from(fileBase64, 'base64'));

    // Extract zip (execFileSync avoids shell injection from file paths)
    execFileSync('unzip', ['-o', zipPath, '-d', tempDir], { timeout: 10000 });

    // Read metadata
    const metaPath = path.join(tempDir, 'deskspawn.json');
    if (!fs.existsSync(metaPath)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      res.status(400).json({ error: 'Invalid .deskspawn file: missing deskspawn.json' });
      return;
    }
    const deskspawnMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const appName = deskspawnMeta.name || 'Imported App';

    const projectId = crypto.randomUUID();
    const now = new Date().toISOString();
    const projectMeta: ProjectMeta = {
      id: projectId,
      name: appName,
      createdAt: now,
      updatedAt: now,
    };

    const projectDir = path.join(PROJECTS_DIR, projectId);
    fs.mkdirSync(projectDir, { recursive: true });

    // Copy all files from temp to project dir (skip deskspawn.json)
    function copyImportFiles(src: string, dst: string, relative: string) {
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'deskspawn.json') continue;
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', '.deskspawn', '.git'].includes(entry.name)) continue;
          fs.mkdirSync(dstPath, { recursive: true });
          copyImportFiles(srcPath, dstPath, relative ? `${relative}/${entry.name}` : entry.name);
        } else {
          fs.copyFileSync(srcPath, dstPath);
        }
      }
    }
    copyImportFiles(tempDir, projectDir, '');

    // Generate storage adapter (ensure it exists)
    generateStorageAdapterFiles(projectDir);

    // Write project metadata
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
      name: projectMeta.name, createdAt: now, updatedAt: now,
    }, null, 2));

    // Cleanup temp
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Register in registry
    const projects = readProjectsJson();
    projects.push(projectMeta);
    saveProjectsJson(projects);

    // Install deps and start dev server
    executors.setWorkspaceDir(projectDir);
    stopWorkspaceDevServer();
    installDeps(projectDir)
      .then(async () => {
        startWorkspaceDevServer(projectDir);
        try { await executors.createCheckpoint(projectDir, 'initial'); } catch {}
      })
      .catch(e => console.error('[import] Failed to setup:', e));

    res.json({ project: projectMeta, projects });
  } catch (e: any) {
    res.status(500).json({ error: `Import failed: ${e.message}` });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────

// Cleanup on exit
process.on('SIGTERM', () => { stopWorkspaceDevServer(); closeMCPClients(); process.exit(0); });
process.on('SIGINT', () => { stopWorkspaceDevServer(); closeMCPClients(); process.exit(0); });

/**
 * Kill any process holding a given port (macOS/Linux).
 * Uses lsof + kill -9. Best-effort; errors are silently swallowed.
 */
function killPortProcess(port: number) {
  try {
    const pid = execSync(`lsof -ti:${port} 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 }).trim();
    if (pid) {
      console.log(`[sidecar] Killing process on port ${port} (PID: ${pid})...`);
      execSync(`kill -9 ${pid} 2>/dev/null`, { timeout: 3000 });
      execSync(`sleep 0.3`, { timeout: 3000 });
    }
  } catch {
    // No process holding the port — good
  }
}

/**
 * Start the HTTP server with port fallback.
 * First tries to free DESIRED_PORT, then binds; if still busy, tries fallback ports.
 * Emits "sidecar-ready:PORT" on stdout so the Rust backend can detect the actual port.
 */
function startServer(port: number): Promise<void> {
  // Try to free the first port before binding
  if (port === DESIRED_PORT) {
    killPortProcess(port);
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      ACTUAL_PORT = port;
      // Signal readiness to Rust backend (parses this from stdout)
      console.log(`sidecar-ready:${ACTUAL_PORT}`);
      console.log(`DeskSpawn sidecar HTTP server on port ${ACTUAL_PORT}`);
      console.log(`Workspace: ${executors.getWorkspaceDir()}`);
      resolve();
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        const nextPort = port + 1;
        const maxPort = DESIRED_PORT + 9;
        if (nextPort <= maxPort) {
          console.warn(`[sidecar] Port ${port} in use, trying ${nextPort}...`);
          server.close(() => startServer(nextPort).then(resolve, reject));
        } else {
          reject(new Error(`All ports ${DESIRED_PORT}-${maxPort} in use`));
        }
      } else {
        reject(err);
      }
    });
  });
}

startServer(DESIRED_PORT).then(() => {
  // Initialise MCP clients (non-fatal if grep.app is unreachable)
  initMCPClients();
}).catch((err) => {
  console.error('[sidecar] Failed to start HTTP server:', err);
  process.exit(1);
});
