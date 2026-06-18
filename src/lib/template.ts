import type { FileEntry } from "./storage-opfs";
import type { LanguageCode } from "./languages";
import { templateLocale, type TemplateLocale } from "./template-locale";

// ============================================================
// Default Project Template (React + Vite + Tailwind CSS v4)
//
// Copied into every new project created in the browser version.
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

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#6366f1"/>
  <polygon points="56,12 20,54 46,54 40,88 78,40 52,40" fill="white"/>
</svg>`;

const VITE_ENV_DTS = `/// <reference types="vite/client" />
`;

const STORAGE_TS = `// ============================================================
// Storage Adapter Interface
// ============================================================
//
// Pre-installed storage adapter for persistent data.
// AI agents: Import via @/lib/storage - do NOT modify this file.
//
// ============================================================

import { PROJECT_ID } from './project-id';

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

export async function initStorage(): Promise<StorageAdapter> {
  const { IndexedDBAdapter } = await import('./storage-idb');
  _instance = await IndexedDBAdapter.create(PROJECT_ID);
  return _instance!;
}
`;

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

const PROJECT_ID_TS_PREFIX = `// ============================================================
// Project ID \\u2014 injected by DeskSpawn at project creation time.
// DO NOT MODIFY: Uniquely identifies this project's IndexedDB.
// ============================================================

export const PROJECT_ID = "`;

const PROJECT_ID_TS_SUFFIX = `";
`;

const MAIN_TSX = `import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;

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
//  \uD83D\uDCC1 Project Structure:
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

/**
 * Returns the default project template files with content localized
 * for the given language.
 *
 * @param language - Language code (e.g. "ja", "en"). Falls back to "ja".
 */
export function getTemplateFiles(language: LanguageCode): FileEntry[] {
  const locale = templateLocale[language] ?? templateLocale.ja;

  return [
    { path: "index.html", content: getIndexHtml(language) },
    { path: "package.json", content: PACKAGE_JSON },
    { path: "tsconfig.json", content: TSCONFIG_JSON },
    { path: "vite.config.ts", content: VITE_CONFIG },
    { path: "public/favicon.svg", content: FAVICON_SVG },
    { path: "src/vite-env.d.ts", content: VITE_ENV_DTS },
    { path: "src/lib/storage.ts", content: STORAGE_TS },
    { path: "src/lib/storage-idb.ts", content: STORAGE_IDB_TS },
    { path: "src/lib/project-id.ts", content: PROJECT_ID_TS_PREFIX + "__DESKSPAWN_PROJECT_ID__" + PROJECT_ID_TS_SUFFIX },
    { path: "src/main.tsx", content: MAIN_TSX },
    { path: "src/index.css", content: INDEX_CSS },
    { path: "src/App.tsx", content: getAppTsx(locale) },
    { path: "src/store/index.ts", content: getStoreIndex(locale) },
    { path: "src/hooks/index.ts", content: getHooksIndex(locale) },
    { path: "src/types/index.ts", content: getTypesIndex(locale) },
  ];
}

/**
 * @deprecated Use `getTemplateFiles(language)` for locale-aware templates.
 *             This constant is kept for backward compatibility and uses Japanese.
 */
export const DEFAULT_TEMPLATE_FILES: FileEntry[] = getTemplateFiles("ja");
