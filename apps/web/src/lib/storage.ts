/**
 * Storage abstraction layer for DeskSpawn Web.
 *
 * Provides:
 * - IndexedDB for structured data (settings, projects, chat history)
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

export interface StoredProject {
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
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("chat_history")) {
        db.createObjectStore("chat_history", { keyPath: "projectId" });
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

export async function saveApiKey(provider: string, apiKey: string): Promise<void> {
  await setSetting(apiKeyStorageKey(provider), apiKey);
}

export async function loadApiKey(provider: string): Promise<string | null> {
  const key = await getSetting<string>(apiKeyStorageKey(provider));
  return key ?? null;
}

export async function hasApiKey(provider: string): Promise<boolean> {
  return !!(await getSetting<string>(apiKeyStorageKey(provider)));
}

export async function deleteApiKey(provider: string): Promise<void> {
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
  await setSetting(providerConfigKey(provider), config);
}

export async function loadProviderConfig(
  provider: string,
): Promise<StoredProviderConfig | null> {
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
  await setSetting("last_provider", provider);
}

export async function loadLastProvider(): Promise<string | null> {
  const p = await getSetting<string>("last_provider");
  return p ?? null;
}

// ── Project Operations ────────────────────────────────────────────────────────

export async function listProjects(): Promise<StoredProject[]> {
  const db = await openDB();
  const tx = db.transaction("projects", "readonly");
  const store = tx.objectStore("projects");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getProject(id: string): Promise<StoredProject | null> {
  const db = await openDB();
  const tx = db.transaction("projects", "readonly");
  const store = tx.objectStore("projects");
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(project: StoredProject): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("projects", "readwrite");
  const store = tx.objectStore("projects");
  await new Promise<void>((resolve, reject) => {
    const req = store.put(project);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("projects", "readwrite");
  const store = tx.objectStore("projects");
  await new Promise<void>((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  // Also delete the generated app's own IndexedDB database
  await deleteAppDatabase(id).catch(() => {});
}

/**
 * Delete the generated app's IndexedDB database for a given project.
 * Each generated app stores its data in a database named `deskspawn_app_{projectId}`.
 */
export async function deleteAppDatabase(projectId: string): Promise<void> {
  const dbName = `deskspawn_app_${projectId}`;
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

export async function getChatHistory(projectId: string): Promise<any[]> {
  const db = await openDB();
  const tx = db.transaction("chat_history", "readonly");
  const store = tx.objectStore("chat_history");
  const result = await new Promise<{ projectId: string; messages: any[] } | undefined>((resolve, reject) => {
    const req = store.get(projectId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return result?.messages || [];
}

export async function saveChatHistory(projectId: string, messages: any[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("chat_history", "readwrite");
  const store = tx.objectStore("chat_history");
  await new Promise<void>((resolve, reject) => {
    const req = store.put({ projectId, messages });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Storage Stats ──────────────────────────────────────────────────────────────

export async function getStorageStats(): Promise<{
  projects: number;
  chatMessages: number;
}> {
  const projects = (await listProjects()).length;
  return { projects, chatMessages: 0 };
}
