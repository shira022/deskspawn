/**
 * Global application store — DeskSpawn Web version.
 *
 * Replaces the Tauri IPC / sidecar HTTP calls with browser-native storage.
 */

import { create } from "zustand";

// ── Utility ─────────────────────────────────────────────────────────────────

/**
 * Promise にタイムアウトを付与する。
 * ms ミリ秒以内に promise が完了しない場合、reject する。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout${label ? ` (${label})` : ""} after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
import type {
  AppPhase,
  LayoutMode,
  AiConfig,
  ChatMessage,
  AgentStatus,
  FileNode,
  AppMeta,
  CheckpointInfo,
  AppSettings,
  Toast,
} from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { saveProviderConfig, loadProviderConfig, saveApiKey, loadApiKey, deleteApiKey, hasApiKey, saveLastProvider, loadLastProvider, saveCurrentAppId, loadCurrentAppId, saveSettingsDesktop, loadSettingsDesktop, listApps, type ApiKeyStorageMethod } from "../lib/storage";
import { setAppId, listCheckpoints as engineListCheckpoints, persistChatHistory, loadChatHistory } from "../engine/tool-executors";
import { setModelCostCache, clearModelCostCache } from "../lib/cost";
import { getModelsForProvider } from "../lib/models-fetcher";
import { seedAppFromFilesystem, seedAppFromWorkspace, hasAppFiles } from "../lib/seed-app";
import i18n from "../lib/i18n";

// ── Sidecar config sync (デスクトップのみ) ─────────────────────────────────────
//
// デスクトップの AI 設定は IndexedDB にのみ保存され、サイドカーのメモリ
// （storedApiKey / storedCustomEndpoint）には自動では届かない。届かないと
// /v1 プロキシが上流を知らず NO_UPSTREAM(400) / Unauthorized(401) になる
// （実績 2026-08-07 / 08-10）。設定の読み込み・保存タイミングで明示的に
// POST /api/config で push する。

async function pushAiConfigToSidecar(config: {
  apiKey?: string;
  customEndpoint?: string;
}): Promise<void> {
  if (!isDesktopEnv()) return;
  try {
    const { sidecarFetch } = await import("../lib/sidecar");
    const body: Record<string, string> = {};
    if (config.apiKey) body.apiKey = config.apiKey;
    if (config.customEndpoint) body.customEndpoint = config.customEndpoint;
    if (Object.keys(body).length === 0) return;
    await sidecarFetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn("[sidecar] Failed to push AI config:", e);
  }
}

/** デスクトップ環境判定（Web では false）。 */
function isDesktopEnv(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as { __DESKSPAWN_DESKTOP__?: boolean }).__DESKSPAWN_DESKTOP__)
  );
}

// ── Store Types ─────────────────────────────────────────────────────────────

interface Store {
  // Phase
  phase: AppPhase;
  setPhase: (phase: AppPhase) => void;
  initialized: boolean;
  initialize: () => Promise<void>;

  // Layout
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;

  // AI Config
  aiConfig: AiConfig | null;
  /** APIキーの実際の保存先（M2: UI表示用）。"" は未保存 */
  apiKeyStorageMethod: ApiKeyStorageMethod;
  setAiConfig: (config: AiConfig) => Promise<ApiKeyStorageMethod>;
  reloadAiConfig: () => Promise<void>;

  // Chat
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  truncateMessages: (fromIndex: number) => void;
  clearMessages: () => void;
  fetchChatHistory: () => Promise<void>;
  /** 直近のチャット履歴永続化が失敗したか（UIに保存失敗バッジを表示するため） */
  saveFailed: boolean;
  setSaveFailed: (failed: boolean) => void;

  // Editing
  editingMessageId: string | null;
  setEditingMessageId: (id: string | null) => void;

  // Agent
  agentStatus: AgentStatus;
  setAgentStatus: (status: AgentStatus) => void;
  agentStepCount: number;
  setAgentStepCount: (count: number) => void;
  agentMaxSteps: number;
  setAgentMaxSteps: (count: number) => void;

  // File Tree
  fileTree: FileNode[];
  setFileTree: (tree: FileNode[]) => void;
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;

  // Workspace preview
  workspacePort: number;
  setWorkspacePort: (port: number) => void;
  workspaceReady: boolean;
  setWorkspaceReady: (ready: boolean) => void;

  // Apps
  currentAppId: string | null;
  setCurrentAppId: (id: string | null) => void;
  apps: AppMeta[];
  setApps: (apps: AppMeta[]) => void;
  addApp: (app: AppMeta) => void;
  removeApp: (id: string) => void;
  appSwitching: boolean;
  setAppSwitching: (switching: boolean) => void;
  appLoading: boolean;
  setAppLoading: (loading: boolean) => void;

