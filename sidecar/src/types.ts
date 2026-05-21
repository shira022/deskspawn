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

export interface ModelInfo {
  id: string;
  name: string;
  supportsTemperature: boolean;
  supportsReasoning: boolean;
  supportsToolCall: boolean;
  contextLimit: number;
  maxOutput: number;
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

const TemplateActionSchema = z.object({
  type: z.literal('template'),
  template: z.string(),
  tableName: z.string(),
  columns: z.array(
    z.object({
      name: z.string(),
      sqlType: z.string(),
      nullable: z.boolean(),
      defaultValue: z.string().optional(),
    })
  ),
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

export interface TemplateAction {
  type: 'template';
  template: string;
  tableName: string;
  columns: {
    name: string;
    sqlType: string;
    nullable: boolean;
    defaultValue?: string;
  }[];
}

export interface ShellAction {
  type: 'shell';
  command: string;
}

export type Action = FileAction | DiffAction | TemplateAction | ShellAction;
