import { create } from "zustand";
import type {
  AppPhase,
  LayoutMode,
  AiConfig,
  EnvCheckItem,
  WingetStatus,
  SetupProgress,
  ChatMessage,
  AgentStatus,
  ErrorInfo,
  FileNode,
  ProjectMeta,
  CheckpointInfo,
} from "@/types";
import { callBackend } from "@/lib/backend";
import { SIDECAR_BASE } from "@/lib/constants";

/**
 * Persist the current messages array to the sidecar so it survives page reloads.
 * Silently fails if the sidecar is not available (non-critical).
 */
async function persistMessages(messages: ChatMessage[]): Promise<void> {
  try {
    await fetch(`${SIDECAR_BASE}/chat/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  } catch {
    // Sidecar not available — messages stay in memory, next save will retry
  }
}

const defaultEnvChecks: EnvCheckItem[] = [
  {
    name: "Node.js",
    description: "Runtime >= 20 LTS",
    checkCommand: "node --version",
    status: "pending",
    downloadUrl: "https://nodejs.org/",
    wingetPackage: "OpenJS.NodeJS.LTS",
    sizeMb: 30,
  },
];

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

  // Environment Check
  envChecks: EnvCheckItem[];
  setEnvCheckResults: (results: EnvCheckItem[]) => void;
  setEnvCheckStatus: (index: number, status: EnvCheckItem["status"]) => void;
  allEnvChecksPassed: () => boolean;
  failedEnvChecks: () => EnvCheckItem[];
  wingetStatus: WingetStatus | null;
  setWingetStatus: (status: WingetStatus | null) => void;
  isWingetAvailable: () => boolean;

  // Setup Progress
  setupProgress: Map<string, SetupProgress>;
  setSetupProgress: (progress: SetupProgress) => void;
  setupRunning: boolean;
  setSetupRunning: (running: boolean) => void;

  // Chat
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  truncateMessages: (fromIndex: number) => void;
  clearMessages: () => void;

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

  // Errors
  errors: ErrorInfo[];
  setErrors: (errors: ErrorInfo[]) => void;

  // Vite (DeskSpawn own dev server)
  vitePort: number;
  setVitePort: (port: number) => void;

  // Workspace preview
  workspacePort: number;
  setWorkspacePort: (port: number) => void;

  // Workspace
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

  // New app preparation (dev server starting, deps installing)
  appLoading: boolean;
  setAppLoading: (loading: boolean) => void;

  // Checkpoints
  checkpoints: CheckpointInfo[];
  setCheckpoints: (checkpoints: CheckpointInfo[]) => void;
  currentCheckpointIndex: number;
  setCurrentCheckpointIndex: (index: number) => void;
  fetchCheckpoints: () => Promise<void>;

  // How many chat messages are visible.
  // -1 means "show all" (the normal state).
  // Any non-negative value means only the first N messages are shown,
  // used when the preview slider navigates back in time.
  visibleMessageCount: number;
  setVisibleMessageCount: (count: number) => void;

  // Preview maximized state
  previewMaximized: boolean;
  setPreviewMaximized: (maximized: boolean) => void;
  togglePreviewMaximized: () => void;

  // Generation reload trigger (increment to force iframe reload after generation)
  reloadCounter: number;
  triggerReload: () => void;
}

export const useAppStore = create<Store>((set, get) => ({
  phase: "ai-config",
  setPhase: (phase) => set({ phase }),
  initialized: false,
  initialize: async () => {
    try {
      // Load AI config from backend (Tauri IPC or localStorage)
      try {
        const config = await callBackend<AiConfig | null>("load_ai_config");
        if (config) {
          const isTauri =
            typeof window !== "undefined" &&
            !!(window as any).__TAURI_INTERNALS__;

          // Tauri mode: apiKey is "" (stored in keychain, never in frontend).
          //   Check apiKeyConfigured flag or Ollama (no key needed).
          // Browser mode: apiKey comes from localStorage.
          //   Check actual apiKey value.
          const hasAccessibleKey =
            !!(config.apiKey || config.apiKeyConfigured || config.provider === "ollama");

          if (config.provider && config.model && hasAccessibleKey) {
            // In Tauri mode, strip apiKey for zero frontend exposure
            if (isTauri) {
              config.apiKey = "";
            }
            set({ aiConfig: config, phase: "main" });
          } else {
            console.warn(
              "[initialize] Stored AI config is incomplete; staying on setup screen.",
              config,
            );
          }
        }
      } catch (e) {
        console.warn("[initialize] Failed to load AI config:", e);
        // Stay on ai-config phase — user will see the setup screen
      }

      // Load projects on init
      try {
        const res = await fetch(`${SIDECAR_BASE}/projects/current`);
        if (res.ok) {
          const data = await res.json();
          if (data.project) {
            set({ currentProjectId: data.project.id });
          }
        }
      } catch {
        // Sidecar not running yet, that's fine
      }

      // Try loading project list
      try {
        const res = await fetch(`${SIDECAR_BASE}/projects/list`);
        if (res.ok) {
          const data = await res.json();
          if (data.projects) {
            set({ projects: data.projects });
          }
        }
      } catch {
        // Sidecar not running yet
      }

      // Try fetching checkpoints
      try {
        const res = await fetch(`${SIDECAR_BASE}/projects/checkpoints`);
        if (res.ok) {
          const data = await res.json();
          const cps: CheckpointInfo[] = data.checkpoints.map((cp: any) => ({
            id: cp.id,
            createdAt: new Date(cp.createdAt),
          }));
          set({
            checkpoints: cps,
            currentCheckpointIndex: cps.length > 0 ? cps.length - 1 : -1,
          });
        }
      } catch {
        // Sidecar not running yet
      }

      // Try loading chat history (so it survives page reload)
      try {
        const res = await fetch(`${SIDECAR_BASE}/chat/history`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.messages) && data.messages.length > 0) {
            set({ messages: data.messages });
          }
        }
      } catch {
        // Sidecar not running yet
      }
    } catch (e) {
      console.warn("Failed to load stored config:", e);
    } finally {
      set({ initialized: true });
    }
  },

  layoutMode: "2-pane",
  setLayoutMode: (layoutMode) => set({ layoutMode }),

  aiConfig: null,
  setAiConfig: (aiConfig) => {
    // Always save the full config (including apiKey) to backend.
    // In Tauri mode, Rust stores the key in OS keychain + sidecar.
    callBackend("save_ai_config", { config: aiConfig }).catch((e) =>
      console.warn("Failed to save AI config:", e),
    );

    // In Tauri mode, strip apiKey from frontend state for zero exposure.
    // The key lives only in: OS keychain + sidecar process memory.
    const isTauri =
      typeof window !== "undefined" &&
      !!(window as any).__TAURI_INTERNALS__;
    const safeConfig = isTauri ? { ...aiConfig, apiKey: "" } : aiConfig;
    set({ aiConfig: safeConfig });
  },

  envChecks: defaultEnvChecks,
  setEnvCheckResults: (results) => set({ envChecks: results }),
  setEnvCheckStatus: (index, status) =>
    set((state) => {
      const checks = [...state.envChecks];
      checks[index] = { ...checks[index], status };
      return { envChecks: checks };
    }),
  allEnvChecksPassed: () => get().envChecks.every((c) => c.status === "ok"),
  failedEnvChecks: () => get().envChecks.filter((c) => c.status === "fail"),
  wingetStatus: null,
  setWingetStatus: (wingetStatus) => set({ wingetStatus }),
  isWingetAvailable: () => get().wingetStatus?.available ?? false,

  setupProgress: new Map(),
  setSetupProgress: (progress) =>
    set((state) => {
      const next = new Map(state.setupProgress);
      next.set(progress.package, progress);
      return { setupProgress: next };
    }),
  setupRunning: false,
  setSetupRunning: (setupRunning) => set({ setupRunning }),

  messages: [],
  addMessage: (message) => {
    set((state) => ({ messages: [...state.messages, message] }));
    persistMessages(get().messages);
  },
  updateMessage: (id, updates) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    }));
    persistMessages(get().messages);
  },
  truncateMessages: (fromIndex) => {
    set((state) => ({
      messages: state.messages.slice(0, fromIndex),
    }));
    persistMessages(get().messages);
  },
  clearMessages: () => set({ messages: [] }),

  editingMessageId: null,
  setEditingMessageId: (editingMessageId) => set({ editingMessageId }),

  agentStatus: "idle",
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  agentStepCount: 0,
  setAgentStepCount: (agentStepCount) => set({ agentStepCount }),
  agentMaxSteps: 20,
  setAgentMaxSteps: (agentMaxSteps) => set({ agentMaxSteps }),

  fileTree: [],
  setFileTree: (fileTree) => set({ fileTree }),
  selectedFile: null,
  setSelectedFile: (selectedFile) => set({ selectedFile }),

  errors: [],
  setErrors: (errors) => set({ errors }),

  vitePort: 5173,
  setVitePort: (vitePort) => set({ vitePort }),

  workspacePort: 5174,
  setWorkspacePort: (workspacePort) => set({ workspacePort }),

  workspaceReady: false,
  setWorkspaceReady: (workspaceReady) => set({ workspaceReady }),

  // Projects
  currentProjectId: null,
  setCurrentProjectId: (currentProjectId) => set({ currentProjectId }),
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

  // Checkpoints
  checkpoints: [],
  setCheckpoints: (checkpoints) => set({ checkpoints }),
  currentCheckpointIndex: -1,
  setCurrentCheckpointIndex: (currentCheckpointIndex) => set({ currentCheckpointIndex }),
  fetchCheckpoints: async () => {
    try {
      const res = await fetch(`${SIDECAR_BASE}/projects/checkpoints`);
      if (!res.ok) return;
      const data = await res.json();
      const cps: CheckpointInfo[] = data.checkpoints.map((cp: any) => ({
        id: cp.id,
        createdAt: new Date(cp.createdAt),
      }));
      set({ checkpoints: cps });
    } catch {
      // sidecar not available
    }
  },

  // How many messages to show in chat (-1 = all)
  visibleMessageCount: -1,
  setVisibleMessageCount: (visibleMessageCount) => set({ visibleMessageCount }),

  // Preview maximized
  previewMaximized: false,
  setPreviewMaximized: (previewMaximized) => set({ previewMaximized }),
  togglePreviewMaximized: () =>
    set((state) => ({ previewMaximized: !state.previewMaximized })),

  // Generation reload trigger
  reloadCounter: 0,
  triggerReload: () => set((state) => ({ reloadCounter: state.reloadCounter + 1 })),
}));
