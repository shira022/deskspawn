import type { FileEntry } from "./storage-opfs";
import type { LanguageCode } from "./languages";
import { templateLocale, type TemplateLocale } from "./template-locale";

// ============================================================
// Default App Template (React + Vite + Tailwind CSS v4)
//
// Copied into every new app created in the browser version.
// The language parameter selects locale-aware file content.
// ============================================================

// ── Language-independent file helpers ──────────────────────────

function getIndexHtml(lang: string): string {
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>Generated App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
}

const PACKAGE_JSON = JSON.stringify(
  {
    name: "generated-app",
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "vite",
      build: "tsc -b && vite build",
      preview: "vite preview",
    },
    dependencies: {
      clsx: "^2.1.1",
      "lucide-react": "^0.468.0",
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      "tailwind-merge": "^2.6.0",
      zustand: "^5.0.2",
    },
    devDependencies: {
      "@tailwindcss/vite": "^4.3.0",
      "@types/react": "^18.3.12",
      "@types/react-dom": "^18.3.1",
      "@vitejs/plugin-react": "^4.3.4",
      tailwindcss: "^4.3.0",
      typescript: "~5.6.3",
      vite: "^6.0.0",
    },
  },
  null,
  2,
);

/**
 * Desktop package.json — full-stack generated app (ADR-010).
 * Adds a Hono backend (bun:sqlite for persistence, zero extra deps beyond
 * hono) and vitest for the quality loop (P5). The dev server runs vite for
 * the frontend and `bun src/server.ts` for the API.
 */
const PACKAGE_JSON_DESKTOP = JSON.stringify(
  {
    name: "generated-app",
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "vite",
      "dev:api": "bun --watch src/server.ts",
      build: "tsc -b && vite build",
      preview: "vite preview",
      test: "bun test",
    },
    dependencies: {
      clsx: "^2.1.1",
      hono: "^4.6.14",
      "lucide-react": "^0.468.0",
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      "tailwind-merge": "^2.6.0",
      zustand: "^5.0.2",
    },
    devDependencies: {
      "@tailwindcss/vite": "^4.3.0",
      "@types/react": "^18.3.12",
      "@types/react-dom": "^18.3.1",
      "@vitejs/plugin-react": "^4.3.4",
      tailwindcss: "^4.3.0",
      typescript: "~5.6.3",
      vite: "^6.0.0",
    },
  },
  null,
  2,
);

const TSCONFIG_JSON = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2020",
      useDefineForClassFields: true,
      lib: ["ES2020", "DOM", "DOM.Iterable"],
      module: "ESNext",
      skipLibCheck: true,
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      isolatedModules: true,
      moduleDetection: "force",
      noEmit: true,
      jsx: "react-jsx",
      strict: true,
      baseUrl: ".",
      paths: {
        "@/*": ["./src/*"],
      },
    },
    include: ["src"],
  },
  null,
  2,
);

const VITE_CONFIG = `import path from "path";
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    strictPort: false,
  },
});`;

/**
 * Desktop vite.config.ts — full-stack generated app (ADR-010).
 * API proxy: /api → Hono backend (default 4174, auto-fallback +10).
 * The actual backend port is patched by DeskSpawn at app creation.
 */
function getViteConfigDesktop(apiPort: number): string {
  return `import path from "path";
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 4173,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://localhost:${apiPort}",
        changeOrigin: true,
      },
    },
  },
});`;
}

/**
 * Desktop Hono backend — the generated app's API (ADR-010).
 * Uses bun:sqlite (bundled with bun, zero deps). DB path comes from
 * DATABASE_URL (defaults to ./data/app.db). Run with `bun src/server.ts`.
 *
 * IMPORTANT: bun auto-starts the server from the default export when the file
 * is the entry point. Do NOT call Bun.serve() manually here — it would bind
 * the port twice (EADDRINUSE). hostname is pinned to 127.0.0.1 to avoid
 * binding conflicts on Windows/WSL. When imported by tests (bun test) this
 * module is not an entry point, so no server starts — use app.request().
 */
