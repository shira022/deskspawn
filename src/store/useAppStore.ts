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
  SpawnConfig,
} from "@/types";

const STORAGE_KEY = "deskspawn_ai_config";
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;

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
  {
    name: "Rust",
    description: "Rust compiler and toolchain",
    checkCommand: "rustc --version",
    status: "pending",
    downloadUrl: "https://rustup.rs/",
    wingetPackage: "Rustlang.Rustup",
    sizeMb: 400,
  },
  {
    name: "VS Build Tools",
    description: "MSVC compiler for native compilation",
    checkCommand: "vswhere",
    status: "pending",
    downloadUrl:
      "https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022",
    wingetPackage: "Microsoft.VisualStudio.2022.BuildTools",
    sizeMb: 4500,
  },
  {
    name: "WebView2",
    description: "Required for Tauri WebView",
    checkCommand: "reg query",
    status: "pending",
    downloadUrl: "https://developer.microsoft.com/microsoft-edge/webview2/",
    wingetPackage: "Microsoft.EdgeWebView2Runtime",
    sizeMb: 120,
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
  clearMessages: () => void;

  // Agent
  agentStatus: AgentStatus;
  setAgentStatus: (status: AgentStatus) => void;
  agentStepCount: number;
  setAgentStepCount: (count: number) => void;
  agentMaxSteps: number;

  // File Tree
  fileTree: FileNode[];
  setFileTree: (tree: FileNode[]) => void;
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;

  // Errors
  errors: ErrorInfo[];
  setErrors: (errors: ErrorInfo[]) => void;

  // Spawn
  spawnConfig: SpawnConfig | null;
  setSpawnConfig: (config: SpawnConfig) => void;

  // Theme
  isDarkMode: boolean;
  toggleDarkMode: () => void;

  // Vite (DeskSpawn own dev server)
  vitePort: number;
  setVitePort: (port: number) => void;

  // Workspace preview
  workspacePort: number;
  setWorkspacePort: (port: number) => void;

  // Workspace
  workspaceReady: boolean;
  setWorkspaceReady: (ready: boolean) => void;
}

export const useAppStore = create<Store>((set, get) => ({
  phase: "ai-config",
  setPhase: (phase) => set({ phase }),
  initialized: false,
  initialize: async () => {
    try {
      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        const config = await invoke<AiConfig | null>("load_ai_config");
        if (config) {
          set({ aiConfig: config, phase: "main" });
        }
      } else {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const config = JSON.parse(raw) as AiConfig;
          set({ aiConfig: config, phase: "main" });
        }
      }
    } catch (e) {
      console.warn("Failed to load stored AI config:", e);
    } finally {
      set({ initialized: true });
    }
  },

  layoutMode: "2-pane",
  setLayoutMode: (layoutMode) => set({ layoutMode }),

  aiConfig: null,
  setAiConfig: (aiConfig) => {
    set({ aiConfig });
    // Persist to storage
    if (isTauri) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("save_ai_config", { config: aiConfig }).catch((e) =>
          console.warn("Failed to save AI config:", e),
        );
      });
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(aiConfig));
      } catch (e) {
        console.warn("Failed to save AI config to localStorage:", e);
      }
    }
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
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  clearMessages: () => set({ messages: [] }),

  agentStatus: "idle",
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  agentStepCount: 0,
  setAgentStepCount: (agentStepCount) => set({ agentStepCount }),
  agentMaxSteps: 20,

  fileTree: [],
  setFileTree: (fileTree) => set({ fileTree }),
  selectedFile: null,
  setSelectedFile: (selectedFile) => set({ selectedFile }),

  errors: [],
  setErrors: (errors) => set({ errors }),

  spawnConfig: null,
  setSpawnConfig: (spawnConfig) => set({ spawnConfig }),

  isDarkMode: true,
  toggleDarkMode: () =>
    set((state) => ({ isDarkMode: !state.isDarkMode })),

  vitePort: 5173,
  setVitePort: (vitePort) => set({ vitePort }),

  workspacePort: 5174,
  setWorkspacePort: (workspacePort) => set({ workspacePort }),

  workspaceReady: false,
  setWorkspaceReady: (workspaceReady) => set({ workspaceReady }),
}));
