/**
 * HTTP server for the DeskSpawn sidecar.
 * Provides a REST API for the frontend (WebView) to manage projects, previews,
 * checkpoints, installs, and the /v1 OpenAI-compatible proxy.
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import { ChildProcess, spawn, spawnSync, execSync, execFileSync } from 'child_process';
import * as executors from './tool-executors.js';
import { createSerialQueue } from './install-queue.js';
import { initMCPClients, closeMCPClients } from './mcp-client.js';
import { findListeningPids, nextFallbackPort } from './port-utils.js';
// preview import removed — no longer needed (no Tauri backend)

// ── In-memory API key store (received from Rust backend, never from frontend) ─
// 一元管理ルート（ADR-007）: ~/deskspawn 配下に全データを集約。
// bun compile の exe では __dirname が実行時cwd依存（B:等の一時ドライブに
// 解決されうる）ため、プロジェクト保存先は確実に存在するホーム基準にする。
const DESKSPAWN_ROOT = process.env.DESKSPAWN_ROOT || path.join(os.homedir(), 'deskspawn');
// #98 project→app rename: Rust/フロントは ~/deskspawn/apps + apps.json を使用（ADR-007〜012）。
// ここが projects のまま残っていると、プレビューが存在しないディレクトリを参照して
// 「Project has no package.json」になる（実績 2026-08-07）。旧env名は互換のため維持。
const PROJECTS_DIR = process.env.DESKSPAWN_PROJECTS_DIR || path.join(DESKSPAWN_ROOT, 'apps');
const PROJECTS_JSON = path.join(PROJECTS_DIR, 'apps.json');
const TEMPLATE_DIR = process.env.DESKSPAWN_TEMPLATES_DIR || path.join(DESKSPAWN_ROOT, 'templates', 'react-template');
const WORKSPACE_DEV_PORT = 5174;
let workspaceDevActualPort = WORKSPACE_DEV_PORT;

/**
 * Bun executable path resolution — the Windows host is kept minimal
 * (no Node.js/npm), so all package install / dev-server commands go through Bun.
 *
 * 監査(2026-08-27)で検出: 以前は実ユーザー名入りの絶対パスがハードコードされており、
 * public リポジトリへの情報混入 + 他マシンで preview 機能が全滅する問題があった。
 * 環境非依存の解決順:
 *   1. process.env.BUN_PATH（明示指定があれば最優先。配布時の同梱bun切替にも使用）
 *   2. PATH 探索（Windows: `where bun` / Unix: `which bun`）
 *   3. ~/dev/tools/bun/bun-windows-x64/bun.exe（os.homedir() ベースの既定レイアウト）
 * 全て見つからなければ null を返す（呼び出し側で明示的エラーにする）。
 */
function resolveBunPath(): string | null {
  const fromEnv = process.env.BUN_PATH;
  if (fromEnv) return fromEnv;

  try {
    const lookupCmd = process.platform === 'win32' ? 'where' : 'which';
    const res = spawnSync(lookupCmd, ['bun'], { encoding: 'utf-8' });
    if (res.status === 0 && res.stdout) {
      const first = res.stdout.split(/\r?\n/)[0].trim();
      if (first && fs.existsSync(first)) return first;
    }
  } catch {
    // PATH 探索に失敗してもフォールバックへ進む
  }

  const homeFallback = path.join(os.homedir(), 'dev', 'tools', 'bun', 'bun-windows-x64', 'bun.exe');
  if (fs.existsSync(homeFallback)) return homeFallback;

  return null;
}

/** Bun が見つからない場合の共通エラー（エラー文字列に絶対パスは含めない）。 */
function bunNotFoundError(): Error {
  return new Error(
    '[sidecar] Bun 実行ファイルが見つかりません。BUN_PATH 環境変数で bun のパスを指定するか、' +
      'bun を PATH に追加して再試行してください。',
  );
}

// ── セキュリティ検証ヘルパー（監査 2026-08-28）────────────────────────────────
// Critical-1（devスクリプト任意実行）/ Critical-2（SSRF・APIキー漏洩）/
// High-1（appId/projectId パストラバーサル）の対策。
// 各関数は純粋・自己完結。エラー文字列に絶対パスや内部情報は含めない。

/** UUID 形式（sidecar のプロジェクトID）または Rust 形式 app-<32hex> のみ許可。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUST_APP_ID_RE = /^app-[0-9a-f]{32}$/;

/**
 * appId / projectId として安全な形式かを検証する（High-1 パストラバーサル対策）。
 * path.join(PROJECTS_DIR, id) に渡す前に必ず通すこと。../ や絶対パス、
 * ドライブ文字、スラッシュ等を含む文字列は全て拒否する。
 */
function validateAppIdLike(id: string): boolean {
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return false;
  const lower = id.toLowerCase();
  return UUID_RE.test(lower) || RUST_APP_ID_RE.test(lower);
}

/** IPv4 がプライベート/リンクローカル/ループバック/未指定かを判定する。 */
function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16（リンクローカル・メタデータ）
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 ループバック全体
  return false;
}

/** IPv6 アドレスを 8 グループの数値配列に展開する。パース不能なら null。 */
function parseIPv6Groups(host: string): number[] | null {
  // IPv4 射影のドット表記（::ffff:a.b.c.d）— WHATWG URL は16進正規化するため通常は来ないが保険
  const v4mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4mapped) {
    const parts = v4mapped[1].split('.').map(Number);
    if (parts.some((p) => p < 0 || p > 255)) return null;
    return [0, 0, 0, 0, 0, 0xffff, (parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]];
  }
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const isCompressed = host.includes('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (!isCompressed && left.length !== 8) return null;
  const parseGroup = (s: string): number | null => (/^[0-9a-f]{1,4}$/i.test(s) ? parseInt(s, 16) : null);
  const groups: number[] = [];
  for (const g of left) {
    const v = parseGroup(g);
    if (v === null) return null;
    groups.push(v);
  }
  if (isCompressed) {
    const fill = 8 - left.length - right.length;
    if (fill < 1) return null;
    for (let i = 0; i < fill; i++) groups.push(0);
  }
  for (const g of right) {
    const v = parseGroup(g);
    if (v === null) return null;
    groups.push(v);
  }
  if (groups.length !== 8) return null;
  return groups;
}

/**
 * 上流URL（カスタムエンドポイント）を検証する（Critical-2 SSRF対策）。
 * https のみ・localhost/ループバック/プライベートIP/*.local/IPv6ローカルを拒否。
 * クエリ/パスは到達許可（API パスは /v1 が付与される）。
 * 注意: WHATWG URL は 10進/16進IP（2130706433 等）を正規化するため、
 * 正規化後の hostname を検査すれば変形IPも捕捉できる。
 */
