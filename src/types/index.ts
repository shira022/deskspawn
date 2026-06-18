// ============================================================
// AI Provider Configuration Types
// ============================================================

import type { LanguageCode } from "@/lib/languages";

export type ProviderKind = "openai" | "anthropic" | "google" | "ollama" | "custom" | "amazon-bedrock" | "azure-openai" | "google-vertex";

export interface AiConfig {
  provider: ProviderKind;
  apiKey: string;
  model: string;
  customEndpoint?: string;
  /** AWS region (for Amazon Bedrock) */
  region?: string;
  /** エージェントの最大ステップ数（動的ステップ管理のベース値として使用） */
  maxSteps?: number;
  /**
   * API キーがストレージに保存されている場合 true。
   * フロントエンドはキーの実際の値にアクセスできず、このフラグでのみ
   * 設定済みかどうかを判断する。
   */
  apiKeyConfigured?: boolean;
}

// ── Model Discovery ─────────────────────────────────────────────────────────

/**
 * Model-specific pricing in $ per 1M tokens (from models.dev).
 * Same model can have different rates per usage method:
 *   input / output / cacheRead / cacheWrite / reasoning
 */
export interface ModelCost {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  supportsReasoning: boolean;
  supportsToolCall: boolean;
  supportsImageInput: boolean;
  contextLimit: number;
  maxOutput: number;
  /** Real pricing from models.dev — undefined for ollama/custom models */
  cost?: ModelCost;
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
  toolResults?: Record<string, unknown>;
  checkpointId?: string;
  /** AIエージェントの各ステップ実行ログ（折りたたみ表示用） */
  stepLogs?: StepLogEntry[];
  /** 各フェーズの詳細出力（planner/coder/verifier/visual_qa） */
  phaseOutputs?: PhaseOutput[];
  /** トークン使用量とモデル情報（履歴に永続化される） */
  usage?: TokenUsage;
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

export type AppPhase = "ai-config" | "main";

export type LayoutMode = "2-pane" | "3-pane";

export type AgentStatus = "idle" | "running" | "error" | "complete";

// ============================================================
// Theme / Settings Types
// ============================================================

export type ThemeMode = "light" | "dark" | "system";

export interface AppSettings {
  theme: ThemeMode;
  uiFontSize: number; // px
  codeFontSize: number; // px
  language: LanguageCode;
  /** シンプルモード — 非エンジニア向けに平易な説明で結果だけ伝える */
  simpleMode: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  uiFontSize: 14,
  codeFontSize: 13,
  language: "ja",
  simpleMode: true,
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
  /** Tokens consumed by reasoning/thinking (billed at reasoning rate if available) */
  reasoningTokens?: number;
  /** Input tokens served from provider cache (billed at cached input rate) */
  cachedInputTokens?: number;
  /** Input tokens used to create a new cache entry (billed at cache write rate) */
  cacheCreationTokens?: number;
  /** ISO timestamp when this usage was recorded */
  timestamp: string;
  /** Which AI provider was used (e.g. "openai", "anthropic") */
  provider?: string;
  /** Which AI model was used (e.g. "gpt-4o", "claude-sonnet-4") */
  model?: string;
  /** Estimated cost in USD (calculated client-side from models.dev pricing) */
  estimatedCost?: number;
}
