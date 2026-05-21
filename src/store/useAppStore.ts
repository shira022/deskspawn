import { create } from "zustand";
import type {
  AppPhase,
  LayoutMode,
  AiConfig,
  EnvCheckItem,
  ChatMessage,
  AgentStatus,
  ErrorInfo,
  FileNode,
  SpawnConfig,
} from "@/types";

const defaultEnvChecks: EnvCheckItem[] = [
  {
    name: "Node.js",
    description: "Runtime >= 20 LTS",
    checkCommand: "node --version",
    status: "pending",
    downloadUrl: "https://nodejs.org/",
  },
  {
    name: "Rust (MSVC Toolchain)",
    description: "Rust compiler and toolchain",
    checkCommand: "rustc --version",
    status: "pending",
    downloadUrl: "https://rustup.rs/",
  },
  {
    name: "Visual Studio Build Tools",
    description: "MSVC compiler for Rust",
    checkCommand: "vswhere",
    status: "pending",
    downloadUrl: "https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022",
  },
  {
    name: "WebView2 Runtime",
    description: "Required for Tauri WebView",
    checkCommand: "reg query",
    status: "pending",
    downloadUrl: "https://developer.microsoft.com/microsoft-edge/webview2/",
  },
];

interface Store {
  // Phase
  phase: AppPhase;
  setPhase: (phase: AppPhase) => void;

  // Layout
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;

  // AI Config
  aiConfig: AiConfig | null;
  setAiConfig: (config: AiConfig) => void;

  // Environment Check
  envChecks: EnvCheckItem[];
  setEnvCheckStatus: (index: number, status: "ok" | "fail") => void;
  allEnvChecksPassed: () => boolean;

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

  // Vite
  vitePort: number;
  setVitePort: (port: number) => void;

  // Workspace
  workspaceReady: boolean;
  setWorkspaceReady: (ready: boolean) => void;
}

export const useAppStore = create<Store>((set, get) => ({
  phase: "ai-config",
  setPhase: (phase) => set({ phase }),

  layoutMode: "2-pane",
  setLayoutMode: (layoutMode) => set({ layoutMode }),

  aiConfig: null,
  setAiConfig: (aiConfig) => set({ aiConfig }),

  envChecks: defaultEnvChecks,
  setEnvCheckStatus: (index, status) =>
    set((state) => {
      const checks = [...state.envChecks];
      checks[index] = { ...checks[index], status };
      return { envChecks: checks };
    }),
  allEnvChecksPassed: () => get().envChecks.every((c) => c.status === "ok"),

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

  workspaceReady: false,
  setWorkspaceReady: (workspaceReady) => set({ workspaceReady }),
}));