function validateUpstreamUrl(raw: string): { ok: boolean; error?: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'URL が指定されていません' };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'URL を解析できません' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'https の URL のみ許可されます' };
  }
  // WHATWG URL は変形IPv4（10進/16進/末尾ドット等）を正規化するため、
  // 正規化後の hostname を検査すれば変形IPも捕捉できる。
  let host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase(); // IPv6 の [] を除去
  if (host.endsWith('.')) host = host.slice(0, -1); // 末尾ドット形式（FQDN IP）対策
  if (!host) {
    return { ok: false, error: 'ホスト名が指定されていません' };
  }
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '::' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost')
  ) {
    return { ok: false, error: 'ローカルアドレスへの接続は許可されません' };
  }
  if (host.endsWith('.local')) {
    return { ok: false, error: 'ローカルアドレスへの接続は許可されません' };
  }
  // IPv6: 8グループに展開してリンクローカル / ユニークローカル / IPv4射影を検査する
  const v6 = parseIPv6Groups(host);
  if (v6) {
    const g0 = v6[0];
    // リンクローカル fe80::/10 と旧サイトローカル fec0::/10
    if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) {
      return { ok: false, error: 'ローカルアドレスへの接続は許可されません' };
    }
    // ユニークローカル fc00::/7（fc00:/fd00: を含む）
    if ((g0 & 0xfe00) === 0xfc00) {
      return { ok: false, error: 'ローカルアドレスへの接続は許可されません' };
    }
    // IPv4射影 ::ffff:0:0/96 → 埋め込みIPv4を通常検査に回す
    if (v6[0] === 0 && v6[1] === 0 && v6[2] === 0 && v6[3] === 0 && v6[4] === 0 && v6[5] === 0xffff) {
      const ipv4 = `${(v6[6] >> 8) & 0xff}.${v6[6] & 0xff}.${(v6[7] >> 8) & 0xff}.${v6[7] & 0xff}`;
      if (isPrivateIPv4(ipv4)) {
        return { ok: false, error: 'ローカルアドレスへの接続は許可されません' };
      }
    }
    // 上記以外の IPv6 は公開アドレスとして許可
    return { ok: true };
  }
  if (isPrivateIPv4(host)) {
    return { ok: false, error: 'プライベートアドレスへの接続は許可されません' };
  }
  return { ok: true };
}

/**
 * package.json の scripts.dev が "vite" と完全一致する場合のみ許可する
 * （Critical-1 実行時ブロック: AI が scripts.dev を任意コードに書き換えても
 * `bun run dev` で実行させない）。エラーにスクリプト内容・絶対パスは含めない。
 */
function validateDevScript(dir: string): { ok: boolean; error?: string } {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, 'package.json'), 'utf-8');
  } catch {
    return { ok: false, error: 'package.json を読み込めません' };
  }
  let pkg: unknown;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'package.json が壊れています' };
  }
  const scripts = (pkg && typeof pkg === 'object' ? (pkg as { scripts?: unknown }).scripts : undefined);
  const dev = scripts && typeof scripts === 'object' ? (scripts as { dev?: unknown }).dev : undefined;
  if (typeof dev !== 'string') {
    return { ok: false, error: 'devスクリプトが定義されていません' };
  }
  if (dev !== 'vite') {
    return { ok: false, error: 'devスクリプトが変更されています。vite のみ実行できます' };
  }
  return { ok: true };
}

const app = express();

// ── H1: 認証トークン ──────────────────────────────────────────────────────────
// Rust が起動時に生成し DESKSPAWN_AUTH_TOKEN で渡す。外部オリジン（任意の
// Web サイトのタブ）からの無認証アクセスを防ぐ。未設定時は開発モードとみなし
// 警告ログを出して認証をスキップする（bun run server.ts での単体起動用）。
const AUTH_TOKEN = process.env.DESKSPAWN_AUTH_TOKEN || '';
if (!AUTH_TOKEN) {
  console.warn('[sidecar] DESKSPAWN_AUTH_TOKEN not set — running WITHOUT auth (dev mode only!)');
}

// CORS: DeskSpawn の WebView / 開発サーバー オリジンのみ許可。
// 任意オリジン許可（cors() デフォルト）はブラウザタブ攻撃を許すため禁止。
const ALLOWED_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'http://localhost:5173', // デスクトップ dev (tauri.conf.json devUrl)
  'http://127.0.0.1:5173',
  'http://localhost:5178', // Web 版 E2E dev サーバー
  'http://127.0.0.1:5178',
];
app.use(cors({ origin: ALLOWED_ORIGINS }));

// 認証ミドルウェア: X-DeskSpawn-Token ヘッダ必須（トークン設定時）。
// トークンは Rust の IPC（get_sidecar_token）経由でのみ WebView 内 JS が取得でき、
// 外部オリジンの Web ページからは到達できない。
// 注意: bun ランタイムでは `req.headers['x-deskpawn-token']` のブラケットアクセスが
// 効かない（null を返す）ため、Express の req.get() + Object.keys フォールバックを使う。
function getHeader(req: any, name: string): string {
  const viaGet = req.get(name);
  if (typeof viaGet === 'string') return viaGet;
  const lower = name.toLowerCase();
  const keys = Object.keys(req.headers);
  for (const k of keys) {
    if (k.toLowerCase() === lower) {
      const raw = req.headers[k];
      return typeof raw === 'string' ? raw : Array.isArray(raw) ? (raw[0] ?? '') : '';
    }
  }
  return '';
}

app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next(); // dev モード（トークン未設定）
  if (getHeader(req, 'X-DeskSpawn-Token') !== AUTH_TOKEN) {
    res.status(401).json({ error: 'Unauthorized', errorCode: 'UNAUTHORIZED' });
    return;
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// ── Port resolution with fallback ────────────────────────────────────────────
const DESIRED_PORT = process.env.PORT ? parseInt(process.env.PORT) : 3009;
let ACTUAL_PORT = DESIRED_PORT;

// ── Unhandled error resilience ───────────────────────────────────────────────
// 起動フェーズ（startServer 成功まで）の例外・rejection は握りつぶさず再 throw して、
// 異常な状態のまま起動し続けるのを防ぐ。起動完了後はログのみで継続する。
let serverStarted = false;
process.on('uncaughtException', (err) => {
  console.error('[sidecar] UNCAUGHT EXCEPTION — sidecar continuing:', err);
  if (!serverStarted) throw err;
});
process.on('unhandledRejection', (reason) => {
  console.error('[sidecar] UNHANDLED REJECTION — sidecar continuing:', reason);
  if (!serverStarted) throw reason;
});

// ── Workspace dev server process management ─────────────────────────────────

let workspaceDevProcess: ChildProcess | null = null;
let workspaceDevReady = false;
/** 直近のdev server出力（Viteエラー検出用・上限200行） */
const workspaceDevLog: string[] = [];
const MAX_DEV_LOG_LINES = 200;

/** Viteエラーと判定するパターン（1行単位・webcontainer.ts と同等） */
const VITE_ERROR_PATTERNS: RegExp[] = [
  /✗\s*\[vite\]/,
  /✗\s*Internal server error/,
  /✗\s*\[plugin:/,
  /\[vite\] Internal server error/,
  /Failed to resolve import/,
  /Could not resolve/,
  /Module not found/,
  /✗\s*(?:Error|error)/,
  /error when starting dev server/i,
  /✗\s*Build error/,
];

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
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 rx=%2220%22 fill=%22%236366f1%22/><polygon points=%2256,12 20,54 46,54 40,88 78,40 52,40%22 fill=%22white%22/></svg>" /><title>${name}</title></head>
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

const BACKUP_URL = "http://localhost:3009/data-backup";

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

// ── Windows-aware process tree kill ─────────────────────────────────────────
// Windows では child.kill('SIGTERM') は直接の子（bun.exe）しか殺せず、detached:true で
// 起動した vite 本体（node.exe）は orphan 化する。process.kill(-pid) も Windows では
// 負PIDが無効でthrowするため、必ず platform 分岐して taskkill /T /F を使う。
function killProcessTree(pid: number) {
  if (!pid) return;
  // 自分自身を kill しない防御（netstat/lsof が自分の LISTENING を拾った場合など）
  if (pid === process.pid) {
    console.warn(`[kill] Refusing to kill self (PID ${pid})`);
    return;
  }
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 5000, stdio: 'pipe' });
    } else {
      try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
  } catch {
    // 既に死んでいる/権限なし — 無害
  }
}

