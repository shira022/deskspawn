/**
 * Multi-Agent Orchestrator — 位相パイプライン
 *
 * アプリ再生AIエンジンを4つの専門エージェント（Planner → Coder → Verifier → Visual QA）
 * で構成するハイブリッドマルチエージェントシステム。
 *
 * 連携方式: アーティファクトベース
 * - Phase 1 (Planner) → 構造化プラン (plan.json) を出力
 * - Phase 2 (Coder) → プランを読み込み実装（StepManager + auto-continuation）
 * - Phase 3 (Verifier) → エラー検出・自動修正
 * - Phase 4 (Visual QA) → スクリーンショット確認
 *
 * 注意: IPCモード(agent.ts)ではRustバックエンドと連携するため、
 * ツールのexecute関数は含まず、ツール呼び出しをRustへ転送します。
 * HTTPモード(server.ts)ではexecute関数を含むツールセットを使用します。
 */
import { generateText, type LanguageModel, type ToolSet } from 'ai';
import { StepManager } from './step-limits.js';
import { withRateLimitRetry } from './retry.js';
import { plannerPrompt } from './system-prompts/planner.js';
import { coderPrompt } from './system-prompts/coder.js';
import { verifierPrompt } from './system-prompts/verifier.js';
import { visualQAPrompt } from './system-prompts/visual-qa.js';
import { triageRequest } from './triage.js';
import type { Phase, Usage, TriageResult } from './types.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<Phase, string> = {
  planner: '📋 要件分析と設計',
  coder: '⚡ コード生成',
  verifier: '🔍 エラーチェックと修正',
  visual_qa: '📸 画面確認',
};

/** Phase-specific step limits and continuation settings */
const PHASE_CONFIGS: Record<Phase, { stepLimit: number; maxContinuations: number }> = {
  planner:   { stepLimit: 8,  maxContinuations: 0 },
  coder:     { stepLimit: 20, maxContinuations: 2 },
  verifier:  { stepLimit: 15, maxContinuations: 0 },
  visual_qa: { stepLimit: 5,  maxContinuations: 0 },
};

/** Tools available per phase */
const PHASE_TOOLS: Record<Phase, string[]> = {
  planner:   ['read_file', 'list_files'],
  coder:     ['read_file', 'list_files', 'apply_artifact', 'run_shell', 'get_errors'],
  verifier:  ['read_file', 'get_errors', 'apply_artifact'],
  visual_qa: ['take_screenshot', 'read_file'],
};

// ─── Helper Types ──────────────────────────────────────────────────────────────

export interface PhaseContext {
  phase: Phase;
  planContext?: string;
}

export interface PipelineResult {
  text: string;
  usage: Usage;
  phases: Phase[];
}

export type ToolBuilderFn = (toolNames: string[]) => ToolSet;

/**
 * SSE event sender interface.
 * Both HTTP (SSE over HTTP) and IPC (JSON over stdin/stdout) implement this.
 */
export type SSEEvent = Record<string, unknown>;
export type SSESender = (event: SSEEvent) => void;

export interface PipelineHooks {
  /** Called before each phase starts */
  onPhaseStart?: (phase: Phase) => void;
  /** Called after each phase completes */
  onPhaseEnd?: (phase: Phase, result: PhaseRunResult) => void;
  /** Called when a tool call is made (for IPC forwarding) */
  onToolCall?: (phase: Phase, toolName: string, args: Record<string, unknown>) => void;
  /** Called on step progress within a phase */
  onStepProgress?: (phase: Phase, progress: { step: number; maxSteps: number }) => void;
  /** Called on checkpoint creation */
  onCheckpoint?: (phase: Phase, checkpointId: string) => void;
  /**
   * Called with each phase's full text output (for frontend detail display).
   * The final `type: text` event carries only the user-facing summary,
   * while phase_detail events carry the full phase output for collapsible UI.
   */
  onPhaseDetail?: (phase: Phase, text: string) => void;
  /** Called on rate limit retry */
  onRateLimit?: (phase: Phase, retryCount: number, maxRetries: number, waitMs: number) => void;
  /** Called on auto-continuation between rounds */
  onContinuation?: (phase: Phase, round: number, maxRounds: number) => void;
  /** Called after triage determines the execution mode */
  onTriageResult?: (result: TriageResult) => void;
}