const SERVER_TS = `import { Hono } from "hono";
import { cors } from "hono/cors";
import { openDb, getAll, getById, create, update, remove, clear } from "./lib/db";

// DATABASE_URL abstraction: default to ./data/app.db; override via env
// (e.g. DATABASE_URL=file:./other.db or a hosted libsql URL in the future).
const db = openDb();

const app = new Hono();
app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ status: "ok" }));

// ── 汎用コレクション CRUD (ADR-010) ──────────────────────────────
// フロントエンドは @/lib/storage (StorageAdapter) 経由でアクセスする。
// コレクション名は任意 (例: "items", "todos", "notes")。ドキュメントは
// { id: string, ... } の JSON として SQLite (bun:sqlite) に保存される。

app.get("/api/data/:collection", (c) => {
  return c.json(getAll(db, c.req.param("collection")));
});

app.get("/api/data/:collection/:id", (c) => {
  const doc = getById(db, c.req.param("collection"), c.req.param("id"));
  if (!doc) return c.json({ error: "Not found" }, 404);
  return c.json(doc);
});

app.post("/api/data/:collection", async (c) => {
  const collection = c.req.param("collection");
  const doc = await c.req.json();
  if (!doc || typeof doc.id !== "string" || !doc.id) {
    return c.json({ error: "doc.id (string) is required" }, 400);
  }
  return c.json(create(db, collection, doc), 201);
});

app.put("/api/data/:collection/:id", async (c) => {
  const collection = c.req.param("collection");
  const id = c.req.param("id");
  const patch = await c.req.json();
  try {
    return c.json(update(db, collection, id, patch));
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

app.delete("/api/data/:collection/:id", (c) => {
  remove(db, c.req.param("collection"), c.req.param("id"));
  return c.body(null, 204);
});

app.delete("/api/data/:collection", (c) => {
  clear(db, c.req.param("collection"));
  return c.body(null, 204);
});

const port = Number(process.env.PORT) || 4174;
export default {
  port,
  hostname: "127.0.0.1",
  fetch: app.fetch,
};
`;
const DB_TS = `import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import path from "path";

// DB path comes from DATABASE_URL (defaults to ./data/app.db).
const DB_URL = process.env.DATABASE_URL || "file:./data/app.db";
const dbPath = DB_URL.replace(/^file:/, "");

// ── 汎用コレクションストア ────────────────────────────────────────
// 全コレクションを1テーブル (entries) で管理する。各ドキュメントは
// JSON 文字列として data カラムに保存。将来 Drizzle 移行時はこの
// ファイルの関数群だけを置き換える (ADR-010)。

export function openDb(): Database {
  const dir = path.dirname(path.resolve(dbPath));
  mkdirSync(dir, { recursive: true });
  const db = new Database(path.resolve(dbPath));
  db.query("CREATE TABLE IF NOT EXISTS entries ("
    + "id TEXT PRIMARY KEY,"
    + " collection TEXT NOT NULL,"
    + " data TEXT NOT NULL,"
    + " created_at TEXT NOT NULL,"
    + " updated_at TEXT NOT NULL)").run();
  db.query("CREATE INDEX IF NOT EXISTS idx_entries_collection ON entries(collection)").run();
  return db;
}

export function getAll<T = Record<string, unknown>>(db: Database, collection: string): T[] {
  const rows = db
    .query("SELECT data FROM entries WHERE collection = ? ORDER BY created_at DESC")
    .all(collection) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as T);
}

export function getById<T = Record<string, unknown>>(db: Database, collection: string, id: string): T | null {
  const row = db
    .query("SELECT data FROM entries WHERE collection = ? AND id = ?")
    .get(collection, id) as { data: string } | null;
  return row ? (JSON.parse(row.data) as T) : null;
}

export function create<T = Record<string, unknown>>(
  db: Database,
  collection: string,
  doc: T & { id: string; created_at: string; updated_at: string },
): T {
  db.query(
    "INSERT INTO entries (id, collection, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(doc.id, collection, JSON.stringify(doc), doc.created_at, doc.updated_at);
  return doc;
}

export function update<T = Record<string, unknown>>(
  db: Database,
  collection: string,
  id: string,
  patch: Partial<T>,
): T {
  const existing = getById<T & { id: string; created_at: string; updated_at: string }>(
    db,
    collection,
    id,
  );
  if (!existing) throw new Error("Not found");
  const updated = { ...existing, ...patch, id, updated_at: new Date().toISOString() };
  db.query("UPDATE entries SET data = ?, updated_at = ? WHERE id = ? AND collection = ?")
    .run(JSON.stringify(updated), updated.updated_at, id, collection);
  return updated;
}

export function remove(db: Database, collection: string, id: string): void {
  db.query("DELETE FROM entries WHERE collection = ? AND id = ?").run(collection, id);
}

export function clear(db: Database, collection: string): void {
  db.query("DELETE FROM entries WHERE collection = ?").run(collection);
}
`;
const SERVER_TEST_TS = `import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { openDb, getAll, create, clear } from "./lib/db";

// In-memory DB for tests (DATABASE_URL=:memory: keeps the filesystem clean).
process.env.DATABASE_URL = ":memory:";
const db = openDb();

function buildApp() {
  const app = new Hono();
  app.get("/api/data/:collection", (c) => c.json(getAll(db, c.req.param("collection"))));
  app.post("/api/data/:collection", async (c) => {
    const doc = await c.req.json();
    if (!doc || typeof doc.id !== "string" || !doc.id) {
      return c.json({ error: "doc.id (string) is required" }, 400);
    }
    return c.json(create(db, c.req.param("collection"), doc), 201);
  });
  app.delete("/api/data/:collection", (c) => {
    clear(db, c.req.param("collection"));
    return c.body(null, 204);
  });
  return app;
}

describe("generated app API (ADR-010)", () => {
  it("creates and lists docs via /api/data/:collection", async () => {
    const app = buildApp();
    const now = new Date().toISOString();
    const doc = { id: "1", title: "hello", created_at: now, updated_at: now };

    const createRes = await app.request("/api/data/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    });
    expect(createRes.status).toBe(201);

    const listRes = await app.request("/api/data/items");
    const list = await listRes.json();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("hello");
  });

  it("returns 400 when doc.id is missing", async () => {
    const app = buildApp();
    const res = await app.request("/api/data/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "no id" }),
    });
    expect(res.status).toBe(400);
  });

  it("clears the collection", async () => {
    const app = buildApp();
    const now = new Date().toISOString();
    await app.request("/api/data/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1", title: "x", created_at: now, updated_at: now }),
    });
    const del = await app.request("/api/data/items", { method: "DELETE" });
    expect(del.status).toBe(204);
    const listRes = await app.request("/api/data/items");
    expect(await listRes.json()).toHaveLength(0);
  });
});
`;
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#6366f1"/>
  <polygon points="56,12 20,54 46,54 40,88 78,40 52,40" fill="white"/>