/** ポートを掴むプロセスを特定してツリーごと殺す。 */
function killPortOwner(port: number, label: string) {
  if (process.platform !== 'win32') {
    try {
      const pid = execSync(`lsof -ti:${port} 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 }).trim();
      if (pid) {
        console.log(`[${label}] Killing orphan PID ${pid} holding port ${port}...`);
        execSync(`kill -9 ${pid} 2>/dev/null`, { timeout: 3000 });
      }
    } catch { /* no orphan */ }
    return;
  }
  try {
    // -p tcp を付けると [::1] (IPv6) の LISTENING 行が出力されない → 付けない
    const out = execSync('netstat -ano', { encoding: 'utf-8', timeout: 5000 });
    for (const pid of findListeningPids(out, [port])) {
      console.log(`[${label}] Killing orphan PID ${pid} holding port ${port}...`);
      killProcessTree(pid);
    }
  } catch { /* no orphan */ }
}

/**
 * ポート帯 [start, start+count) を掴むプロセスを一括掃除する。
 *
 * ⚠️ 注意: このポート帯は DeskSpawn 専用とみなして LISTENING 中のプロセスを
 * 無差別に kill する（Windows では orphan 化した vite を特定できないため）。
 * 他アプリが同じポート帯を使っている場合は巻き込まれる可能性がある。
 */
function killPortOwnersInBand(startPort: number, count: number, label: string) {
  if (process.platform !== 'win32') {
    for (let p = startPort; p < startPort + count; p++) killPortOwner(p, label);
    return;
  }
  try {
    const out = execSync('netstat -ano', { encoding: 'utf-8', timeout: 5000 });
    const ports = Array.from({ length: count }, (_, i) => startPort + i);
    for (const pid of findListeningPids(out, ports)) {
      console.log(`[${label}] Killing orphan PID ${pid} holding dev port...`);
      killProcessTree(pid);
    }
  } catch { /* no orphan */ }
}

/** kill後、ポートが応答しなくなるまでポーリング（Windowsは解放にラグがある）。 */
async function waitForPortFree(port: number, timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let responding = false;
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      try {
        const res = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(400) });
        if (res) { responding = true; break; }
      } catch { /* not responding */ }
    }
    if (!responding) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function stopWorkspaceDevServer() {
  if (workspaceDevProcess && workspaceDevProcess.pid) {
    console.log('[devserver] Stopping workspace dev server (tree kill)...');
    killProcessTree(workspaceDevProcess.pid);
  }
  // 旧残骸がポート帯を掴んだままにならないよう一括掃除（5174〜5179）
  killPortOwnersInBand(WORKSPACE_DEV_PORT, 6, 'devserver');
  workspaceDevProcess = null;
  workspaceDevReady = false;
}

/**
 * Kill any orphan process that might be holding the workspace dev ports,
 * e.g. from a previous Tauri session that didn't clean up.
 */
function killOrphanDevServer() {
  killPortOwnersInBand(WORKSPACE_DEV_PORT, 6, 'devserver');
}

// ── Generated-app API server (full-stack, ADR-010) ─────────────────────────
// The desktop template includes a Hono backend (src/server.ts, bun:sqlite).
// The sidecar spawns it as a child (default port 4174, auto-fallback up to
// +10) and patches vite.config.ts's /api proxy target to the actual port.

const API_DESIRED_PORT = 4174;
const API_MAX_FALLBACK = 10;
let apiProcess: ReturnType<typeof spawn> | null = null;
let apiActualPort = API_DESIRED_PORT;
let apiReady = false;

function stopApiServer() {
  if (apiProcess && apiProcess.pid) {
    console.log('[apiserver] Stopping API server (tree kill)...');
    killProcessTree(apiProcess.pid);
  }
  // 旧残骸がAPIポート帯を掴んだままにならないよう一括掃除（4174〜4184）
  killPortOwnersInBand(API_DESIRED_PORT, API_MAX_FALLBACK + 1, 'apiserver');
  apiProcess = null;
  apiReady = false;
}

/** Patch vite.config.ts's /api proxy target to the actual API port. */
function patchViteConfigApiProxy(dir: string, apiPort: number) {
  const viteConfigPath = path.join(dir, 'vite.config.ts');
  if (!fs.existsSync(viteConfigPath)) return;
  let config = fs.readFileSync(viteConfigPath, 'utf-8');
  // Replace any localhost:port in the proxy target block with the real port.
  config = config.replace(
    /(target:\s*"http:\/\/localhost:)\d+(")/,
    `$1${apiPort}$2`,
  );
  fs.writeFileSync(viteConfigPath, config, 'utf-8');
  console.log(`[apiserver] vite proxy patched to http://localhost:${apiPort}`);
}

/**
 * Start the generated app's Hono backend (bun src/server.ts) with port
 * fallback: try 4174..4174+10, detect the actual port via HTTP polling.
 * Returns the actual port or 0 on failure.
 */
async function startApiServer(dir: string): Promise<number> {
  stopApiServer();
  const serverTs = path.join(dir, 'src', 'server.ts');
  if (!fs.existsSync(serverTs)) {
    // Plain web template (no backend) — nothing to start.
    return 0;
  }

  const bun = resolveBunPath();
  if (!bun) throw bunNotFoundError();

  for (let attempt = 0; attempt <= API_MAX_FALLBACK; attempt++) {
    const port = API_DESIRED_PORT + attempt;
    console.log(`[apiserver] Starting API server on port ${port}...`);
    const child = spawn(bun, ['src/server.ts'], {
      cwd: dir,
      stdio: 'pipe',
      detached: true,
      env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
    });
    let childAlive = true;
    child.stdout?.on('data', (d: Buffer) => console.log(`[apiserver] ${d.toString().trim()}`));
    child.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString();
      console.warn(`[apiserver:err] ${msg.trim()}`);
      // Port-in-use detection: Bun prints EADDRINUSE on stderr.
      if (/EADDRINUSE|Address already in use|listen EADDRINUSE/.test(msg)) {
        child.kill('SIGTERM');
        childAlive = false;
        return;
      }
    });
    child.on('exit', (code) => {
      childAlive = false;
      if (apiProcess === child) {
        console.log(`[apiserver] Exited with code ${code}`);
        apiReady = false;
      }
    });

    // 子が死んだポート（EADDRINUSE等）は残骸扱いせず採用しない。
    // 旧API残骸が応答しても childAlive=false なら次へ進む。
    const exited = new Promise<boolean>((resolve) => child.once('exit', () => resolve(false)));
    const ready = await Promise.race([waitForApiPort(port, 5000), exited]);
    if (ready && childAlive) {
      apiProcess = child;
      apiActualPort = port;
      apiReady = true;
      console.log(`[apiserver] API server ready at http://localhost:${port}`);
      patchViteConfigApiProxy(dir, port);
      return port;
    }
    // Not ready — likely port conflict; kill tree and try next.
    killProcessTree(child.pid ?? 0);
    await new Promise((r) => setTimeout(r, 300));
  }
  console.error('[apiserver] Failed to start API server after fallback attempts');
  return 0;
}

/** Poll http://localhost:<port>/api/health until ready or timeout. */
function waitForApiPort(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:${port}/api/health`, {
          signal: AbortSignal.timeout(800),
        });
        if (res.ok) {
          clearInterval(timer);
          resolve(true);
          return;
        }
      } catch { /* retry */ }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(false);
        return;
      }
    }, 400);
  });
}

async function startWorkspaceDevServer(dir: string) {
  // Critical-1: package.json の scripts.dev が "vite" 以外（例: AI が書き換えた任意コード）なら
  // 起動しない。エラーは呼び出し元の try/catch で 500 系応答になる（内容にパスは含めない）。
  const devCheck = validateDevScript(dir);
  if (!devCheck.ok) {
    throw new Error(`[sidecar] ${devCheck.error || 'dev script validation failed'}`);
  }
  stopWorkspaceDevServer();
  killOrphanDevServer();
  const bun = resolveBunPath();
  if (!bun) throw bunNotFoundError();
  // Windows は taskkill 後のポート解放にラグがある → 解放を待ってから起動
  await waitForPortFree(WORKSPACE_DEV_PORT);
  // 起動前に既応答ポートをベースライン記録（旧残骸をポーリングで拾わない）
  await recordBaselineDevPorts();

  console.log(`[devserver] Starting dev server in ${dir}...`);
  workspaceDevReady = false;
  // Ensure the project's vite.config.ts ignores .deskspawn/ to prevent
  // unnecessary HMR reloads when checkpoints are created/restored.
  patchViteConfigForDotDeskspawn(dir);

  // Host has no npm — use Bun (resolveBunPath() で解決, shell:false).
  // PORT env は vite に効かないため CLI オプションでポートを固定する
  const child = spawn(bun, ['run', 'dev', '--', '--port', String(WORKSPACE_DEV_PORT)], {
    cwd: dir,
    stdio: 'pipe',
    detached: true,
    env: { ...process.env, PORT: String(WORKSPACE_DEV_PORT) },
  });

  workspaceDevProcess = child;

  // チャンク分割で行が分断されても確実にパースするための行バッファ
  let devLineBuf = '';
  child.stdout?.on('data', (data: Buffer) => {
    devLineBuf += data.toString();
    const lines = devLineBuf.split('\n');
    devLineBuf = lines.pop() || ''; // 最後の不完全行は次チャンクへ持ち越し
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      // 直近出力をバッファ（Viteエラー検出用）
      workspaceDevLog.push(line);
      if (workspaceDevLog.length > MAX_DEV_LOG_LINES) workspaceDevLog.shift();
      console.log(`[devserver] ${line}`);
      // Parse actual port from Vite's "Local:" line, e.g. "➜  Local:   http://localhost:5174/"
      const portMatch = line.match(/Local:\s+https?:\/\/localhost:(\d+)/);
      if (portMatch) {
        const parsedPort = parseInt(portMatch[1], 10);
        if (!isNaN(parsedPort)) {
          workspaceDevActualPort = parsedPort;
          console.log(`[devserver] Detected actual port: ${parsedPort}`);
        }
        workspaceDevReady = true;
        console.log('[devserver] Workspace dev server is ready');
      }
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

/**
 * bun install はグローバルキャッシュ（%USERPROFILE%\.bun）を共有するため、
 * 並行実行するとロック競合で失敗する（実績 2026-08-12: アプリ連続作成時に
 * 「npm install exited with code 1」が発生）。直列キューで同時実行を防ぐ。
 */
const enqueueInstall = createSerialQueue();

/** install 本体（直列キュー経由で呼ばれる）。失敗時は一度だけリトライする。 */
async function runInstall(dir: string): Promise<void> {
  try {
    await spawnInstall(dir);
  } catch (e) {
    console.warn(`[projects] install failed, retrying once: ${e instanceof Error ? e.message : e}`);
    await spawnInstall(dir);
  }
}

function spawnInstall(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const bun = resolveBunPath();
    if (!bun) {
      reject(bunNotFoundError());
      return;
    }
    console.log(`[projects] Installing dependencies in ${dir}...`);
    // Host has no npm — use Bun (resolveBunPath() で解決, shell:false).
    const child = spawn(bun, ['install', '--ignore-scripts'], {
      cwd: dir,
      stdio: 'pipe',
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

function installDeps(dir: string): Promise<void> {
  return enqueueInstall(() => runInstall(dir));
}

// ── Project Management Endpoints ─────────────────────────────────────────────

// List all projects
app.get('/projects/list', (_req, res) => {
  try {
    const projects = readProjectsJson();
    res.json({ projects });
  } catch (e: any) {
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
  }
});

// Create new project
app.post('/projects/new', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Project name is required', errorCode: 'PROJECT_NAME_REQUIRED' });
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
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
  }
});

// Switch to an existing project
app.post('/projects/switch', (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      res.status(400).json({ error: 'projectId is required', errorCode: 'PROJECT_ID_REQUIRED' });
      return;
    }
    if (!validateAppIdLike(projectId)) {
      res.status(400).json({ error: 'Invalid projectId', errorCode: 'INVALID_PROJECT_ID' });
      return;
    }

    const projects = readProjectsJson();
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found', errorCode: 'PROJECT_NOT_FOUND' });
      return;
    }

    const projectDir = path.join(PROJECTS_DIR, projectId);
    if (!fs.existsSync(projectDir)) {
      res.status(404).json({ error: 'Project directory not found', errorCode: 'PROJECT_DIR_NOT_FOUND' });
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
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
  }
});

// ── Checkpoints (real files under <app>/.deskspawn/checkpoints/) ─────────────
// Desktop persistence for the frontend checkpoint system. Previously the
// frontend wrote full file snapshots into WebView IndexedDB on every AI run
// (web-storage audit 2026-08-12) — now the sidecar owns them as real files.

function resolveAppDir(appId: string): string {
  // High-1: パストラバーサル防御。path.join に渡す前に ID 形式を検証する。
  // エンドポイント側でも 400 で事前拒否するが、ここは全コールサイト共通の最終防壁。
  if (!validateAppIdLike(appId)) {
    throw new Error('[sidecar] Invalid appId');
  }
  return path.join(PROJECTS_DIR, appId);
}

// Create a checkpoint for an app
app.post('/api/checkpoints', async (req, res) => {
  try {
    const { appId, checkpointId } = req.body || {};
    if (!appId) {
      res.status(400).json({ error: 'appId is required', errorCode: 'APP_ID_REQUIRED' });
      return;
    }
    if (!validateAppIdLike(appId)) {
      res.status(400).json({ error: 'Invalid appId', errorCode: 'INVALID_APP_ID' });
      return;
    }
    const dir = resolveAppDir(appId);
    if (!fs.existsSync(dir)) {
      res.status(404).json({ error: 'App directory not found', errorCode: 'APP_DIR_NOT_FOUND' });
      return;
    }
    const id = await executors.createCheckpoint(dir, checkpointId);
    res.json({ id });
  } catch (e: any) {
    res.status(500).json({ error: e.message, errorCode: 'CHECKPOINT_CREATE_FAILED' });
  }
});

// Restore an app from a checkpoint
app.post('/api/checkpoints/restore', async (req, res) => {
  try {
    const { appId, checkpointId } = req.body || {};
    if (!appId || !checkpointId) {
      res.status(400).json({ error: 'appId and checkpointId are required', errorCode: 'PARAMS_REQUIRED' });
      return;
    }
    if (!validateAppIdLike(appId)) {
      res.status(400).json({ error: 'Invalid appId', errorCode: 'INVALID_APP_ID' });
      return;
    }
    const dir = resolveAppDir(appId);
    if (!fs.existsSync(dir)) {
      res.status(404).json({ error: 'App directory not found', errorCode: 'APP_DIR_NOT_FOUND' });
      return;
    }
    await executors.restoreCheckpoint(dir, checkpointId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message, errorCode: 'CHECKPOINT_RESTORE_FAILED' });
  }
});

// List checkpoints for an app (newest first)
app.get('/api/checkpoints', (req, res) => {
  try {
    const appId = String(req.query.appId || '');
    if (!appId) {
      res.status(400).json({ error: 'appId is required', errorCode: 'APP_ID_REQUIRED' });
      return;
    }
    if (!validateAppIdLike(appId)) {
      res.status(400).json({ error: 'Invalid appId', errorCode: 'INVALID_APP_ID' });
      return;
    }
    const dir = resolveAppDir(appId);
    if (!fs.existsSync(dir)) {
      res.status(404).json({ error: 'App directory not found', errorCode: 'APP_DIR_NOT_FOUND' });
      return;
    }
    const checkpoints = executors.listCheckpoints(dir);
    res.json({ checkpoints });
  } catch (e: any) {
    res.status(500).json({ error: e.message, errorCode: 'CHECKPOINT_LIST_FAILED' });
  }
});

// Delete checkpoints newer than keepId (keep from keepId and older)
app.post('/api/checkpoints/delete-after', (req, res) => {
  try {
    const { appId, keepId } = req.body || {};
    if (!appId || !keepId) {
      res.status(400).json({ error: 'appId and keepId are required', errorCode: 'PARAMS_REQUIRED' });
      return;
    }
    if (!validateAppIdLike(appId)) {
      res.status(400).json({ error: 'Invalid appId', errorCode: 'INVALID_APP_ID' });
      return;
    }
    const dir = resolveAppDir(appId);
    executors.deleteCheckpointsAfter(dir, keepId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message, errorCode: 'CHECKPOINT_DELETE_AFTER_FAILED' });
  }
});

// Delete ALL checkpoints for an app (app deletion)
app.delete('/api/checkpoints', (req, res) => {
  try {
    const appId = String(req.query.appId || '');
    if (!appId) {
      res.status(400).json({ error: 'appId is required', errorCode: 'APP_ID_REQUIRED' });
      return;
    }
    if (!validateAppIdLike(appId)) {
      res.status(400).json({ error: 'Invalid appId', errorCode: 'INVALID_APP_ID' });
      return;
    }
    const checkpointsDir = path.join(resolveAppDir(appId), '.deskspawn', 'checkpoints');
    if (fs.existsSync(checkpointsDir)) {
      fs.rmSync(checkpointsDir, { recursive: true, force: true });
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message, errorCode: 'CHECKPOINT_DELETE_ALL_FAILED' });
  }
});

// Delete a project
app.delete('/projects/:id', (req, res) => {
  try {
    const { id } = req.params;

    if (!validateAppIdLike(id)) {
      res.status(400).json({ error: 'Invalid project id', errorCode: 'INVALID_PROJECT_ID' });
      return;
    }

    const projects = readProjectsJson();
    const projectIndex = projects.findIndex((p) => p.id === id);

    if (projectIndex === -1) {
      res.status(404).json({ error: 'Project not found', errorCode: 'PROJECT_NOT_FOUND' });
      return;
    }

    // Don't allow deleting the currently active project
    const workspaceDir = executors.getWorkspaceDir();
    if (path.basename(workspaceDir) === id) {
      res.status(400).json({ error: 'Cannot delete the currently active project. Switch to a different project first.', errorCode: 'PROJECT_DELETE_ACTIVE' });
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
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
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
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
  }
});

app.get('/projects/file', async (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ error: 'path query parameter is required', errorCode: 'PATH_REQUIRED' });
      return;
    }
    const content = await executors.readFile(filePath);
    res.json({ path: filePath, content });
  } catch (e: any) {
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
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
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
  }
});

app.post('/projects/restore', async (req, res) => {
  try {
    const { checkpointId } = req.body;
    if (!checkpointId) {
      res.status(400).json({ error: 'checkpointId is required', errorCode: 'CHECKPOINT_ID_REQUIRED' });
      return;
    }
    const workspaceDir = executors.getWorkspaceDir();
    await executors.restoreCheckpoint(workspaceDir, checkpointId);
    // Restart dev server
    stopWorkspaceDevServer();
    startWorkspaceDevServer(workspaceDir);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
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
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
  }
});

app.post('/projects/checkpoints/cleanup', (req, res) => {
  try {
    const { keepCheckpointId } = req.body;
    if (!keepCheckpointId) {
      res.status(400).json({ error: 'keepCheckpointId is required', errorCode: 'KEEP_CHECKPOINT_ID_REQUIRED' });
      return;
    }
    const workspaceDir = executors.getWorkspaceDir();
    executors.deleteCheckpointsAfter(workspaceDir, keepCheckpointId);
    const remaining = executors.listCheckpoints(workspaceDir).reverse();
    res.json({ checkpoints: remaining });
  } catch (e: any) {
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
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
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
  }
});

/** Persist chat history to the current project's .deskspawn directory. */
app.post('/chat/history', (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      res.status(400).json({ error: 'messages array is required', errorCode: 'MESSAGES_REQUIRED' });
      return;
    }
    const workspaceDir = executors.getWorkspaceDir();
    const deskspawnDir = path.join(workspaceDir, '.deskspawn');
    fs.mkdirSync(deskspawnDir, { recursive: true });
    const historyPath = path.join(deskspawnDir, CHAT_HISTORY_FILENAME);
    fs.writeFileSync(historyPath, JSON.stringify(messages), 'utf-8');
    res.json({ success: true, count: messages.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
  }
});

// ── API key management (from Rust backend + frontend config sync) ─────────────

/** API key held in process memory (set via POST /api/config). */
let storedApiKey: string | undefined;

/** Custom endpoint held in process memory (set via POST /api/config). */
let storedCustomEndpoint: string | undefined;

/**
 * Receive API key / custom endpoint from the Rust backend (after keychain save
 * or on startup) and from the frontend config sync (useAppStore
 * pushAiConfigToSidecar — H1: デスクトップの AI 設定をサイドカーへ push して
 * NO_UPSTREAM / 401 を防ぐ)。
 * The key is stored only in process memory — never written to disk.
 * This endpoint is protected by the X-DeskSpawn-Token auth middleware above,
 * so only the WebView (via Rust IPC token) can reach it.
 */
app.post('/api/config', (req, res) => {
  const { apiKey, customEndpoint } = req.body || {};
  if (typeof apiKey === 'string') {
    storedApiKey = apiKey;
    console.log('[api/config] API key updated in sidecar memory');
  }
  if (typeof customEndpoint === 'string') {
    // Critical-2: SSRF 対策。https かつ非ローカル/非プライベートの URL のみ設定可能。
    // 空文字は「カスタムエンドポイント解除」として扱う（従来の NO_UPSTREAM 遷移を維持）。
    if (customEndpoint.trim() === '') {
      storedCustomEndpoint = undefined;
      console.log('[api/config] custom endpoint cleared');
    } else if (customEndpoint.trim() !== storedCustomEndpoint) {
      const check = validateUpstreamUrl(customEndpoint);
      if (!check.ok) {
        res.status(400).json({ error: check.error || 'Invalid custom endpoint', errorCode: 'INVALID_ENDPOINT' });
        return;
      }
      storedCustomEndpoint = customEndpoint;
      console.log('[api/config] custom endpoint updated in sidecar memory');
    }
  }
  if (typeof apiKey === 'string' || typeof customEndpoint === 'string') {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'apiKey or customEndpoint string required', errorCode: 'CONFIG_REQUIRED' });
  }
});

// ── OpenAI互換プロキシ (/v1/*) ──────────────────────────────────────────────
// デスクトップ(WebView2)からはCORSで直接呼べないカスタムエンドポイントを中継する。
// フロントエンドは baseURL=http://localhost:<sidecar待受ポート>/v1 を指定する
// （実際のポートはフォールバックで変わりうるため、起動後に sidecar-ready:<port> を参照）。
// 上流エンドポイントは Rust が POST /api/config で設定した storedCustomEndpoint
// のみを使用する（H1: x-upstream ヘッダによる任意転送は SSRF リスクのため廃止）。
// キーは保存済みキー（storedApiKey）を優先し、無ければリクエストの Authorization を使用。
// クエリ文字列（例: ?model=xxx）も上流へそのまま転送する。
app.use('/v1', async (req, res) => {
  try {
    const upstream = storedCustomEndpoint;
    if (!upstream) {
      res.status(400).json({
        error: 'No upstream endpoint configured (POST /api/config with customEndpoint)',
        errorCode: 'NO_UPSTREAM',
      });
      return;
    }
    // Critical-2: 設定時検証をすり抜けた値がメモリに残っている場合の保険。再検証して NG なら転送しない。
    const upstreamCheck = validateUpstreamUrl(upstream);
    if (!upstreamCheck.ok) {
      res.status(400).json({
        error: upstreamCheck.error || 'Invalid upstream endpoint',
        errorCode: 'INVALID_UPSTREAM',
      });
      return;
    }
    const apiKey =
      storedApiKey ||
      (typeof req.headers.authorization === 'string'
        ? req.headers.authorization.replace(/^Bearer\s+/i, '')
        : '');
    const path = req.path; // /v1 マウント内ではプレフィックス除去済み (e.g. /chat/completions)
    // req.path はクエリを含まないため、req.originalUrl からクエリ部を復元して付与する
    // （監査指摘 2026-08-27: クエリ未転送で ?model= 等が上流に届かなかった）。
    const queryIndex = req.originalUrl.indexOf('?');
    const query = queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex);
    const target = `${upstream.replace(/\/+$/, '')}${path}${query}`;

    const headers: Record<string, string> = {};
    if (typeof req.headers['content-type'] === 'string') headers['Content-Type'] = req.headers['content-type'];
    if (typeof req.headers.accept === 'string') headers['Accept'] = req.headers.accept;
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const init: RequestInit = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = JSON.stringify(req.body ?? {});
    }

    // リソース枯渇対策: 上流への接続・応答は 30 秒で打ち切る
    const upstreamRes = await fetch(target, { ...init, signal: AbortSignal.timeout(30_000) });
    res.status(upstreamRes.status);

    const contentType = upstreamRes.headers.get('content-type') || '';
    const isStream =
      contentType.includes('text/event-stream') ||
      String(req.headers.accept || '').includes('text/event-stream');

    if (isStream && upstreamRes.body) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const reader = upstreamRes.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } finally {
        res.end();
      }
    } else {
      const text = await upstreamRes.text();
      if (contentType) res.setHeader('Content-Type', contentType);
      res.send(text);
    }
  } catch (error: any) {
    console.error('[proxy] error:', error?.message || error);
    if (!res.headersSent) {
      res.status(502).json({ error: `Proxy error: ${error?.message || error}`, errorCode: 'PROXY_ERROR' });
    } else {
      res.end();
    }
  }
});

// ── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    workspace: executors.getWorkspaceDir(),
    apiServer: { ready: apiReady, port: apiActualPort },
  });
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
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
  }
});

// Backup: read app data from project file
app.get('/data-backup', (_req, res) => {
  try {
    const workspaceDir = executors.getWorkspaceDir();
    const backupPath = path.join(workspaceDir, BACKUP_FILENAME);
    if (!fs.existsSync(backupPath)) {
      res.status(404).json({ error: 'No backup found', errorCode: 'NO_BACKUP_FOUND' });
      return;
    }
    const raw = fs.readFileSync(backupPath, 'utf-8');
    res.json(JSON.parse(raw));
  } catch (e: any) {
    res.status(500).json({ error: e.message, errorCode: 'INTERNAL_ERROR' });
  }
});

// ── Desktop Preview Endpoints (local Vite dev server) ──────────────────────
// The desktop app runs the generated app's dev server locally (via Bun) and
// shows it in an iframe — no WebContainer/StackBlitz dependency.
//
// ADR-008/ADR-010: the project's real files live at
// `~/deskspawn/projects/<id>/` and the dev server runs directly on that
// directory (no preview/ copy). The frontend reads/writes files through Rust
// IPC; preview endpoints only manage the dev server lifecycle.

function previewDir(projectId: string): string {
  // High-1: パストラバーサル防御。path.join に渡す前に ID 形式を検証する。
  if (!validateAppIdLike(projectId)) {
    throw new Error('[sidecar] Invalid projectId');
  }
  return path.join(PROJECTS_DIR, projectId);
}

/** Write project files into the project dir (path-traversal safe).
 *  node_modules は保持する — 実行中の vite がディレクトリをロックしていても
 *  ソースを上書きでき、再インストールも不要になる。 */
function writePreviewFiles(dir: string, files: Record<string, string>) {
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir)) {
      if (entry !== 'node_modules') {
        fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
      }
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }
  const rootResolved = path.resolve(dir);
  for (const [rel, content] of Object.entries(files)) {
    const target = path.resolve(dir, rel);
    if (!target.startsWith(rootResolved + path.sep) && target !== rootResolved) {
      throw new Error(`Invalid file path in preview payload: ${rel}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  }
}

