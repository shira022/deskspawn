import { z } from 'zod';

// ─── Provider Configuration ───────────────────────────────────────────────────

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  customEndpoint?: string;
}

// ─── Model Discovery ──────────────────────────────────────────────────────────

/**
 * Model-specific pricing in $ per 1M tokens (from models.dev).
 * The source API may include additional rate variants beyond these fields.
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
  supportsTemperature: boolean;
  supportsReasoning: boolean;
  supportsToolCall: boolean;
  supportsImageInput: boolean;
  contextLimit: number;
  maxOutput: number;
  /** Real pricing from models.dev — undefined for ollama/custom models */
  cost?: ModelCost;
}

// ─── IPC Messages (Rust → Sidecar) ─────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ChatRequest {
  type: 'chat';
  id: string;
  messages: ChatMessage[];
  config: ProviderConfig;
  maxSteps?: number;
}

export interface PingMessage {
  type: 'ping';
  id?: string;
}

export type InboundMessage = ChatRequest | PingMessage;

// ─── IPC Messages (Sidecar → Rust) ─────────────────────────────────────────────

export interface ToolCallResponse {
  type: 'tool_call';
  id: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface TextResponse {
  type: 'text';
  id: string;
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ErrorResponse {
  type: 'error';
  id: string;
  error: string;
}

export interface ReadyResponse {
  type: 'ready';
}

export interface PongResponse {
  type: 'pong';
  id?: string;
}

export type OutboundMessage =
  | ToolCallResponse
  | TextResponse
  | ErrorResponse
  | ReadyResponse
  | PongResponse;

// ─── Agent Internals ───────────────────────────────────────────────────────────

export interface ToolCall {
  id?: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string;
}

// ─── Tool Call Data (from Vercel AI SDK onStepFinish) ──────────────────────────

// Represents a tool call as emitted by the AI SDK in onStepFinish
export interface AIToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

// ─── Schema for Artifact JSON (apply_artifact tool) ────────────────────────────

const FileActionSchema = z.object({
  type: z.literal('file'),
  mode: z.enum(['file', 'diff']),
  filePath: z.string(),
  content: z.string().optional(),
  search: z.string().optional(),
  replace: z.string().optional(),
});

const ColumnSchema = z.object({
  name: z.string(),
  sqlType: z.string(),
  nullable: z.boolean(),
  defaultValue: z.string().optional(),
  primaryKey: z.boolean().default(false),
  unique: z.boolean().default(false),
  references: z.string().optional(),
});

const TemplateActionSchema = z.object({
  type: z.literal('template'),
  template: z.string(),
  tableName: z.string(),
  columns: z.array(ColumnSchema).min(1),
});

const ShellActionSchema = z.object({
  type: z.literal('shell'),
  command: z.string(),
});

export const ArtifactSchema = z.object({
  id: z.string(),
  title: z.string(),
  actions: z.array(
    z.discriminatedUnion('type', [
      FileActionSchema,
      TemplateActionSchema,
      ShellActionSchema,
    ])
  ).max(30),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

// ─── Action types for tool-executors ──────────────────────────────────────────

export interface FileAction {
  type: 'file';
  mode: 'file';
  filePath: string;
  content: string;
}

export interface DiffAction {
  type: 'file';
  mode: 'diff';
  filePath: string;
  search: string;
  replace: string;
}

export interface ColumnDef {
  name: string;
  sqlType: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey?: boolean;
  unique?: boolean;
  references?: string;
}

export interface TemplateAction {
  type: 'template';
  template: string;
  tableName: string;
  columns: ColumnDef[];
}

export interface ShellAction {
  type: 'shell';
  command: string;
}

export type Action = FileAction | DiffAction | TemplateAction | ShellAction;

// ─── Multi-Agent Orchestrator Types ─────────────────────────────────────────────

/** Available agent phases in the multi-agent pipeline */
export type Phase = 'planner' | 'coder' | 'verifier' | 'visual_qa';

/** Token usage tracking */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** Triage result */
export interface TriageResult {
  mode: 'single' | 'multi';
  reason: string;
}

/**
 * Error codes for user-facing messages in SSE events (server.ts HTTP mode).
 * The frontend uses these codes to look up localized translations.
 */
export type ErrorCode =
  | 'RATE_LIMIT'
  | 'GENERATION_FAILED'
  | 'PROJECT_DELETE_ACTIVE'
  | 'PROJECT_NAME_REQUIRED'
  | 'PROJECT_ID_REQUIRED'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_DIR_NOT_FOUND'
  | 'PATH_REQUIRED'
  | 'CHECKPOINT_ID_REQUIRED'
  | 'KEEP_CHECKPOINT_ID_REQUIRED'
  | 'MESSAGES_REQUIRED'
  | 'API_KEY_REQUIRED'
  | 'MODELS_FETCH_FAILED'
  | 'SERVER_ERROR'
  | 'NO_BACKUP_FOUND'
  | 'EXPORT_DOWNLOAD_FAILED'
  | 'EXPORT_FAILED'
  | 'FILE_BASE64_REQUIRED'
  | 'INVALID_IMPORT_FILE'
  | 'IMPORT_FAILED'
  | 'INTERNAL_ERROR';

/**
 * Extended error detail for SSE error events that includes an optional
 * error code for frontend i18n lookup.
 */
export interface ErrorEventDetail {
  error: string;
  errorCode?: ErrorCode;
}
