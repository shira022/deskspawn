/**
 * Storage abstraction layer for DeskSpawn Web.
 *
 * Provides:
 * - IndexedDB for structured data (settings, apps, chat history)
 * - OPFS for file data (source code), with IndexedDB fallback
 *
 * API keys are stored as plaintext in IndexedDB.
 * This is the same approach used by OpenCode, GitHub CLI, AWS CLI,
 * and virtually all other developer CLI tools — filesystem-level
 * isolation (browser profile directory) provides adequate protection.
 *
 * All data stays in the browser's origin — never leaves the device.
 * Only outbound communication is to AI provider APIs and CDNs.
 */

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
 * APIキー保存の実際の保存先（M2）。
 * - Desktop: "keychain"（OSキーチェーン）| "file"（credentials.json 平文フォールバック）
 * - Web: "browser"（IndexedDB 平文）
 */
export type ApiKeyStorageMethod = "keychain" | "file" | "browser" | "";

export async function saveApiKey(provider: string, apiKey: string): Promise<ApiKeyStorageMethod> {
  // Try Tauri IPC (Desktop) first, fall back to IndexedDB (Web)
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{ method: string }>("save_api_key", { provider, apiKey });
    return (result?.method as ApiKeyStorageMethod) || "";
  } catch {
    // Not in Tauri environment, use IndexedDB
  }
  await setSetting(apiKeyStorageKey(provider), apiKey);
  return "browser";
}

export async function loadApiKey(provider: string): Promise<string | null> {
  // Try Tauri IPC (Desktop) first
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke("load_api_key", { provider })) as string | null;
  } catch {
    // Not in Tauri environment
  }
  const key = await getSetting<string>(apiKeyStorageKey(provider));
  return key ?? null;
}

export async function hasApiKey(provider: string): Promise<boolean> {
  const key = await loadApiKey(provider);
  return key !== null && key.length > 0;
}

export async function deleteApiKey(provider: string): Promise<void> {
  // Try Tauri IPC (Desktop) first
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_api_key", { provider });
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

export async function deleteProviderConfig(provider: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("settings", "readwrite");
  const store = tx.objectStore("settings");
  await new Promise<void>((resolve, reject) => {
    const req = store.delete(providerConfigKey(provider));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function hasProviderConfig(provider: string): Promise<boolean> {
  const cfg = await getSetting<StoredProviderConfig>(providerConfigKey(provider));
  return !!cfg?.model;
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
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    if (appId) {
      await invoke("save_current_app", { appId });
    }
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
function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { __DESKSPAWN_DESKTOP__?: boolean }).__DESKSPAWN_DESKTOP__);
}

export async function listApps(): Promise<StoredApp[]> {
  if (isDesktopRuntime()) {
    const { listAppsDesktop } = await import("@/lib/storage-desktop");
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
  if (isDesktopRuntime()) {
    const { getAppDesktop } = await import("@/lib/storage-desktop");
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
  if (isDesktopRuntime()) {
    const { saveAppDesktop } = await import("@/lib/storage-desktop");
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
  if (isDesktopRuntime()) {
    const { deleteAppDesktop } = await import("@/lib/storage-desktop");
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

export async function getChatHistory(appId: string): Promise<any[]> {
  if (isDesktopRuntime()) {
    const { getChatHistoryDesktop } = await import("@/lib/storage-desktop");
    return getChatHistoryDesktop(appId);
  }
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
  if (isDesktopRuntime()) {
    const { saveChatHistoryDesktop } = await import("@/lib/storage-desktop");
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