/** vite が実際に開いたポートをHTTPポーリングで確認する
 *  （vite は ::1 でバインドするため localhost / 127.0.0.1 / [::1] を全て試す） */
async function checkDevServerPort(port: number): Promise<boolean> {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    try {
      const res = await fetch(`http://${host}:${port}/`, {
        signal: AbortSignal.timeout(800),
      });
      if (res && res.status < 500) return true;
    } catch {
      // try next host
    }
  }
  return false;
}

/** 起動前に応答していたポート（旧残骸等）を記録し、ポーリングで除外する。 */
let baselineDevPorts: Set<number> = new Set();

async function recordBaselineDevPorts() {
  baselineDevPorts = new Set();
  for (let port = WORKSPACE_DEV_PORT; port <= WORKSPACE_DEV_PORT + 5; port++) {
    if (await checkDevServerPort(port)) baselineDevPorts.add(port);
  }
  if (baselineDevPorts.size > 0) {
    console.log(`[devserver] Baseline ports already in use (excluded): ${[...baselineDevPorts].join(', ')}`);
  }
}

/** Wait until workspaceDevReady or timeout (ms). */
function waitForDevServer(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(async () => {
      // stdout の Local: パース成功を最優先（実際に起動した新プロセスのポート）
      if (workspaceDevReady) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      // 保険: 出力パースに依存せず、実際にポートが開いたかHTTPポーリングで確認
      // （vite の stdout は Windows パイプでチャンク分割され「Local:」行の
      //   正規表現パースが失敗することがあるため。ポートもフォールバックでずれる）
      // 起動前から応答していたポート（旧残骸）は除外し、新プロセスのポートだけ採用する
      for (let port = WORKSPACE_DEV_PORT; port <= WORKSPACE_DEV_PORT + 5; port++) {
        if (baselineDevPorts.has(port)) continue;
        if (await checkDevServerPort(port)) {
          workspaceDevActualPort = port;
          workspaceDevReady = true;
          console.log(`[devserver] Detected actual port via polling: ${port}`);
          clearInterval(timer);
          resolve(true);
          return;
        }
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 500);
  });
}

