// ============================================================
// AI Provider Configuration Types
// ============================================================

export type ProviderKind = "openai" | "anthropic" | "google" | "ollama" | "custom";

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
   * Tauri 実環境で API キーが OS キーチェーンに保存されている場合 true。
   * フロントエンドはキーの実際の値にアクセスできず、このフラグでのみ
   * 設定済みかどうかを判断する。
   */
  apiKeyConfigured?: boolean;
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
