/**
 * @deskspawn/ai-core — Shared AI pipeline types and utilities
 */

// Shared types
export type {
  ProviderConfig,
  ModelCost,
  ModelInfo,
  Phase,
  Usage,
  TriageResult,
  ToolCall,
  ToolResult,
  AIToolCall,
  FileAction,
  DiffAction,
  TemplateAction,
  Action,
  Artifact,
  ColumnDef,
} from "./types";

// Step limit manager
export {
  StepManager,
} from "./step-limits";
export type {
  StepRecord,
  StepProgress,
  StepFinalState,
} from "./step-limits";

// Rate-limit retry
export {
  withRateLimitRetry,
  detectRateLimit,
} from "./retry";
export type {
  RateLimitInfo,
} from "./retry";

// Service interfaces
export type {
  StreamChunk,
  GenerateTextParams,
  StreamTextParams,
  AiService,
  AppData,
  AppSettings,
  StorageService,
  PreviewService,
} from "./services";
export { ServiceRegistry } from "./services";