export interface PhaseRunResult {
  text: string;
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  usage: Usage;
  stepCount: number;
  hitLimit: boolean;
  stoppedReason: string;
  continuationCount: number;
  plan?: string; // extracted plan JSON (only for planner phase)
}

// ─── System Prompt Resolution ──────────────────────────────────────────────────

/**
 * Get the system prompt for a given phase with optional plan context.
 */
export function getSystemPrompt(phase: Phase, planContext?: string): string {
  switch (phase) {
    case 'planner':
      return plannerPrompt();
    case 'coder':
      return coderPrompt(planContext);
    case 'verifier':
      return verifierPrompt();
    case 'visual_qa':
      return visualQAPrompt();
    default:
      return coderPrompt(planContext);
  }
}

/**
 * Get the tools allowed for a given phase.
 */
export function getAllowedTools(phase: Phase): string[] {
  return PHASE_TOOLS[phase];
}

/**
 * Get the phase label for UI display.
 */
export function getPhaseLabel(phase: Phase): string {
  return PHASE_LABELS[phase];
}

// ─── Plan Extraction ──────────────────────────────────────────────────────────

/**
 * Extract structured plan JSON from AI output.
 * The planner agent is instructed to output plan in a ```plan code block.
 * Returns the parsed JSON object, or null if extraction fails.
 */
