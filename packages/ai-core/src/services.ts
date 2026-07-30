/**
 * @deskspawn/ai-core — Platform-agnostic service interfaces
 *
 * These interfaces abstract platform-specific functionality (AI calls,
 * storage, preview) so that UI components can be shared between
 * Web and Desktop (Tauri) versions of DeskSpawn.
 *
 * Each platform provides its own implementation via the service registry
 * or dependency injection.
 */

import type { ProviderConfig, ModelInfo, Phase } from "./types";

// ── AI Service ───────────────────────────────────────────────────────────

export interface StreamChunk {
  type: "text" | "tool-call" | "tool-result" | "error" | "step-finish" | "finish";
  content: string;
  /** Phase label for display (planner/coder/verifier/visual_qa) */
  phase?: Phase;
  /** Tool name (for tool-call) */
  toolName?: string;
  /** Tool arguments (for tool-call) */
  toolArgs?: Record<string, unknown>;
  /** Phase progress info */
  step?: number;
  stepTotal?: number;
}

export interface GenerateTextParams {
  messages: Array<{ role: string; content: string }>;
  config: ProviderConfig;
  systemPrompt?: string;
  tools?: Record<string, unknown>;
  maxSteps?: number;
}

export interface StreamTextParams {
  messages: Array<{ role: string; content: string }>;
  config: ProviderConfig;
  systemPrompt?: string;
  tools?: Record<string, unknown>;
  maxSteps?: number;
  onChunk: (chunk: StreamChunk) => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

export interface AiService {
  /** Simple generate (no streaming) for quick completions */
  generateText(params: GenerateTextParams): Promise<string>;

  /** Stream text (for chat UI) with per-chunk callbacks */
  streamText(params: StreamTextParams): Promise<void>;

  /** Get available models for a provider */
  getModels(provider: string, apiKey?: string): Promise<ModelInfo[]>;

  /** Check if the service is available / connected */
  isAvailable(): Promise<boolean>;
}

// ── Storage Service ───────────────────────────────────────────────────────

export interface ProjectData {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{ role: string; content: string }>;
  files?: Record<string, string>;
  previewState?: Record<string, unknown>;
}

export interface AppSettings {
  language?: string;
  theme?: "light" | "dark" | "system";
  provider?: string;
  model?: string;
  customEndpoint?: string;
  region?: string;
}

export interface StorageService {
  // Project CRUD
  saveProject(project: ProjectData): Promise<void>;
  loadProject(id: string): Promise<ProjectData | null>;
  listProjects(): Promise<ProjectData[]>;
  deleteProject(id: string): Promise<void>;

  // App settings
  saveSettings(settings: AppSettings): Promise<void>;
  loadSettings(): Promise<AppSettings | null>;

  // API key (platform-specific secure storage)
  saveApiKey(provider: string, apiKey: string): Promise<void>;
  loadApiKey(provider: string): Promise<string | null>;
  deleteApiKey(provider: string): Promise<void>;

  // Project file operations
  writeFile(projectId: string, path: string, content: string): Promise<void>;
  readFile(projectId: string, path: string): Promise<string | null>;
  listFiles(projectId: string): Promise<string[]>;

  /** Check if the service is available */
  isAvailable(): Promise<boolean>;
}

// ── Preview Service ───────────────────────────────────────────────────────

export interface PreviewService {
  /** Start preview server for generated project files */
  startPreview(projectId: string, files: Record<string, string>): Promise<{ url: string }>;

  /** Stop the currently running preview */
  stopPreview(): Promise<void>;

  /** Get current preview URL (without starting) */
  getPreviewUrl(): string | null;

  /** Check if preview service is available */
  isAvailable(): Promise<boolean>;
}

// ── Service Registry ──────────────────────────────────────────────────────

/**
 * Service registry — platform code sets the implementations at startup.
 * UI components access services through this registry.
 */
export class ServiceRegistry {
  private static _ai: AiService | null = null;
  private static _storage: StorageService | null = null;
  private static _preview: PreviewService | null = null;

  static get ai(): AiService {
    if (!this._ai) throw new Error("AiService not registered");
    return this._ai;
  }

  static get storage(): StorageService {
    if (!this._storage) throw new Error("StorageService not registered");
    return this._storage;
  }

  static get preview(): PreviewService {
    if (!this._preview) throw new Error("PreviewService not registered");
    return this._preview;
  }

  static register(kind: "ai", impl: AiService): void;
  static register(kind: "storage", impl: StorageService): void;
  static register(kind: "preview", impl: PreviewService): void;
  static register(
    kind: "ai" | "storage" | "preview",
    impl: AiService | StorageService | PreviewService,
  ): void {
    if (kind === "ai") this._ai = impl as AiService;
    else if (kind === "storage") this._storage = impl as StorageService;
    else if (kind === "preview") this._preview = impl as PreviewService;
  }

  static reset(): void {
    this._ai = null;
    this._storage = null;
    this._preview = null;
  }
}
