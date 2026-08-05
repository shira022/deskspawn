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
  ProjectMeta,
  CheckpointInfo,
  AppSettings,
  Toast,
} from "@/types";
import { DEFAULT_SETTINGS } from "@/types";
import { saveProviderConfig, loadProviderConfig, saveApiKey, loadApiKey, deleteApiKey, hasApiKey, saveLastProvider, loadLastProvider, listProjects } from "@/lib/storage";
import { setProjectId, listCheckpoints as engineListCheckpoints, persistChatHistory, loadChatHistory } from "@/engine/tool-executors";
import { SETTINGS_KEY } from "@/lib/constants";
import { setModelCostCache, clearModelCostCache } from "@/lib/cost";
import { getModelsForProvider } from "@/lib/models-fetcher";
import { seedProjectFromFilesystem, seedProjectFromWorkspace, hasProjectFiles } from "@/lib/seed-project";
import i18n from "@/lib/i18n";

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
  setAiConfig: (config: AiConfig) => void;
  reloadAiConfig: () => Promise<void>;

  // Chat
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  truncateMessages: (fromIndex: number) => void;
  clearMessages: () => void;
  fetchChatHistory: () => Promise<void>;

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

  // Projects
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;
  projects: ProjectMeta[];
  setProjects: (projects: ProjectMeta[]) => void;
  addProject: (project: ProjectMeta) => void;
  removeProject: (id: string) => void;
  projectSwitching: boolean;
  setProjectSwitching: (switching: boolean) => void;
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
  initialize: async () => {
    // 全体タイムアウト: どの処理がハングしても 10 秒で強制完了させる。
    // これにより Cloudflare 本番などで models.dev の fetch や IndexedDB が
    // 応答しない場合でもアプリが真っ白のまま止まらず、UI を表示できる。
    const INIT_TIMEOUT_MS = 10_000;
    const initBody = async () => {
      try {
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

        // Load projects from IndexedDB
        const storedProjects = await listProjects();
        if (storedProjects.length > 0) {
          set({ projects: storedProjects });
        }

        // Load current project
        try {
          const stored = localStorage.getItem("deskspawn_current_project");
          if (stored) {
            const pid = JSON.parse(stored);
            set({ currentProjectId: pid });
            setProjectId(pid);
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
  setAiConfig: async (aiConfig) => {
    // Save per-provider config (everything except apiKey)
    await saveProviderConfig(aiConfig.provider, {
      model: aiConfig.model,
      customEndpoint: aiConfig.customEndpoint,
      region: aiConfig.region,
      maxSteps: aiConfig.maxSteps,
    });

    // Save/delete API key
    if (aiConfig.apiKey) {
      await saveApiKey(aiConfig.provider, aiConfig.apiKey);
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
    });
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
    }
  },

  // ── Chat ───────────────────────────────────────────────────────────
  messages: [],
  addMessage: (message) => {
    set((state) => ({ messages: [...state.messages, message] }));
    // Persist to IndexedDB
    const pid = get().currentProjectId;
    if (pid) {
      persistChatHistory(pid, get().messages).catch(() => {});
    }
  },
  updateMessage: (id, updates) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    }));
    const pid = get().currentProjectId;
    if (pid) {
      persistChatHistory(pid, get().messages).catch(() => {});
    }
  },
  truncateMessages: (fromIndex) => {
    set((state) => ({
      messages: state.messages.slice(0, fromIndex),
    }));
    const pid = get().currentProjectId;
    if (pid) {
      persistChatHistory(pid, get().messages).catch(() => {});
    }
  },
  clearMessages: () => set({ messages: [] }),
  fetchChatHistory: async () => {
    const pid = get().currentProjectId;
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

  // ── Projects ───────────────────────────────────────────────────────
  currentProjectId: null,
  setCurrentProjectId: (id) => {
    set({ currentProjectId: id });
    if (id) {
      setProjectId(id);
      localStorage.setItem("deskspawn_current_project", JSON.stringify(id));
      // Load checkpoints for this project
      get().fetchCheckpoints();
      // Auto-seed: if the project has no source files in OPFS, try to
      // sync them from the filesystem (for projects created by the
      // desktop/Tauri version).
      setTimeout(async () => {
        try {
          const hasFiles = await hasProjectFiles(id);
          if (!hasFiles) {
            // First try workspace (most recent generated code, simpler stack)
            let { seeded } = await seedProjectFromWorkspace(id);
            if (seeded === 0) {
              // Fall back to project-specific files from projects/{id}/
              seeded = (await seedProjectFromFilesystem(id)).seeded;
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
      localStorage.removeItem("deskspawn_current_project");
    }
  },
  projects: [],
  setProjects: (projects) => set({ projects }),
  addProject: (project) =>
    set((state) => ({ projects: [...state.projects, project] })),
  removeProject: (id) =>
    set((state) => ({ projects: state.projects.filter((p) => p.id !== id) })),
  projectSwitching: false,
  setProjectSwitching: (projectSwitching) => set({ projectSwitching }),
  appLoading: false,
  setAppLoading: (appLoading) => set({ appLoading }),

  // ── Checkpoints ────────────────────────────────────────────────────
  checkpoints: [],
  setCheckpoints: (checkpoints) => set({ checkpoints }),
  currentCheckpointIndex: -1,
  setCurrentCheckpointIndex: (currentCheckpointIndex) => set({ currentCheckpointIndex }),
  fetchCheckpoints: async () => {
    const pid = get().currentProjectId;
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
  settings: (() => {
    const s = loadSettings();
    i18n.changeLanguage(s.language);
    return s;
  })(),
  setSettings: (settings) => {
    saveSettings(settings);
    if (settings.language) i18n.changeLanguage(settings.language);
    set({ settings });
  },
  updateSettings: (partial) => {
    set((state) => {
      const next = { ...state.settings, ...partial };
      saveSettings(next);
      if (partial.language) i18n.changeLanguage(next.language);
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

// ── Settings persistence ────────────────────────────────────────────────

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}
