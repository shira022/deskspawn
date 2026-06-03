// ============================================================
// AI Provider Configuration Types
// ============================================================

export type ProviderKind = "openai" | "anthropic" | "google" | "ollama" | "custom";

export type StorageMethod = "keychain" | "file";

export interface AiConfig {
  provider: ProviderKind;
  apiKey: string;
  model: string;
  customEndpoint?: string;
  apiVersion?: string;
  temperature: number;
  maxTokens?: number;
  /** エージェントの最大ステップ数（動的ステップ管理のベース値として使用） */
  maxSteps?: number;
  /**
   * API キーがストレージに保存されている場合 true。
   * フロントエンドはキーの実際の値にアクセスできず、このフラグでのみ
   * 設定済みかどうかを判断する。
   */
  apiKeyConfigured?: boolean;
  /**
   * API キーの保存方法:
   * - "keychain": OS キーチェーン（macOS Keychain / Windows Credential Manager）
   * - "file": 設定ディレクトリ内の credentials.json（パーミッション 600）
   */
  storageMethod?: StorageMethod;
}

// ── Model Discovery ─────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  supportsTemperature: boolean;
  supportsReasoning: boolean;
  supportsToolCall: boolean;
  supportsImageInput: boolean;
  contextLimit: number;
  maxOutput: number;
}

// ============================================================
// Environment Check Types
// ============================================================

export interface EnvCheckItem {
  name: string;
  description: string;
  checkCommand: string;
  status: "pending" | "ok" | "fail" | "installing";
  downloadUrl?: string;
  wingetPackage?: string;
  sizeMb?: number;
}

export interface WingetStatus {
  available: boolean;
  version?: string;
  message: string;
}

export interface SetupProgress {
  package: string;
  stage: "starting" | "downloading" | "installing" | "complete" | "error";
  progressPercent: number;
  message: string;
}

// ============================================================
// Artifact / Payload Types
// ============================================================

export interface Artifact {
  id: string;
  title: string;
  actions: Action[];
}

export type Action = FileAction | DiffAction | TemplateAction | ShellAction;

export interface FileAction {
  type: "file";
  mode: "file";
  filePath: string;
  content: string;
}

export interface DiffAction {
  type: "file";
  mode: "diff";
  filePath: string;
  search: string;
  replace: string;
}

export type SqlColumnType = "INTEGER" | "REAL" | "TEXT" | "BOOLEAN" | "DATETIME";

export interface ColumnDef {
  name: string;
  sqlType: SqlColumnType;
  nullable: boolean;
  defaultValue?: string;
}

export interface TemplateAction {
  type: "template";
  template: "crud";
  tableName: string;
  columns: ColumnDef[];
}

export interface ShellAction {
  type: "shell";
  command: string;
}

// ============================================================
// Tool Result Types
// ============================================================

export interface FileInfo {
  path: string;
  size: number;
  lastModified: string;
}

export interface ApplyResult {
  success: boolean;
  filesChanged: string[];
  shellCommandsRun: string[];
  errors?: string[];
}

export interface ShellResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ErrorType = "typescript" | "vite";

export interface ErrorInfo {
  type: ErrorType;
  message: string;
  filePath?: string;
  line?: number;
}

// ============================================================
// Chat Message Types
// ============================================================

export type MessageRole = "user" | "assistant" | "system";

export interface StepLogEntry {
  /** ステップ番号 (1-based) */
  step: number;
  /** 呼び出されたツール名 */
  toolName: string;
  /** ツールに渡された引数 */
  args: Record<string, unknown>;
  /** ツール実行結果の要約 */
  result?: string;
  /** ツール実行結果の詳細データ */
  detail?: Record<string, unknown>;
  /** 実行ステータス */
  status: "running" | "success" | "error";
  /** ツール表示用のアイコン/ラベル */
  toolLabel?: string;
}

export interface PhaseOutput {
  phase: string;
  label: string;
  text: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  artifacts?: Artifact[];
  toolResults?: Record<string, unknown>;
  checkpointId?: string;
  /** AIエージェントの各ステップ実行ログ（折りたたみ表示用） */
  stepLogs?: StepLogEntry[];
  /** 各フェーズの詳細出力（planner/coder/verifier/visual_qa） */
  phaseOutputs?: PhaseOutput[];
}

// ============================================================
// Workspace / File Tree Types
// ============================================================

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  size?: number;
}

// ============================================================
// Project Types
// ============================================================

export type AppType = "web";
export type StorageType = "indexeddb";

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckpointInfo {
  id: string;
  createdAt: Date;
}

// ============================================================
// App State Types
// ============================================================

export type AppPhase = "ai-config" | "env-check" | "main";

export type LayoutMode = "2-pane" | "3-pane";

export type AgentStatus = "idle" | "running" | "error" | "complete";

export interface AppState {
  phase: AppPhase;
  layoutMode: LayoutMode;
  aiConfig: AiConfig | null;
  envChecks: EnvCheckItem[];
  messages: ChatMessage[];
  agentStatus: AgentStatus;
  agentStepCount: number;
  agentMaxSteps: number;
  selectedFile: string | null;
  errors: ErrorInfo[];
  vitePort: number;
}

// ============================================================
// Theme / Settings Types
// ============================================================

export type ThemeMode = "light" | "dark" | "system";

export interface AppSettings {
  theme: ThemeMode;
  uiFontSize: number; // px
  codeFontSize: number; // px
  defaultTemperature: number;
  language: string; // e.g. "ja", "en"
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  uiFontSize: 14,
  codeFontSize: 13,
  defaultTemperature: 0.2,
  language: "ja",
};

// ============================================================
// Toast Types
// ============================================================

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number; // ms, default 4000
}

// ============================================================
// Token Usage Types
// ============================================================

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** ISO timestamp when this usage was recorded */
  timestamp: string;
  /** Optional: which AI provider/model was used */
  model?: string;
  /** Optional: estimated cost in USD */
  estimatedCost?: number;
}

// Provider-specific pricing per 1K tokens (approximate)
export const PROVIDER_PRICES: Record<string, { input: number; output: number }> = {
  openai: { input: 0.0025, output: 0.01 },    // GPT-4o mini approx
  anthropic: { input: 0.003, output: 0.015 },  // Claude Sonnet approx
  google: { input: 0.0025, output: 0.0075 },   // Gemini 1.5 Pro approx
  ollama: { input: 0, output: 0 },              // Local, free
  custom: { input: 0, output: 0 },              // Unknown pricing
};