  // Checkpoints
  checkpoints: CheckpointInfo[];
  setCheckpoints: (checkpoints: CheckpointInfo[]) => void;
  currentCheckpointIndex: number;
  setCurrentCheckpointIndex: (index: number) => void;
  fetchCheckpoints: () => Promise<void>;

  // Messages visibility
  visibleMessageCount: number;
  setVisibleMessageCount: (count: number) => void;

  // Preview maximized
  previewMaximized: boolean;
  setPreviewMaximized: (maximized: boolean) => void;
  togglePreviewMaximized: () => void;

  // Reload trigger
  reloadCounter: number;
  triggerReload: () => void;

  // Settings
  settings: AppSettings;
  /** 初回起動（言語未設定）フラグ — デスクトップは言語選択画面を表示する */
  languageUnset: boolean;
  setSettings: (settings: AppSettings) => void;
  updateSettings: (partial: Partial<AppSettings>) => void;

  // Theme
  resolvedTheme: "light" | "dark";
  setResolvedTheme: (theme: "light" | "dark") => void;

  // Toasts
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

export const useAppStore = create<Store>((set, get) => ({
  // ── Phase ──────────────────────────────────────────────────────────
  phase: "ai-config",
  setPhase: (phase) => set({ phase }),
  initialized: false,
  languageUnset: false,
  initialize: async () => {
    // 全体タイムアウト: どの処理がハングしても 10 秒で強制完了させる。
    // これにより Cloudflare 本番などで models.dev の fetch や IndexedDB が
    // 応答しない場合でもアプリが真っ白のまま止まらず、UI を表示できる。
    const INIT_TIMEOUT_MS = 10_000;
    const initBody = async () => {
      try {
        // Load UI settings (desktop: config.json via IPC / web: localStorage).
        // `null` = first run — desktop then shows the language-select screen
        // (see MainLayout / F0 in docs/user-flow-spec.md).
        try {
          const loaded = await loadSettingsDesktop();
          if (loaded) {
            if (loaded.language) i18n.changeLanguage(loaded.language);
            set({ settings: loaded });
          } else {
            set({ languageUnset: true });
          }
        } catch {}
        // Load AI config from per-provider storage
        const lastProvider = await loadLastProvider();
        if (lastProvider) {
          const storedCfg = await loadProviderConfig(lastProvider);
          const key = await loadApiKey(lastProvider);
          if (storedCfg && storedCfg.model) {
            set({
              aiConfig: {
                provider: lastProvider as any,
                model: storedCfg.model,
                customEndpoint: storedCfg.customEndpoint,
                region: storedCfg.region,
                maxSteps: storedCfg.maxSteps,
                apiKey: "",
                apiKeyConfigured: !!key,
              } as AiConfig,
              phase: "main",
            });

            // サイドカーへ上流設定を同期（デスクトップのみ・NO_UPSTREAM防止）
            await pushAiConfigToSidecar({
              apiKey: key ?? undefined,
              customEndpoint: storedCfg.customEndpoint,
            });

            // Pre-populate model cost cache from models.dev
            if (lastProvider !== "ollama" && lastProvider !== "custom") {
              try {
                const models = await getModelsForProvider(lastProvider);
                if (models.length > 0) {
                  clearModelCostCache();
                  setModelCostCache(models);
                }
              } catch {
                // Non-critical — cache will be populated when user opens AI config
              }
            }
          }
        }

        // Load apps from IndexedDB
        const storedApps = await listApps();
        if (storedApps.length > 0) {
          set({ apps: storedApps });
        }

        // Load current app
        try {
          const pid = await loadCurrentAppId();
          if (pid) {
            set({ currentAppId: pid });
            setAppId(pid);
            // Load checkpoints
            await get().fetchCheckpoints();
          }
        } catch {}
      } catch (e) {
        console.error("[initialize] Failed:", e);
      }
    };

    try {
      await withTimeout(initBody(), INIT_TIMEOUT_MS, "initialize");
    } catch {
      console.warn(`[initialize] Timed out after ${INIT_TIMEOUT_MS}ms — forcing app to load`);
    } finally {
      set({ initialized: true });
    }
  },

  // ── Layout ─────────────────────────────────────────────────────────
  layoutMode: "2-pane",
  setLayoutMode: (layoutMode) => set({ layoutMode }),

  // ── AI Config ──────────────────────────────────────────────────────
  aiConfig: null,
  apiKeyStorageMethod: "",
  setAiConfig: async (aiConfig) => {
    // Save per-provider config (everything except apiKey)
    await saveProviderConfig(aiConfig.provider, {
      model: aiConfig.model,
      customEndpoint: aiConfig.customEndpoint,
      region: aiConfig.region,
      maxSteps: aiConfig.maxSteps,
    });

    // Save/delete API key
    let storageMethod: ApiKeyStorageMethod = "";
    if (aiConfig.apiKey) {
      storageMethod = await saveApiKey(aiConfig.provider, aiConfig.apiKey);
    } else if (aiConfig.apiKeyConfigured === false) {
      await deleteApiKey(aiConfig.provider);
    }

    // Track which provider was last used
    await saveLastProvider(aiConfig.provider);

    // Determine configured status: explicit flag, or check if a key exists in storage
    const configured =
      aiConfig.apiKeyConfigured ?? (await hasApiKey(aiConfig.provider));

    set({
      aiConfig: {
        ...aiConfig,
        apiKey: "",
        apiKeyConfigured: configured,
      },
      apiKeyStorageMethod: storageMethod,
    });

    // サイドカーへ上流設定を同期（デスクトップのみ・NO_UPSTREAM防止）
    await pushAiConfigToSidecar({
      apiKey: aiConfig.apiKey || undefined,
      customEndpoint: aiConfig.customEndpoint,
    });
    return storageMethod;
  },

  /** Reload the AI config from storage (e.g. after session unlock). */
  reloadAiConfig: async () => {
    const lastProvider = await loadLastProvider();
    if (!lastProvider) return;
    const cfg = await loadProviderConfig(lastProvider);
    if (cfg && cfg.model) {
      const key = await loadApiKey(lastProvider);
      set({
        aiConfig: {
          provider: lastProvider as any,
          model: cfg.model,
          customEndpoint: cfg.customEndpoint,
          region: cfg.region,
          maxSteps: cfg.maxSteps,
          apiKey: "",
          apiKeyConfigured: !!key,
        } as AiConfig,
      });

      // サイドカーへ上流設定を同期（デスクトップのみ・NO_UPSTREAM防止）
      await pushAiConfigToSidecar({
        apiKey: key ?? undefined,
        customEndpoint: cfg.customEndpoint,
      });
    }
  },

  // ── Chat ───────────────────────────────────────────────────────────
  messages: [],
  saveFailed: false,
  setSaveFailed: (failed) => set({ saveFailed: failed }),
  addMessage: (message) => {
    set((state) => ({ messages: [...state.messages, message] }));
    // Persist to IndexedDB (Web) / SQLite (Desktop) — surface failures, don't swallow.
    const pid = get().currentAppId;
    if (pid) {
      persistChatHistory(pid, get().messages).then((ok) => {
        useAppStore.getState().setSaveFailed(!ok);
      });
    }
  },
  updateMessage: (id, updates) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    }));
    const pid = get().currentAppId;
    if (pid) {
      persistChatHistory(pid, get().messages).then((ok) => {
        useAppStore.getState().setSaveFailed(!ok);
      });
    }
  },
  truncateMessages: (fromIndex) => {
    set((state) => ({
      messages: state.messages.slice(0, fromIndex),
    }));
    const pid = get().currentAppId;
    if (pid) {
      persistChatHistory(pid, get().messages).then((ok) => {
        useAppStore.getState().setSaveFailed(!ok);
      });
    }
  },
  clearMessages: () => set({ messages: [] }),
  fetchChatHistory: async () => {
    const pid = get().currentAppId;
    if (!pid) return;
    try {
      const messages = await loadChatHistory(pid);
      if (Array.isArray(messages) && messages.length > 0) {
        set({ messages });
      }
    } catch {
      // Keep current messages
    }
  },

  editingMessageId: null,
  setEditingMessageId: (editingMessageId) => set({ editingMessageId }),

  // ── Agent ──────────────────────────────────────────────────────────
  agentStatus: "idle",
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  agentStepCount: 0,
  setAgentStepCount: (agentStepCount) => set({ agentStepCount }),
  agentMaxSteps: 20,
  setAgentMaxSteps: (agentMaxSteps) => set({ agentMaxSteps }),

  // ── File Tree ──────────────────────────────────────────────────────
  fileTree: [],
  setFileTree: (fileTree) => set({ fileTree }),
  selectedFile: null,
  setSelectedFile: (selectedFile) => set({ selectedFile }),

  // ── Workspace ──────────────────────────────────────────────────────
  workspacePort: 5174,
  setWorkspacePort: (workspacePort) => set({ workspacePort }),
  workspaceReady: false,
  setWorkspaceReady: (workspaceReady) => set({ workspaceReady }),

  // ── Apps ───────────────────────────────────────────────────────
  currentAppId: null,
  setCurrentAppId: (id) => {
    set({ currentAppId: id });
    if (id) {
      setAppId(id);
      void saveCurrentAppId(id);
      // Load checkpoints for this app
      get().fetchCheckpoints();
      // Auto-seed: if the app has no source files in OPFS, try to
      // sync them from the filesystem (for apps created by the
      // desktop/Tauri version).
      setTimeout(async () => {
        try {
          const hasFiles = await hasAppFiles(id);
          if (!hasFiles) {
            // First try workspace (most recent generated code, simpler stack)
            let { seeded } = await seedAppFromWorkspace(id);
            if (seeded === 0) {
              // Fall back to app-specific files from apps/{id}/
              seeded = (await seedAppFromFilesystem(id)).seeded;
            }
            if (seeded > 0) {
              // Trigger a preview reload so the newly seeded files show up
              get().triggerReload();
            }
          }
        } catch {
          // Non-critical — seeding is a convenience, not a requirement
        }
      }, 500);
    } else {
      void saveCurrentAppId(null);
    }
  },
  apps: [],
  setApps: (apps) => set({ apps }),
  addApp: (app) =>
    set((state) => ({ apps: [...state.apps, app] })),
  removeApp: (id) =>
    set((state) => ({ apps: state.apps.filter((p) => p.id !== id) })),
  appSwitching: false,
  setAppSwitching: (appSwitching) => set({ appSwitching }),
  appLoading: false,
  setAppLoading: (appLoading) => set({ appLoading }),

  // ── Checkpoints ────────────────────────────────────────────────────
  checkpoints: [],
  setCheckpoints: (checkpoints) => set({ checkpoints }),
  currentCheckpointIndex: -1,
  setCurrentCheckpointIndex: (currentCheckpointIndex) => set({ currentCheckpointIndex }),
  fetchCheckpoints: async () => {
    const pid = get().currentAppId;
    if (!pid) return;
    try {
      const cps = await engineListCheckpoints(pid);
      set({
        checkpoints: cps.map((cp) => ({
          id: cp.id,
          createdAt: cp.createdAt,
        })),
        currentCheckpointIndex: cps.length > 0 ? cps.length - 1 : -1,
      });
    } catch {
      // Engine not ready
    }
  },

  // ── Messages visibility ────────────────────────────────────────────
  visibleMessageCount: -1,
  setVisibleMessageCount: (visibleMessageCount) => set({ visibleMessageCount }),

  // ── Preview ────────────────────────────────────────────────────────
  previewMaximized: false,
  setPreviewMaximized: (previewMaximized) => set({ previewMaximized }),
  togglePreviewMaximized: () =>
    set((state) => ({ previewMaximized: !state.previewMaximized })),
  reloadCounter: 0,
  triggerReload: () => set((state) => ({ reloadCounter: state.reloadCounter + 1 })),

  // ── Settings ───────────────────────────────────────────────────────
  // 初期値は DEFAULT_SETTINGS。実際の設定は initialize でロードする
  // （デスクトップ: config.json / Web: localStorage）— 2026-08-15。
  settings: DEFAULT_SETTINGS,
  setSettings: (settings) => {
    if (settings.language) i18n.changeLanguage(settings.language);
    set({ settings });
    // 永続化は fire-and-forget（UI 応答性優先）。保存失敗は saveSettingsDesktop
    // 内で吸収される（Tauri 環境でなければ localStorage、Rust エラー時も
    // localStorage フォールバック・2026-08-15 レビュー指摘対応）。
    void saveSettingsDesktop(settings);
  },
  updateSettings: (partial) => {
    set((state) => {
      const next = { ...state.settings, ...partial };
      if (partial.language) i18n.changeLanguage(next.language);
      // 同上: fire-and-forget（保存失敗は saveSettingsDesktop 内で吸収）
      void saveSettingsDesktop(next);
      return { settings: next };
    });
  },

  // ── Theme ──────────────────────────────────────────────────────────
  resolvedTheme: "light",
  setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),

  // ── Toasts ─────────────────────────────────────────────────────────
  toasts: [],
  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }));
    const duration = toast.duration ?? 4000;
    setTimeout(() => {
      get().removeToast(id);
    }, duration);
  },
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));