</svg>`;

const VITE_ENV_DTS = `/// <reference types="vite/client" />
`;

/**
 * Storage adapter factory (frontend storage.ts).
 *
 * Web:   IndexedDB 実装 (storage-idb.ts) を返す。
 *        DB はブラウザ内に保存される（デモ/Web版用）。
 * Desktop: Hono API 実装 (storage-api.ts) を返す (ADR-010)。
 *        DB は生成アプリ自身の Hono バックエンド + bun:sqlite
 *        （ローカル実ファイル、./data/app.db）に保存される。
 */
function getStorageTs(impl: "idb" | "api"): string {
  const adapterFactory =
    impl === "api"
      ? `      const { ApiAdapter } = await import('./storage-api');
      _instance = new ApiAdapter();`
      : `      const { IndexedDBAdapter } = await import('./storage-idb');
      _instance = await IndexedDBAdapter.create(APP_ID);`;
  return `// ============================================================
// Storage Adapter Interface
// ============================================================
//
// Pre-installed storage adapter for persistent data.
// AI agents: Import via @/lib/storage - do NOT modify this file.
//
// ============================================================

import { APP_ID } from './app-id';

export interface StorageAdapter {
  getAll<T extends { id: string }>(collection: string): Promise<T[]>;
  getById<T extends { id: string }>(collection: string, id: string): Promise<T | null>;
  create<T extends { id: string }>(collection: string, item: Omit<T, 'id' | 'created_at' | 'updated_at'>): Promise<T>;
  update<T extends { id: string }>(collection: string, id: string, item: Partial<Omit<T, 'id'>>): Promise<T>;
  remove(collection: string, id: string): Promise<void>;
  clear(collection: string): Promise<void>;
}

