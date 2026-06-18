/**
 * @deskspawn/browser-engine — Shared types for the AI engine
 */

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  customEndpoint?: string;
  region?: string;
}

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
  cost?: ModelCost;
}

export type Phase = 'planner' | 'coder' | 'verifier' | 'visual_qa';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface TriageResult {
  mode: 'single' | 'multi';
  reason: string;
}

// ── AI Tool Call Data ──────────────────────────────────────────────────────────

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

export interface AIToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

// ── Artifact / Action Types ────────────────────────────────────────────────────

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

export type Action = FileAction | DiffAction | TemplateAction;

export interface Artifact {
  id: string;
  title: string;
  actions: Action[];
}