export function extractPlan(text: string): Record<string, unknown> | null {
  // Try multiple patterns for robustness
  const patterns = [
    /```plan\s*\n?([\s\S]*?)```/,
    /```json\s*\n?({[\s\S]*?})```/,
    /({[\s\S]*?"tasks"[\s\S]*?})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        return JSON.parse(match[1].trim()) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
  }

  // Fallback: try to find any JSON object in the text
  const jsonMatch = text.match(/{[\s\S]*?}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === 'object' && 'tasks' in parsed) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Format a plan object into a concise context string for the coder prompt.
 */
export function formatPlanContext(plan: Record<string, unknown>): string {
  const parts: string[] = [];

  if (plan.summary) {
    parts.push(`Summary: ${plan.summary}`);
  }
  if (plan.architecture) {
    parts.push(`Architecture: ${plan.architecture}`);
  }
  if (plan.dataModel) {
    parts.push(`Data Model: ${plan.dataModel}`);
  }
  if (plan.tasks && Array.isArray(plan.tasks)) {
    parts.push(`\nFiles to create/modify (${plan.tasks.length} tasks):`);
    for (const task of plan.tasks) {
      const taskObj = task as Record<string, unknown>;
      const type = taskObj.type || '?';
      const path = taskObj.filePath || taskObj.path || '?';
      const purpose = taskObj.purpose || taskObj.description || '';
      parts.push(`  [${type}] ${path} — ${purpose}`);
    }
  }

  return parts.join('\n');
}

// ─── Phase Runner ─────────────────────────────────────────────────────────────

/**
 * Phase-level callback used by onStepFinish to integrate with the calling context.
 * Returns an event object with type and phase-specific data.
 */
function makeStepCallback(
  phase: Phase,
  stepManager: StepManager,
  hooks?: PipelineHooks,
) {
  return (event: any) => {
    const toolCalls = event.toolCalls || [];
    stepManager.recordStep(
      toolCalls.map((tc: any) => ({
        toolName: tc.toolName,
        args: (tc.args ?? tc.input ?? {}) as Record<string, unknown>,
      })),
    );

    const { step, maxSteps } = stepManager.getProgress();
    hooks?.onStepProgress?.(phase, { step, maxSteps });

    if (toolCalls.length > 0) {
      for (const call of toolCalls) {
        hooks?.onToolCall?.(phase, call.toolName, (call.args ?? call.input ?? {}) as Record<string, unknown>);
      }
    }
  };
}

/**
 * Run a single phase of the pipeline.
 * 
 * @param model - The language model instance
 * @param phase - Phase to run
 * @param messages - Conversation messages
 * @param buildTools - Function to build tool set for this phase
 * @param signal - Abort signal
 * @param hooks - Pipeline hooks for SSE/events
 * @param planContext - Optional plan context for coder phase
 * @returns Phase run result
 */
export async function runPhase(
  model: LanguageModel,
  phase: Phase,
  messages: Array<Record<string, unknown>>,
  buildTools: ToolBuilderFn,
  signal: AbortSignal,
  hooks?: PipelineHooks,
  planContext?: string,
): Promise<PhaseRunResult> {
  const systemPrompt = getSystemPrompt(phase, planContext);
  const toolNames = getAllowedTools(phase);
  const tools = buildTools(toolNames);
  const config = PHASE_CONFIGS[phase];

  const stepManager = new StepManager(config.stepLimit, 120, config.maxContinuations);
  const onStepFinish = makeStepCallback(phase, stepManager, hooks);

  let allResultText = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let roundMessages = [...messages];

  try {
    do {
      const result = await withRateLimitRetry(
        () => generateText({
          model,
          system: systemPrompt,
          messages: roundMessages as any,
          tools: tools as unknown as ToolSet,
          abortSignal: signal,
          stopWhen: (opts) => stepManager.shouldStop(opts),
          temperature: 0.2,
          maxOutputTokens: 16384,
          onStepFinish,
        }),
        // Rate limit callback
        hooks
          ? (retryEvent) => {
              hooks.onRateLimit?.(phase, retryEvent.retryCount, retryEvent.maxRetries, retryEvent.waitMs);
            }
          : undefined,
      );

      allResultText += (result.text || '');
      totalInputTokens += result.usage?.inputTokens ?? 0;
      totalOutputTokens += result.usage?.outputTokens ?? 0;

      // Check for auto-continuation
      if (stepManager.canAutoContinue()) {
        stepManager.prepareForContinuation();
        hooks?.onContinuation?.(phase, stepManager.continuationCount, stepManager.maxContinuations);

        // Build continuation prompt
        roundMessages.push({
          role: 'user' as const,
          content: '【自動継続】前回のコード生成がステップ上限に達したため、自動的に次のラウンドに移行しました。現在のプロジェクトの状態を確認し、未完了の実装を続けてください。既に全て完了している場合は、完了報告をしてください。',
        });
        continue;
      }
      break;
    } while (true);

    const finalState = stepManager.getFinalState();

    // Extract plan if this was the planner phase
    let plan: string | undefined;
    if (phase === 'planner') {
      const parsedPlan = extractPlan(allResultText);
      if (parsedPlan) {
        plan = formatPlanContext(parsedPlan);
      }
    }

    return {
      text: allResultText,
      toolCalls: [],
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      stepCount: finalState.step,
      hitLimit: finalState.hitLimit,
      stoppedReason: finalState.stoppedReason,
      continuationCount: stepManager.continuationCount,
      plan,
    };
  } catch (error: any) {
    // Return partial result on error
    return {
      text: allResultText || `⚠️ Phase "${phase}" failed: ${error?.message || error}`,
      toolCalls: [],
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      stepCount: 0,
      hitLimit: false,
      stoppedReason: 'error',
      continuationCount: 0,
    };
  }
}

// ─── Triage → Pipeline ─────────────────────────────────────────────────────────

/**
 * Run the multi-agent pipeline WITH automatic triage.
 *
 * 1. Runs lightweight triage to classify request complexity
 * 2. If 'single': runs only the coder phase (fast, cheap)
 * 3. If 'multi': runs full pipeline (Planner → Coder → Verifier → Visual QA)
 *
 * Triage result is sent via `onTriageResult` hook for frontend display.
 *
 * @param model - Language model instance
 * @param requestMessages - Original conversation messages from user
 * @param buildTools - Function that builds tool set from tool name list
 * @param signal - Abort signal
 * @param hooks - Pipeline lifecycle hooks (for SSE events + triage)
 * @returns Combined result with text and usage
 */
export async function runWithTriage(
  model: LanguageModel,
  requestMessages: Array<Record<string, unknown>>,
  buildTools: ToolBuilderFn,
  signal: AbortSignal,
  hooks?: PipelineHooks,
): Promise<PipelineResult> {
  // ── Phase 0: Triage ──────────────────────────────────────────────────
  hooks?.onPhaseStart?.('planner'); // reuse planner label for triage phase

  const triageResult = await triageRequest(requestMessages, model);

  hooks?.onTriageResult?.(triageResult);
  console.log(`[triage] mode=${triageResult.mode} reason="${triageResult.reason}"`);

  // ── Route to single or multi-agent execution ────────────────────────
  if (triageResult.mode === 'single') {
    // Single-agent: run only the coder phase (backward compatible)
    const coderResult = await runPhase(
      model, 'coder', requestMessages, buildTools, signal, hooks,
    );

    return {
      text: coderResult.text,
      usage: coderResult.usage,
      phases: ['coder'],
    };
  }

  // Multi-agent: run full pipeline
  return runPipeline(model, requestMessages, buildTools, signal, hooks);
}

// ─── Full Pipeline ─────────────────────────────────────────────────────────────

/**
 * Run the complete 4-phase multi-agent pipeline.
 * 
 * Phase order:
 *   1. Planner — reads project, creates structured plan
 *   2. Coder — implements the plan (heavy phase, auto-continuation)
 *   3. Verifier — detects and fixes TypeScript errors
 *   4. Visual QA — takes screenshots, verifies UI
 * 
 * Each phase runs the same LLM model but with a different system prompt
 * and restricted tool set. The plan artifact flows from Phase 1 → Phase 2.
 *
 * @param model - Language model instance
 * @param requestMessages - Original conversation messages from user
 * @param buildTools - Function that builds tool set from tool name list
 * @param signal - Abort signal
 * @param hooks - Pipeline lifecycle hooks (for SSE events)
 * @returns Combined result with text and usage
 */
export async function runPipeline(
  model: LanguageModel,
  requestMessages: Array<Record<string, unknown>>,
  buildTools: ToolBuilderFn,
  signal: AbortSignal,
  hooks?: PipelineHooks,
): Promise<PipelineResult> {
  const phases: Phase[] = ['planner', 'coder', 'verifier', 'visual_qa'];
  let planContext: string | undefined;
  let accumulatedText = '';
  let totalUsage: Usage = { inputTokens: 0, outputTokens: 0 };

  for (const phase of phases) {
    hooks?.onPhaseStart?.(phase);

    // For planner, exclude previous phase results from messages
    // For subsequent phases, maintain message continuity
    const messages = phase === 'planner'
      ? requestMessages
      : [
          ...requestMessages,
          // System-level context for continuation (tool results will come from execute functions)
        ];

    const result = await runPhase(
      model,
      phase,
      messages,
      buildTools,
      signal,
      hooks,
      planContext,
    );

    hooks?.onPhaseEnd?.(phase, result);

    // Send each phase's full text via dedicated hook → phase_detail SSE event
    if (result.text) {
      hooks?.onPhaseDetail?.(phase, result.text);
    }

    // Capture plan from planner phase for coder
    if (phase === 'planner' && result.plan) {
      planContext = result.plan;
    }

    // Accumulate results: only include user-facing phase texts in final output.
    // Planner (verbose plan JSON) and Verifier (error logs) are sent via
    // onPhaseDetail for collapsible frontend display — not in the final text.
    // Coder already outputs a concise implementation summary in user's language.
    if (result.text && (phase === 'coder' || phase === 'visual_qa')) {
      if (accumulatedText) {
        accumulatedText += '\n\n';
      }
      accumulatedText += result.text;
    }
    totalUsage.inputTokens += result.usage.inputTokens;
    totalUsage.outputTokens += result.usage.outputTokens;

    // If a phase fails critically, stop the pipeline
    if (result.stoppedReason === 'error' && !result.text.startsWith('⚠️')) {
      break;
    }
  }

  return {
    text: accumulatedText,
    usage: totalUsage,
    phases,
  };
}