let _instance: StorageAdapter | null = null;
let _initPromise: Promise<StorageAdapter> | null = null;

export function getStorage(): StorageAdapter {
  if (_instance) return _instance;
  // 未初期化の場合は自動で初期化を開始する
  if (!_initPromise) {
    _initPromise = (async () => {
${adapterFactory}
      return _instance!;
    })();
  }
  // 同期的に使いたい場合は initStorage() を事前に呼んでおくこと
  throw new Error('Storage not initialized yet. Call await initStorage() first, or use getStorage() after initialization completes.');
}

export async function initStorage(): Promise<StorageAdapter> {
  if (_instance) return _instance;
  if (!_initPromise) {
${adapterFactory}
  } else {
    _instance = await _initPromise;
  }
  return _instance!;
}
`;
}

const STORAGE_IDB_TS = `// ============================================================
// IndexedDB Storage Adapter (browser-only, no sidecar dependency)
// ============================================================
//
// Pre-installed IndexedDB implementation of the StorageAdapter interface.
// AI agents: Import via @/lib/storage - do NOT modify this file.
//
// ============================================================

import type { StorageAdapter } from './storage';

export class IndexedDBAdapter implements StorageAdapter {
  private db: IDBDatabase | null = null;
  private dbName: string;

  private constructor(dbName: string) {
    this.dbName = dbName;
  }

