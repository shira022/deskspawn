/**
 * Storage abstraction layer for DeskSpawn Web.
 *
 * Provides:
 * - IndexedDB for structured data (settings, apps, chat history)
 * - OPFS for file data (source code), with IndexedDB fallback
 *
 * On desktop, API keys live in the OS keychain (Rust IPC) only — never in
 * plaintext files. The web demo stores them as plaintext in IndexedDB, which
 * is opt-in via an explicit consent checkbox in the AI settings dialog.
 *
 * All data stays in the browser's origin — never leaves the device.
 * Only outbound communication is to AI provider APIs and CDNs.
 */

import type { AppSettings, TokenUsage } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { SETTINGS_KEY } from "./constants";
import { normalizeStoredCost } from "./cost";
import { isDesktopEnv } from "./platform";

// ── Constants ────────────────────────────────────────────────────────────────

const DB_NAME = "deskspawn";
const DB_VERSION = 2;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StoredApp {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Per-provider config stored in IndexedDB under `provider_config_{provider}`.
 * API keys are stored separately under `api_key_{provider}`.
 */
export interface StoredProviderConfig {
  model: string;
  customEndpoint?: string;
  region?: string;
  maxSteps?: number;
}

// ── IndexedDB Core ────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("apps")) {
        db.createObjectStore("apps", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("chat_history")) {
        db.createObjectStore("chat_history", { keyPath: "appId" });
      }
      if (!db.objectStoreNames.contains("cdncache")) {
        // 過去互換性: 旧CDNキャッシュストア（現在は未使用）
        // 削除せずにそのまま維持（ユーザーデータ損失防止）
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── Settings Operations ───────────────────────────────────────────────────────

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  const tx = db.transaction("settings", "readonly");
  const store = tx.objectStore("settings");
  const result = await new Promise<{ key: string; value: T } | undefined>((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return result?.value;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("settings", "readwrite");
  const store = tx.objectStore("settings");
  await new Promise<void>((resolve, reject) => {
    const req = store.put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── API Key Storage ──────────────────────────────────────────────────────────
//
// Stored as plaintext in IndexedDB, keyed by provider.
// This matches the approach used by OpenCode, gh, aws-cli, etc.

function apiKeyStorageKey(provider: string): string {
  return `api_key_${provider}`;
}

/**
 * APIキー保存の実際の保存先（M2/ADR-018）。
 * - Desktop: "keychain"（OSキーチェーン）
 * - Web: "browser"（IndexedDB 平文・同意の上）
 * - "session": このタブのみ（メモリ保持・永続化なし）
 * - "": 未保存（キー無し、または移行失敗で平文が保存先）
 */
export type ApiKeyStorageMethod = "keychain" | "browser" | "session" | "";

/**
 * loadApiKeyInfo の戻り値。
 * `legacyPlaintext` が true のとき、移行に失敗したレガシー平文キーが
 * ディスク上に残っている（UI で警告・再試行導線を出す）。
 */
export interface ApiKeyInfo {
  key: string | null;
  method: ApiKeyStorageMethod;
  legacyPlaintext: boolean;
}

// ── Session-only (in-memory) API keys — Web「このタブのみ」モード ──────────────
// Web で「保存しない」を選んだ場合、キーはこのモジュールのメモリ上にのみ保持し、
// IndexedDB には書かない。リロードで消える。AI 呼び出しの loadApiKey は
// 永続ストレージより先にここを参照する（供給経路の一元化）。
const sessionApiKeys = new Map<string, string>();

/** タブ内メモリにキーを保持する（空文字で削除）。 */
export function setSessionApiKey(provider: string, apiKey: string): void {
  if (apiKey) {
    sessionApiKeys.set(provider, apiKey);
  } else {
    sessionApiKeys.delete(provider);
  }
}

/** タブ内メモリのキーを取得する（無ければ null）。 */
export function getSessionApiKey(provider: string): string | null {
  return sessionApiKeys.get(provider) ?? null;
}

/** タブ内メモリのキーを全て破棄する（テスト用）。 */
export function clearSessionApiKeys(): void {
  sessionApiKeys.clear();
}

// ── Legacy IDB API key sweep (Medium-1, 監査 2026-08-28) ─────────────────────
// デスクトップはキーチェーン保存（IPC）に移行済みだが、旧 WebView 時代の
// IndexedDB（deskspawn DB・settings ストア）に api_key_<provider> が平文で
// 残ることがある。IPC 保存/読込が成功する環境（= デスクトップ）では、
// このレガシーコピーを削除して平文残存をなくす。
// Web 版（IPC 無し）は従来通り IDB 保存（Web は仕様のため掃除しない）。
// 削除は冪等で、DB が存在しない場合は何もしない。

async function sweepLegacyIdbApiKeys(): Promise<void> {
  try {
    // DB が存在しない場合に indexedDB.open() が空 DB を作り直してしまうため、
    // 先に存在確認する（デスクトップで不要な DB を作らない）。
    if (typeof indexedDB !== "undefined" && typeof indexedDB.databases === "function") {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === DB_NAME)) return;
    }
    const db = await openDB();
    const tx = db.transaction("settings", "readwrite");
    const store = tx.objectStore("settings");
    await new Promise<void>((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const keys = req.result;
        for (const key of keys) {
          if (String(key).startsWith("api_key_")) {
            store.delete(key);
          }
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    // 掃除はベストエフォート（DB が無い・壊れている等は無視する）
    console.warn("[storage] Legacy IDB api_key sweep skipped:", e);
  }
}

export interface SaveApiKeyOptions {
  /**
   * Web で API キーを平文（IndexedDB）へ永続保存することへの明示同意。
   * デスクトップ（キーチェーン）では不要。Web の永続保存では必須 —
   * UI のチェックボックス無効化だけに依存しない defense-in-depth。
   */
  consent?: boolean;
}

export async function saveApiKey(
  provider: string,
  apiKey: string,
  opts?: SaveApiKeyOptions,
): Promise<ApiKeyStorageMethod> {
  // Web 以外（デスクトップ）はキーチェーン IPC のみ。invoke が Err を返したら
  // そのまま throw する（IndexedDB の平文へは絶対にフォールバックしない）。
  if (isDesktopEnv()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{ method: string }>("save_api_key", { provider, apiKey });
    // キーチェーン保存が成功したので、IDB に残るレガシー平文キーを掃除する
    await sweepLegacyIdbApiKeys();
    // 永続保存したらタブ内メモリのコピーは不要
    setSessionApiKey(provider, "");
    return (result?.method as ApiKeyStorageMethod) || "";
  }
  // Web（非 Tauri）: IndexedDB に平文保存。同意が無ければ保存せずエラーにする。
  // （UI は同意なしでは保存ボタンを無効化するが、呼び出し経路に依らずここで拒否する）
  if (!opts?.consent) {
    throw new Error("Consent is required to store the API key in the browser");
  }
  setSessionApiKey(provider, "");
  await setSetting(apiKeyStorageKey(provider), apiKey);
  return "browser";
}

/**
 * デスクトップ: レガシー平文ファイル（credentials.json）を削除する（冪等）。
 *
 * `loadApiKeyInfo` が `legacyPlaintext` を返したとき、UI の明示操作から呼ぶ。
 * 平文の自動削除はデータ喪失リスクがあるため行わない（ADR-018）。Web では
 * 平文ファイルが存在しないため何もしない。
 */
export async function deleteLegacyPlaintextFile(): Promise<void> {
  if (!isDesktopEnv()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("delete_legacy_plaintext_file");
}

/**
 * API キーを読み込み、保存先とレガシー平文残存を返す。
 * タブ内メモリ（このタブのみモード）→ 永続ストレージの順に参照する。
 */
export async function loadApiKeyInfo(provider: string): Promise<ApiKeyInfo> {
  // このタブのみモードのメモリ値を最優先で返す（永続保存はされていない）。
  // 「タブのみ」は推測ではなく明示する（"session"）— デスクトップ既定の
  // キーチェーン表示に誤って落ちないようにするため。
  const session = getSessionApiKey(provider);
  if (session !== null) {
    return { key: session, method: "session", legacyPlaintext: false };
  }
  if (isDesktopEnv()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{
      key: string | null;
      method: string | null;
      legacyPlaintext: boolean;
    }>("load_api_key_info", { provider });
    // デスクトップ: IDB のレガシー平文キーを掃除する（起動時掃除も兼ねる）
    await sweepLegacyIdbApiKeys();
    const legacyPlaintext = !!info?.legacyPlaintext || info?.method === "file";
    const method: ApiKeyStorageMethod = info?.method === "keychain" ? "keychain" : "";
    return { key: info?.key ?? null, method, legacyPlaintext };
  }
  const key = await getSetting<string>(apiKeyStorageKey(provider));
  return {
    key: key ?? null,
    method: key ? "browser" : "",
    legacyPlaintext: false,
  };
}

export async function loadApiKey(provider: string): Promise<string | null> {
  return (await loadApiKeyInfo(provider)).key;
}

export async function hasApiKey(provider: string): Promise<boolean> {
  const key = await loadApiKey(provider);
  return key !== null && key.length > 0;
}

export async function deleteApiKey(provider: string): Promise<void> {
  // タブ内メモリのコピーも破棄する（このタブのみモードの解除）
  setSessionApiKey(provider, "");
  // Try Tauri IPC (Desktop) first
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_api_key", { provider });
    // Also clean up any legacy IndexedDB copy (fallback leftovers from when
    // the keychain was unavailable — bugfix 2026-08-12).
    try {
      const db = await openDB();
      const tx = db.transaction("settings", "readwrite");
      const store = tx.objectStore("settings");
      await new Promise<void>((resolve, reject) => {
        const req = store.delete(apiKeyStorageKey(provider));
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // IndexedDB not available / nothing to clean
    }
    return;
  } catch {
    // Not in Tauri environment
  }
  const db = await openDB();
  const tx = db.transaction("settings", "readwrite");
  const store = tx.objectStore("settings");
  await new Promise<void>((resolve, reject) => {
    const req = store.delete(apiKeyStorageKey(provider));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Per-Provider Config Storage ─────────────────────────────────────────────
//
// Each provider's config (model, endpoint, region, etc.) is stored under
// `provider_config_{provider}`. API keys remain in `api_key_{provider}`.
// This keeps provider settings isolated — switching providers never loses
// the previous provider's configuration.

function providerConfigKey(provider: string): string {
  return `provider_config_${provider}`;
}

export async function saveProviderConfig(
  provider: string,
  config: StoredProviderConfig,
): Promise<void> {
  // Desktop: persist to config.json via Rust IPC (multi-provider map).
  // Web: IndexedDB (fallback when not in a Tauri environment).
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_provider_config", { provider, config });
    return;
  } catch {
    // Not in Tauri environment — use IndexedDB (Web)
  }
  await setSetting(providerConfigKey(provider), config);
}

export async function loadProviderConfig(
  provider: string,
): Promise<StoredProviderConfig | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const cfg = await invoke<StoredProviderConfig | null>("load_provider_config", {
      provider,
    });
    if (cfg) return cfg;
    // Desktop but not yet in config.json: migrate the legacy IndexedDB value
    // once (idempotent — after this, config.json is the source of truth).
    const legacy = await getSetting<StoredProviderConfig>(providerConfigKey(provider));
    if (legacy?.model) {
      await invoke("save_provider_config", { provider, config: legacy }).catch(() => {});
      return legacy;
    }
    return null;
  } catch {
    // Not in Tauri environment
  }
  const cfg = await getSetting<StoredProviderConfig>(providerConfigKey(provider));
  return cfg ?? null;
}

// ── Last Active Provider ────────────────────────────────────────────────────
//
// Tracks which provider was last used (per-provider configs need this to know
// which one to load on startup).

export async function saveLastProvider(provider: string): Promise<void> {
  // Desktop: persist to config.json via Rust IPC.
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_last_provider", { provider });
    return;
  } catch {
    // Not in Tauri environment — use IndexedDB (Web)
  }
  await setSetting("last_provider", provider);
}

export async function loadLastProvider(): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const p = await invoke<string | null>("load_last_provider");
    if (p) return p;
    // Desktop but not yet in config.json: migrate the legacy IndexedDB value.
    const legacy = await getSetting<string>("last_provider");
    if (legacy) {
      await invoke("save_last_provider", { provider: legacy }).catch(() => {});
      return legacy;
    }
    return null;
  } catch {
    // Not in Tauri environment
  }
  const p = await getSetting<string>("last_provider");
  return p ?? null;
}

// ── Current App (B4: was localStorage `deskspawn_current_app`) ────────────────

export async function saveCurrentAppId(appId: string | null): Promise<void> {
  // Desktop: persist to config.json via Rust IPC.
  // null でも invoke を呼ぶ（Rust 側が current_app を config.json から除去する
  // — 2026-08-27 監査指摘対応）。
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_current_app", { appId });
    return;
  } catch {
    // Not in Tauri environment — use localStorage (Web)
  }
  if (appId) {
    localStorage.setItem("deskspawn_current_app", JSON.stringify(appId));
  } else {
    localStorage.removeItem("deskspawn_current_app");
  }
}

export async function loadCurrentAppId(): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const id = await invoke<string | null>("load_current_app");
    if (id) return id;
    // Desktop but not yet in config.json: migrate the legacy localStorage value.
    const legacy = localStorage.getItem("deskspawn_current_app");
    if (legacy) {
      const parsed = JSON.parse(legacy) as string;
      await invoke("save_current_app", { appId: parsed }).catch(() => {});
      return parsed;
    }
    return null;
  } catch {
    // Not in Tauri environment
  }
  const stored = localStorage.getItem("deskspawn_current_app");
  if (!stored) return null;
  try {
    return JSON.parse(stored) as string;
  } catch {
    return stored;
  }
}

// ── App Operations ────────────────────────────────────────────────────────
/**
 * Desktop uses real files via Rust IPC (ADR-008); Web uses IndexedDB.
 * The desktop adapter is imported lazily so the web bundle stays unaffected.
 */
export async function listApps(): Promise<StoredApp[]> {
  if (isDesktopEnv()) {
    const { listAppsDesktop } = await import("./storage-desktop");
    return listAppsDesktop();
  }
  const db = await openDB();
  const tx = db.transaction("apps", "readonly");
  const store = tx.objectStore("apps");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getApp(id: string): Promise<StoredApp | null> {
  if (isDesktopEnv()) {
    const { getAppDesktop } = await import("./storage-desktop");
    return getAppDesktop(id);
  }
  const db = await openDB();
  const tx = db.transaction("apps", "readonly");
  const store = tx.objectStore("apps");
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveApp(app: StoredApp): Promise<string> {
  if (isDesktopEnv()) {
    const { saveAppDesktop } = await import("./storage-desktop");
    return saveAppDesktop(app);
  }
  const db = await openDB();
  const tx = db.transaction("apps", "readwrite");
  const store = tx.objectStore("apps");
  await new Promise<void>((resolve, reject) => {
    const req = store.put(app);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  return app.id;
}

export async function deleteApp(id: string): Promise<void> {
  if (isDesktopEnv()) {
    const { deleteAppDesktop } = await import("./storage-desktop");
    return deleteAppDesktop(id);
  }
  const db = await openDB();
  const tx = db.transaction("apps", "readwrite");
  const store = tx.objectStore("apps");
  await new Promise<void>((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  // Also delete the generated app's own IndexedDB database
  await deleteAppDatabase(id).catch(() => {});
}

/**
 * Delete the generated app's IndexedDB database for a given app.
 * Each generated app stores its data in a database named `deskspawn_app_{appId}`.
 */
export async function deleteAppDatabase(appId: string): Promise<void> {
  // C8 (web-storage audit 2026-08-12): on desktop the host origin has no such
  // IndexedDB database (generated apps live as real files) — skip the no-op.
  if (isDesktopEnv()) {
    return;
  }
  const dbName = `deskspawn_app_${appId}`;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      console.warn(`[storage] deleteDatabase "${dbName}" is blocked (open in another tab?)`);
      resolve();
    };
  });
}

// ── Chat History Operations ───────────────────────────────────────────────────

/**
 * Old versions persisted `estimatedCost: 0` when pricing was unavailable.
 * Correct those on read (the correction is applied at read time; subsequent
 * saves persist the corrected value): a `0` (or non-number) whose model pricing
 * is now known is recalculated, otherwise it is reinterpreted as unknown
 * (`undefined`).  A non-zero number is untouched.
 */
function normalizeMessageCost(message: any): any {
  const usage = message?.usage as TokenUsage | undefined;
  if (!usage) return message;
  const estimatedCost = normalizeStoredCost(usage);
  if (estimatedCost === usage.estimatedCost) return message;
  return { ...message, usage: { ...usage, estimatedCost } };
}

export async function getChatHistory(appId: string): Promise<any[]> {
  const messages = isDesktopEnv()
    ? await (await import("./storage-desktop")).getChatHistoryDesktop(appId)
    : await getChatHistoryWeb(appId);
  return messages.map(normalizeMessageCost);
}

async function getChatHistoryWeb(appId: string): Promise<any[]> {
  const db = await openDB();
  const tx = db.transaction("chat_history", "readonly");
  const store = tx.objectStore("chat_history");
  const result = await new Promise<{ appId: string; messages: any[] } | undefined>((resolve, reject) => {
    const req = store.get(appId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return result?.messages || [];
}

export async function saveChatHistory(appId: string, messages: any[]): Promise<void> {
  if (isDesktopEnv()) {
    const { saveChatHistoryDesktop } = await import("./storage-desktop");
    return saveChatHistoryDesktop(appId, messages);
  }
  const db = await openDB();
  const tx = db.transaction("chat_history", "readwrite");
  const store = tx.objectStore("chat_history");
  await new Promise<void>((resolve, reject) => {
    const req = store.put({ appId, messages });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Storage Stats ──────────────────────────────────────────────────────────────

export async function getStorageStats(): Promise<{
  apps: number;
  chatMessages: number;
}> {
  const apps = (await listApps()).length;
  return { apps, chatMessages: 0 };
}

// ── UI Settings (was localStorage `deskspawn_settings`) ───────────────────────
//
// Desktop persists settings (language/theme/fontSize/simpleMode) to
// config.json via Rust IPC (2026-08-15); Web keeps localStorage. Same
// invoke-first-fallback + lazy idempotent migration pattern as current_app
// (B4). `null` = never saved (first run) — the desktop app then shows the
// language-select screen.

export async function saveSettingsDesktop(settings: AppSettings): Promise<void> {
  // 起動フラッシュ解消（監査 2026-08-27）: 保存先の主は config.json のまま、
  // 言語とテーマのみ localStorage へミラーする。i18n.ts / desktop の
  // vite.config.ts テーマスクリプトは同期 localStorage 読みなので、ミラーが
  // あれば 2 回目起動時に前回の言語/テーマが初回レンダー前に確定する。
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_settings", { settings });
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const current = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      current.language = settings.language;
      current.theme = settings.theme;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
    } catch {
      // non-critical — mirror は起動フラッシュ解消目的のみ
    }
    return;
  } catch {
    // Not in Tauri environment — use localStorage (Web)
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadSettingsDesktop(): Promise<AppSettings | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const s = await invoke<AppSettings | null>("load_settings");
    if (s) return { ...DEFAULT_SETTINGS, ...s };
    // Desktop but no settings in config.json yet: migrate the legacy
    // localStorage value once, then persist to config.json.
    const legacy = localStorage.getItem(SETTINGS_KEY);
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy) as Partial<AppSettings>;
        const merged = { ...DEFAULT_SETTINGS, ...parsed };
        await invoke("save_settings", { settings: merged }).catch(() => {});
        return merged;
      } catch {
        /* malformed legacy value — treat as first run */
      }
    }
    return null; // first run: language not chosen yet
  } catch {
    // Not in Tauri environment
  }
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return null;
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return null;
  }
}
