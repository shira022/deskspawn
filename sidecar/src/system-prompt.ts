/**
 * system-prompt.ts — 後方互換用エクスポート
 *
 * このファイルは既存の import { buildSystemPrompt } from './system-prompt.js' を
 * 壊さないためのブリッジです。実際の実装は system-prompts/ 配下の
 * 専門エージェントプロンプトに移行しました。
 *
 * 新規コードでは以下を推奨:
 *   import { coderPrompt } from './system-prompts/coder.js';
 *   または orchestrator の getSystemPrompt(phase, planContext) を使用。
 */

// Re-export the main coder prompt (previously the single agent prompt)
export { coderPrompt as buildSystemPrompt } from './system-prompts/coder.js';

// Re-export all prompts for convenience
export { plannerPrompt, coderPrompt, verifierPrompt, visualQAPrompt } from './system-prompts/index.js';