  static async create(appId: string): Promise<IndexedDBAdapter> {
    const name = \`deskspawn_app_\${appId}\`;
    const adapter = new IndexedDBAdapter(name);
    await adapter.init();
    return adapter;
  }

  private async init() {
    this.db = await openDB(this.dbName);
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async ensureCollection(collection: string): Promise<void> {
    const newDb = await ensureCollectionInternal(this.db!, collection);
    if (newDb) this.db = newDb;
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
    await this.ensureCollection(collection);
    const now = new Date().toISOString();
    const doc = { ...item, id: crypto.randomUUID(), created_at: now, updated_at: now };
    return new Promise<T>((resolve, reject) => {
      const tx = this.db!.transaction(collection, 'readwrite');
      const req = tx.objectStore(collection).add(doc);
      req.onsuccess = () => resolve(doc as unknown as T);
      req.onerror = () => reject(req.error);
    });
  }

  async update<T extends { id: string }>(collection: string, id: string, item: Partial<Omit<T, 'id'>>): Promise<T> {
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
  }

  async remove(collection: string, id: string): Promise<void> {
    await this.ensureCollection(collection);
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(collection, 'readwrite');
      const req = tx.objectStore(collection).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear(collection: string): Promise<void> {
    await this.ensureCollection(collection);
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(collection, 'readwrite');
      const req = tx.objectStore(collection).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
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
`;

/**
 * Desktop storage adapter — talks to the generated app's own Hono API
 * (src/server.ts), which persists to a local SQLite file via bun:sqlite
 * (ADR-010). Zero browser storage involved.
 */
const STORAGE_API_TS = `// ============================================================
// Hono API Storage Adapter (desktop, ADR-010) — bun:sqlite backend
// ============================================================
//
// Pre-installed API-backed implementation of the StorageAdapter interface.
// AI agents: Import via @/lib/storage - do NOT modify this file.
//
// Persistence goes through the generated app's own Hono API
// (src/server.ts -> src/lib/db.ts), which stores data in a local
// SQLite file on disk (bun:sqlite, ./data/app.db by default).
//
// ============================================================

import type { StorageAdapter } from './storage';

export class ApiAdapter implements StorageAdapter {
  private dataPath(collection: string, id?: string): string {
    return '/api/data/' + collection + (id ? '/' + id : '');
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    if (!res.ok) {
      let msg = 'API error ' + res.status;
      try {
        const body = await res.json();
        if (body && body.error) msg = body.error;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  async getAll<T extends { id: string }>(collection: string): Promise<T[]> {
    return this.request<T[]>(this.dataPath(collection));
  }

  async getById<T extends { id: string }>(collection: string, id: string): Promise<T | null> {
    return this.request<T | null>(this.dataPath(collection, id));
  }

  async create<T extends { id: string }>(collection: string, item: Omit<T, 'id' | 'created_at' | 'updated_at'>): Promise<T> {
    const now = new Date().toISOString();
    const doc = { ...item, id: crypto.randomUUID(), created_at: now, updated_at: now } as T;
    return this.request<T>(this.dataPath(collection), {
      method: 'POST',
      body: JSON.stringify(doc),
    });
  }

  async update<T extends { id: string }>(collection: string, id: string, item: Partial<Omit<T, 'id'>>): Promise<T> {
    return this.request<T>(this.dataPath(collection, id), {
      method: 'PUT',
      body: JSON.stringify(item),
    });
  }

  async remove(collection: string, id: string): Promise<void> {
    await this.request<void>(this.dataPath(collection, id), { method: 'DELETE' });
  }

  async clear(collection: string): Promise<void> {
    await this.request<void>(this.dataPath(collection), { method: 'DELETE' });
  }
}
`;
const APP_ID_TS_PREFIX = `// ============================================================
// App ID \\u2014 injected by DeskSpawn at app creation time.
// DO NOT MODIFY: Uniquely identifies this app's IndexedDB.
// ============================================================

export const APP_ID = "`;

const APP_ID_TS_SUFFIX = `";
`;

const MAIN_TSX = `import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initStorage } from './lib/storage';
import './index.css';

// IndexedDB ストレージを初期化してからアプリを起動する
initStorage().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});`;

const INDEX_CSS = `@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
}

:root {
  --radius: 0.625rem;
  --background: #ffffff;
  --foreground: #242424;
  --card: #ffffff;
  --card-foreground: #242424;
  --popover: #ffffff;
  --popover-foreground: #242424;
  --primary: #343434;
  --primary-foreground: #fafafa;
  --secondary: #f5f5f5;
  --secondary-foreground: #343434;
  --muted: #f5f5f5;
  --muted-foreground: #888888;
  --accent: #f5f5f5;
  --accent-foreground: #343434;
  --destructive: #dc2626;
  --border: #e5e5e5;
  --input: #e5e5e5;
  --ring: #aaaaaa;
}

.dark {
  --background: #242424;
  --foreground: #fafafa;
  --card: #343434;
  --card-foreground: #fafafa;
  --popover: #343434;
  --popover-foreground: #fafafa;
  --primary: #eaeaea;
  --primary-foreground: #343434;
  --secondary: #444444;
  --secondary-foreground: #fafafa;
  --muted: #444444;
  --muted-foreground: #aaaaaa;
  --accent: #444444;
  --accent-foreground: #fafafa;
  --destructive: #b91c1c;
  --border: rgba(255, 255, 255, 0.1);
  --input: rgba(255, 255, 255, 0.15);
  --ring: #888888;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}`;

// ── Locale-aware file builders ───────────────────────────────────

function getAppTsx(locale: TemplateLocale): string {
  return `// ============================================================
//  DeskSpawn Generated App \u2014 Root Component
// ============================================================
//
//  \uD83D\uDCC1 App Structure:
//
//    src/
//      types/          \u2192 TypeScript type definitions
//        index.ts      \u2192  Re-export all types here
//        todo.ts       \u2192  One file per feature domain
//
//      store/          \u2192 Zustand state management
//        index.ts      \u2192  Re-export all stores here
//        todoStore.ts  \u2192  One store file per feature
//
//      api/            \u2192 API communication layer
//        client.ts     \u2192  Base fetch / Tauri invoke wrapper
//        todoApi.ts    \u2192  One API file per feature
//
//      hooks/          \u2192 Custom React hooks
//        index.ts      \u2192  Re-export all hooks here
//        useTodos.ts   \u2192  One hook file per feature
//
//      components/     \u2192 UI components
//        features/     \u2192  Feature-specific components
//        ui/           \u2192  Reusable primitives (create as needed)
//
//      lib/            \u2192 Utility functions
//      App.tsx         \u2192 \u2605 COMPOSITION ROOT (keep minimal)
//      main.tsx        \u2192 Entry point
//
//  \u26A0\uFE0F RULES:
//    1. App.tsx is the COMPOSITION ROOT only \u2014 keep it minimal
//    2. When adding a feature, ALWAYS create separate files:
//       types/X.ts + store/XStore.ts + components/X.tsx
//    3. Import from each directory in App.tsx to compose the app
//
// ============================================================

export function App() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-8">
      <div className="text-center space-y-4 max-w-md">
        <div className="flex justify-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <svg
              className="h-6 w-6 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
              />
            </svg>
          </div>
        </div>
        <h1 className="text-xl font-semibold">${locale.appWaitingTitle}</h1>
        <p className="text-sm text-muted-foreground">
          ${locale.appWaitingDescLine1}
          <br />
          ${locale.appWaitingDescLine2}
        </p>
      </div>
    </div>
  );
}`;
}

function getStoreIndex(locale: TemplateLocale): string {
  return [
    '// ============================================================',
    '//  State Management (Zustand)',
    '// ============================================================',
    '//',
    locale.storeGuideComment,
    '//    import { create } from "zustand";',
    '//',
    '//    interface TodoStore {',
    '//      todos: Todo[];',
    '//      addTodo: (title: string) => void;',
    '//      toggleTodo: (id: string) => void;',
    '//    }',
    '//',
    '//    export const useTodoStore = create<TodoStore>((set) => ({',
    '//      todos: [],',
    '//      addTodo: (title) =>',
    '//        set((state) => ({',
    '//          todos: [...state.todos, { id: crypto.randomUUID(), title, completed: false }],',
    '//        })),',
    '//      toggleTodo: (id) =>',
    '//        set((state) => ({',
    '//          todos: state.todos.map((t) =>',
    '//            t.id === id ? { ...t, completed: !t.completed } : t',
    '//          ),',
    '//        })),',
    '//    }));',
    '//',
    '// ============================================================',
    '',
    `// ${locale.storeReexportLabel}`,
    '// export { useTodoStore } from "./todoStore";',
  ].join('\n');
}

function getHooksIndex(locale: TemplateLocale): string {
  return [
    '// ============================================================',
    '//  Custom React Hooks',
    '// ============================================================',
    '//',
    locale.hooksGuideComment,
    '//    import { useTodoStore } from "@/store";',
    '//    import { useCallback } from "react";',
    '//',
    '//    export function useTodos() {',
    '//      const todos = useTodoStore((s) => s.todos);',
    '//      const addTodo = useTodoStore((s) => s.addTodo);',
    '//',
    '//      const handleAdd = useCallback(',
    '//        (title: string) => addTodo(title),',
    '//        [addTodo],',
    '//      );',
    '//',
    '//      return { todos, addTodo: handleAdd };',
    '//    }',
    '//',
    '// ============================================================',
    '',
    `// ${locale.hooksReexportLabel}`,
    '// export { useTodos } from "./useTodos";',
  ].join('\n');
}

function getTypesIndex(locale: TemplateLocale): string {
  return [
    '// ============================================================',
    '//  Type Definitions',
    '// ============================================================',
    '//',
    locale.typesGuideComment,
    '//    export interface Todo {',
    '//      id: string;',
    '//      title: string;',
    '//      completed: boolean;',
    '//    }',
    '//    export type TodoFilter = "all" | "active" | "completed";',
    '//',
    '// ============================================================',
    '',
    `// ${locale.typesReexportLabel}`,
    '// export type { Todo, TodoFilter } from "./todo";',
  ].join('\n');
}

// ── Public API ──────────────────────────────────────────────────

/** Default backend API port for desktop generated apps (ADR-010). */
export const DESKTOP_API_PORT = 4174;

/**
 * Returns the default app template files with content localized
 * for the given language.
 *
 * @param language - Language code (e.g. "ja", "en"). Falls back to "ja".
 * @param isDesktop - When true, emits the full-stack template (ADR-010):
 *   Hono backend (src/server.ts), bun:sqlite (src/lib/db.ts), vitest,
 *   and a vite config that proxies /api to the backend port.
 */
export function getTemplateFiles(
  language: LanguageCode,
  isDesktop: boolean = false,
): FileEntry[] {
  const locale = templateLocale[language] ?? templateLocale.ja;

  const files: FileEntry[] = [
    { path: "index.html", content: getIndexHtml(language) },
    {
      path: "package.json",
      content: isDesktop ? PACKAGE_JSON_DESKTOP : PACKAGE_JSON,
    },
    { path: "tsconfig.json", content: TSCONFIG_JSON },
    {
      path: "vite.config.ts",
      content: isDesktop ? getViteConfigDesktop(DESKTOP_API_PORT) : VITE_CONFIG,
    },
    { path: "public/favicon.svg", content: FAVICON_SVG },
    { path: "src/vite-env.d.ts", content: VITE_ENV_DTS },
    // storage.ts: desktop は Hono API + SQLite 実装 (storage-api.ts) を、
    // web は IndexedDB 実装 (storage-idb.ts) を使う (ADR-010)。
    {
      path: "src/lib/storage.ts",
      content: getStorageTs(isDesktop ? "api" : "idb"),
    },
    ...(isDesktop
      ? [{ path: "src/lib/storage-api.ts", content: STORAGE_API_TS }]
      : [{ path: "src/lib/storage-idb.ts", content: STORAGE_IDB_TS }]),
    { path: "src/lib/app-id.ts", content: APP_ID_TS_PREFIX + "__DESKSPAWN_APP_ID__" + APP_ID_TS_SUFFIX },
    { path: "src/main.tsx", content: MAIN_TSX },
    { path: "src/index.css", content: INDEX_CSS },
    { path: "src/App.tsx", content: getAppTsx(locale) },
    { path: "src/store/index.ts", content: getStoreIndex(locale) },
    { path: "src/hooks/index.ts", content: getHooksIndex(locale) },
    { path: "src/types/index.ts", content: getTypesIndex(locale) },
  ];

  if (isDesktop) {
    // Full-stack additions (ADR-010): Hono API + bun:sqlite + vitest.
    files.push(
      { path: "src/server.ts", content: SERVER_TS },
      { path: "src/lib/db.ts", content: DB_TS },
      { path: "src/server.test.ts", content: SERVER_TEST_TS },
    );
  }

  return files;
}

/**
 * @deprecated Use `getTemplateFiles(language)` for locale-aware templates.
 *             This constant is kept for backward compatibility and uses Japanese.
 */
export const DEFAULT_TEMPLATE_FILES: FileEntry[] = getTemplateFiles("ja");