// Start local preview for a project (runs directly on the real project dir).
// `files` is optional: when provided (legacy web-style flow) they are written
// into the project dir first; in the desktop flow the frontend has already
// written files through Rust IPC, so the dev server runs on the real files.
app.post('/api/preview/start', async (req, res) => {
  try {
    const { projectId: projectIdRaw, appId, files } = req.body || {};
    // #98 project→app rename 後、フロントは appId を送る。旧クライアント互換のため projectId も受け付ける。
    const projectId = appId || projectIdRaw;
    if (!projectId || typeof projectId !== 'string') {
      res.status(400).json({ error: 'projectId (or appId) is required' });
      return;
    }
    // High-1: パストラバーサル防御（../ 等は 400 で拒否）
    if (!validateAppIdLike(projectId)) {
      res.status(400).json({ error: 'Invalid projectId', errorCode: 'INVALID_PROJECT_ID' });
      return;
    }
    const dir = previewDir(projectId);
    if (files && typeof files === 'object') {
      writePreviewFiles(dir, files);
      // Critical-1: files に package.json が含まれる場合、書き込んだ内容の
      // scripts.dev が "vite" 以外なら起動させない（任意コード実行の防止）。
      if (Object.prototype.hasOwnProperty.call(files, 'package.json')) {
        const devCheck = validateDevScript(dir);
        if (!devCheck.ok) {
          res.status(400).json({
            error: `dev script modified: ${devCheck.error || 'invalid dev script'}`,
            errorCode: 'DEV_SCRIPT_MODIFIED',
          });
          return;
        }
      }
    } else if (!fs.existsSync(path.join(dir, 'package.json'))) {
      res.status(400).json({ error: 'Project has no package.json — create the project first' });
      return;
    }

    // bun install はキャッシュが効き2回目以降は高速。常に実行して
    // node_modules の破損（中断・部分削除など）も修復する。
    console.log(`[preview] Installing deps for ${projectId}...`);
    await installDeps(dir);
    // フルスタック生成アプリ（ADR-010）: Hono API を先に起動し、
    // 実ポートを vite.config.ts の /api proxy にパッチしてから vite を起動。
    await startApiServer(dir);
    await startWorkspaceDevServer(dir);

    const ready = await waitForDevServer(30_000);
    if (!ready) {
      res.status(500).json({ error: 'Dev server did not start within 30s' });
      return;
    }
    const url = `http://localhost:${workspaceDevActualPort}`;
    console.log(`[preview] Ready at ${url}`);
    res.json({ url, port: workspaceDevActualPort, apiPort: apiActualPort });
  } catch (e: any) {
    console.error('[preview] start failed:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Sync files to the running preview (Vite HMR applies changes automatically)
// デスクトップ版では実体ディレクトリを直接編集するため同期は不要（ADR-008）。
// files は任意: 送られてきた場合のみ実体に書き込む（Web互換フロー用）。
app.post('/api/preview/sync', (req, res) => {
  try {
    const { projectId: projectIdRaw, appId, files } = req.body || {};
    const projectId = appId || projectIdRaw;
    if (!projectId || typeof projectId !== 'string') {
      res.status(400).json({ error: 'projectId (or appId) is required' });
      return;
    }
    if (!validateAppIdLike(projectId)) {
      res.status(400).json({ error: 'Invalid projectId', errorCode: 'INVALID_PROJECT_ID' });
      return;
    }
    if (!files || typeof files !== 'object') {
      // デスクトップフロー: 実体を直接参照しているため同期不要。
      res.json({ synced: 0, desktopDirect: true });
      return;
    }
    const dir = previewDir(projectId);
    const rootResolved = path.resolve(dir);
    for (const [rel, content] of Object.entries(files)) {
      const target = path.resolve(dir, rel);
      if (!target.startsWith(rootResolved + path.sep) && target !== rootResolved) {
        res.status(400).json({ error: `Invalid file path: ${rel}` });
        return;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (typeof content !== 'string') {
        res.status(400).json({ error: `Invalid content for ${rel}` });
        return;
      }
      fs.writeFileSync(target, content, 'utf-8');
    }
    // Critical-1: package.json が書き込まれた場合、scripts.dev が "vite" 以外なら
    // 取り込まない（次回起動時の任意コード実行を防止）。
    if (Object.prototype.hasOwnProperty.call(files, 'package.json')) {
      const devCheck = validateDevScript(dir);
      if (!devCheck.ok) {
        res.status(400).json({
          error: `dev script modified: ${devCheck.error || 'invalid dev script'}`,
          errorCode: 'DEV_SCRIPT_MODIFIED',
        });
        return;
      }
    }
    res.json({ synced: Object.keys(files).length });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Stop the running preview
app.post('/api/preview/stop', (_req, res) => {
  stopWorkspaceDevServer();
  stopApiServer();
  res.json({ stopped: true });
});

// Type-check the preview workspace (tsc --noEmit) + Vite error detection
app.post('/api/preview/check', async (req, res) => {
  try {
    const { projectId: projectIdRaw, appId } = req.body || {};
    const projectId = appId || projectIdRaw;
    if (!projectId || typeof projectId !== 'string') {
      res.status(400).json({ error: 'projectId (or appId) is required' });
      return;
    }
    if (!validateAppIdLike(projectId)) {
      res.status(400).json({ error: 'Invalid projectId', errorCode: 'INVALID_PROJECT_ID' });
      return;
    }
    const dir = previewDir(projectId);
    const errors: Array<{
      type: 'typescript' | 'vite' | 'missing-package';
      message: string;
      filePath?: string;
      line?: number;
      column?: number;
    }> = [];

    // 1. tsc --noEmit (via bunx)
    if (fs.existsSync(dir)) {
      const bun = resolveBunPath();
      if (!bun) throw bunNotFoundError();
      try {
        execFileSync(bun, ['x', 'tsc', '--noEmit', '--pretty', 'false'], {
          cwd: dir,
          encoding: 'utf-8',
          timeout: 60_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e: any) {
        const out = `${e.stdout || ''}${e.stderr || ''}`;
        const tscRe = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm;
        let m: RegExpExecArray | null;
        let parsed = 0;
        while ((m = tscRe.exec(out)) !== null) {
          errors.push({
            type: 'typescript',
            filePath: m[1],
            line: parseInt(m[2], 10),
            column: parseInt(m[3], 10),
            message: m[5],
          });
          parsed++;
        }
        if (parsed === 0 && out.trim()) {
          errors.push({ type: 'typescript', message: out.trim().slice(0, 500) });
        }
      }
    }

    // 2. Vite dev server エラー（直近出力からパターン検出）
    for (const line of workspaceDevLog) {
      if (VITE_ERROR_PATTERNS.some((re) => re.test(line))) {
        errors.push({ type: 'vite', message: line.slice(0, 300) });
      }
    }

    res.json({ errors });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

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
    // host: '127.0.0.1' — WSL2 の localhostForwarding が「::」/「0.0.0.0」に
    // ゾンビ共有ソケットを残すため、IPv4ループバック限定でバインドして共存する。
    // (WebView2 は localhost → 127.0.0.1 で到達可能。WSL からの直接アクセスは不要)
    const server = app.listen({ port, host: '127.0.0.1', reusePort: true }, () => {
      ACTUAL_PORT = port;
      // Signal readiness to Rust backend (parses this from stdout)
      console.log(`sidecar-ready:${ACTUAL_PORT}`);
      console.log(`DeskSpawn sidecar HTTP server on port ${ACTUAL_PORT}`);
      console.log(`Workspace: ${executors.getWorkspaceDir()}`);
      resolve();
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        const nextPort = nextFallbackPort(port, DESIRED_PORT, 9);
        if (nextPort !== null) {
          console.warn(`[sidecar] Port ${port} in use, trying ${nextPort}...`);
          server.close(() => startServer(nextPort).then(resolve, reject));
        } else {
          reject(new Error(`All ports ${DESIRED_PORT}-${DESIRED_PORT + 9} in use`));
        }
      } else {
        reject(err);
      }
    });
  });
}

startServer(DESIRED_PORT).then(() => {
  serverStarted = true;
  // Initialise MCP clients (non-fatal if grep.app is unreachable)
  initMCPClients();
}).catch((err) => {
  console.error('[sidecar] Failed to start HTTP server:', err);
  process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Tauri がアプリ終了時に sidecar を終了する際、プレビューの vite（detached で
// 起動した bun/node）は orphan 化してポートを掴んだまま残る（実績 2026-08-12）。
// ここでツリーごと掃除してから終了する。Windows で TerminateProcess される場合は
// このハンドラは発火しないため、Rust 側（sidecar.rs graceful_kill）で
// taskkill /T /F を使うこと（下記 Rust 修正と対で機能する）。
function cleanupPreviewServers() {
  try {
    if (workspaceDevProcess?.pid) killProcessTree(workspaceDevProcess.pid);
    if (apiProcess?.pid) killProcessTree(apiProcess.pid);
    killPortOwnersInBand(WORKSPACE_DEV_PORT, 6, 'shutdown');
    killPortOwnersInBand(API_DESIRED_PORT, API_MAX_FALLBACK + 1, 'shutdown');
  } catch (e) {
    console.warn('[shutdown] preview cleanup failed:', e);
  }
}

process.on('SIGTERM', () => {
  console.log('[shutdown] SIGTERM received, cleaning up previews...');
  cleanupPreviewServers();
  closeMCPClients();
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('[shutdown] SIGINT received, cleaning up previews...');
  cleanupPreviewServers();
  closeMCPClients();
  process.exit(0);
});
process.on('exit', () => {
  cleanupPreviewServers();
});
