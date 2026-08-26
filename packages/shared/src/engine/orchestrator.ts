/**
 * @deskspawn/browser-engine — Multi-Agent Orchestrator
 *
 * Orchestrates the multi-agent pipeline:
 *   Triage → Planner → Coder → Verifier → Visual QA
 *
 * Ported from sidecar/src/orchestrator.ts for browser execution.
 */

import { generateText, type LanguageModel, type ToolSet } from "ai";
import { StepManager } from "./step-limits";
import { withRateLimitRetry } from "./retry";
import { triageRequest } from "./triage";
import { plannerPrompt } from "./system-prompts/planner";
import { coderPrompt } from "./system-prompts/coder";
import { verifierPrompt } from "./system-prompts/verifier";
import { visualQAPrompt } from "./system-prompts/visual-qa";
import type { Phase, Usage } from "@deskspawn/ai-core";

// ── Timeouts ──────────────────────────────────────────────────────────────────

/** 各 generateText 呼び出しの壁時計タイムアウト (ms) */
const GENERATE_TIMEOUT_MS = 120_000;

/** パイプライン全体の壁時計タイムアウト (ms) — UI の abort controller と併用 */
const PIPELINE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * UI の abort signal と全体タイムアウト信号を合成する。
 * AbortSignal.timeout による強制停止は Stop ボタンと同様に生成中にも効く。
 */
function withPipelineTimeout(signal: AbortSignal): AbortSignal {
  if (signal.aborted) return signal;
  return AbortSignal.any([signal, AbortSignal.timeout(PIPELINE_TIMEOUT_MS)]);
}

// ── Phase Configuration ───────────────────────────────────────────────────────

const PHASE_LABELS: Record<Phase, string> = {
  planner: "Planning & Design",
  coder: "Code Generation",
  verifier: "Error Check & Fix",
  visual_qa: "Visual Review",
};

const PHASE_CONFIGS: Record<Phase, { stepLimit: number; maxContinuations: number }> = {
  planner:   { stepLimit: 8,  maxContinuations: 0 },
  coder:     { stepLimit: 20, maxContinuations: 2 },
  verifier:  { stepLimit: 15, maxContinuations: 0 },
  visual_qa: { stepLimit: 5,  maxContinuations: 0 },
};

const PHASE_TOOLS: Record<Phase, string[]> = {
  planner:   ["read_file", "list_files"],
  coder:     ["read_file", "list_files", "apply_artifact", "get_errors"],
  verifier:  ["read_file", "get_errors", "apply_artifact", "take_screenshot"],
  visual_qa: ["take_screenshot", "read_file"],
};

// ── Types ─────────────────────────────────────────────────────────────────────

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

export interface PipelineHooks {
  onPhaseStart?: (phase: Phase) => void;
  onPhaseEnd?: (phase: Phase, result: PhaseRunResult) => void;
  onPhaseDetail?: (phase: Phase, text: string) => void;
  onToolCall?: (phase: Phase, toolName: string, args: Record<string, unknown>) => void;
  onStepProgress?: (phase: Phase, progress: { step: number; maxSteps: number }) => void;
  onRateLimit?: (phase: Phase, retryCount: number, maxRetries: number, waitMs: number) => void;
  onContinuation?: (phase: Phase, round: number, maxRounds: number) => void;
  onCheckpoint?: (phase: Phase, checkpointId: string) => void;
  onTriageResult?: (result: { mode: "single" | "multi"; reason: string }) => void;
}

export interface PhaseRunResult {
  text: string;
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  usage: Usage;
  stepCount: number;
  hitLimit: boolean;
  stoppedReason: string;
  continuationCount: number;
  plan?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getPhaseLabel(phase: Phase): string {
  return PHASE_LABELS[phase];
}

function getSystemPrompt(phase: Phase, planContext?: string, simpleMode?: boolean, language?: string, isDesktop?: boolean): string {
  switch (phase) {
    case "planner": return plannerPrompt(simpleMode, language);
    case "coder": return coderPrompt(planContext, simpleMode, language, isDesktop);
    case "verifier": return verifierPrompt(simpleMode, language);
    case "visual_qa": return visualQAPrompt(simpleMode, language);
    default: return coderPrompt(planContext, simpleMode, language, isDesktop);
  }
}

function getAllowedTools(phase: Phase): string[] {
  return PHASE_TOOLS[phase];
}

// ── Plan Extraction ───────────────────────────────────────────────────────────

function extractPlan(text: string): Record<string, unknown> | null {
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

  const jsonMatch = text.match(/{[\s\S]*?}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === "object" && "tasks" in parsed) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function formatPlanContext(plan: Record<string, unknown>): string {
  const parts: string[] = [];

  if (plan.summary) parts.push(`Summary: ${plan.summary}`);
  if (plan.architecture) parts.push(`Architecture: ${plan.architecture}`);
  if (plan.dataModel) parts.push(`Data Model: ${plan.dataModel}`);
  if (plan.tasks && Array.isArray(plan.tasks)) {
    parts.push(`\nFiles to create/modify (${plan.tasks.length} tasks):`);
    for (const task of plan.tasks) {
      const taskObj = task as Record<string, unknown>;
      const type = (taskObj.type as string) || "?";
      const filePath = (taskObj.filePath as string) || (taskObj.path as string) || "?";
      const purpose = (taskObj.purpose as string) || (taskObj.description as string) || "";
      parts.push(`  [${type}] ${filePath} — ${purpose}`);
    }
  }

  return parts.join("\n");
}

// ── Phase Runner ──────────────────────────────────────────────────────────────

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

export async function runPhase(
  model: LanguageModel,
  phase: Phase,
  messages: Array<Record<string, unknown>>,
  buildTools: ToolBuilderFn,
  signal: AbortSignal,
  hooks?: PipelineHooks,
  planContext?: string,
  _simpleMode?: boolean,
  language?: string,
  isDesktop?: boolean,
  maxSteps?: number,
): Promise<PhaseRunResult> {
  const systemPrompt = getSystemPrompt(phase, planContext, _simpleMode, language, isDesktop);
  const toolNames = getAllowedTools(phase);
  const tools = buildTools(toolNames);
  const config = PHASE_CONFIGS[phase];

  // AiConfig.maxSteps が設定されていれば動的ステップ管理のベース値として優先する
  const stepManager = new StepManager(maxSteps ?? config.stepLimit, 120, config.maxContinuations);
  const onStepFinish = makeStepCallback(phase, stepManager, hooks);

  let allResultText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const roundMessages = [...messages];

  try {
    do {
      const result = await withRateLimitRetry(
        () => generateText({
          model,
          system: systemPrompt,
          messages: roundMessages as any,
          tools: tools as unknown as ToolSet,
          abortSignal: signal,
          timeout: GENERATE_TIMEOUT_MS,
          stopWhen: (opts) => stepManager.shouldStop(opts),
          temperature: 0.2,
          maxOutputTokens: 16384,
          onStepFinish,
        }),
        hooks
          ? (retryEvent) => {
              hooks.onRateLimit?.(phase, retryEvent.retryCount, retryEvent.maxRetries, retryEvent.waitMs);
            }
          : undefined,
      );

      allResultText += (result.text || "");
      totalInputTokens += result.usage?.inputTokens ?? 0;
      totalOutputTokens += result.usage?.outputTokens ?? 0;

      if (stepManager.canAutoContinue()) {
        stepManager.prepareForContinuation();
        hooks?.onContinuation?.(phase, stepManager.continuationCount, stepManager.maxContinuations);

        roundMessages.push({
          role: "user" as const,
          content:
            "[Auto-continuation] The previous code generation reached the step limit, so the next round has started. Review the current app state and continue with unfinished implementation.",
        });
        continue;
      }
      break;
    } while (true);

    const finalState = stepManager.getFinalState();
    const { hitLimit, stoppedReason } = finalState;

    // If no text was produced but steps were taken, generate a fallback message.
    // This can happen when the model only makes tool calls and never produces text.
    if (!allResultText || allResultText.trim().length === 0) {
      if (hitLimit) {
        const suggestion = stepManager.getSuggestion();
        if (stoppedReason === "loop_detected") {
          allResultText = suggestion
            ? `⚠️ Loop detected, stopping generation. ${suggestion}`
            : `⚠️ Repeated the same actions. Generation stopped. Send "continue" to resume.`;
        } else {
          allResultText = suggestion
            ? `⚠️ Reached max steps (${finalState.step}). ${suggestion}`
            : `⚠️ Reached max steps (${finalState.step}). Send "continue" to resume.`;
        }
      } else {
        allResultText = "⚠️ Response generation failed. Please try again.";
      }
    }

    let plan: string | undefined;
    if (phase === "planner") {
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
      hitLimit,
      stoppedReason,
      continuationCount: stepManager.continuationCount,
      plan,
    };
  } catch (error: any) {
    return {
      text: allResultText || `⚠️ Phase "${phase}" failed: ${error?.message || error}`,
      toolCalls: [],
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      stepCount: 0,
      hitLimit: false,
      stoppedReason: "error",
      continuationCount: 0,
    };
  }
}

// ── Main Pipeline ─────────────────────────────────────────────────────────────

export async function runWithTriage(
  model: LanguageModel,
  requestMessages: Array<Record<string, unknown>>,
  buildTools: ToolBuilderFn,
  signal: AbortSignal,
  _simpleMode?: boolean,
  language?: string,
  hooks?: PipelineHooks,
  isDesktop?: boolean,
  maxSteps?: number,
): Promise<PipelineResult> {
  // 全体タイムアウト（10分）を UI の abort signal と合成してトリアージ以降の全生成に適用する
  const triageSignal = withPipelineTimeout(signal);

  const triageResult = await triageRequest(requestMessages, model, triageSignal);
  hooks?.onTriageResult?.(triageResult);

  // 分岐確定後にフェーズ開始を通知する（トリアージ前に "planner" を発火しない）
  if (triageResult.mode === "single") {
    hooks?.onPhaseStart?.("coder");
    const coderResult = await runPhase(
      model, "coder", requestMessages, buildTools, triageSignal, hooks, undefined, _simpleMode, language, isDesktop, maxSteps,
    );
    return {
      text: coderResult.text,
      usage: coderResult.usage,
      phases: ["coder"],
    };
  }

  return runPipeline(model, requestMessages, buildTools, triageSignal, hooks, _simpleMode, language, isDesktop, maxSteps);
}

const MAX_FIX_ROUNDS = 2;

/**
 * Visual QA の結果テキストを解析し、修正が必要な問題が報告されたかを判定する。
 *
 * プロンプトで ✅ PASS / ⚠️ WARN / ❌ FAIL の形式を指示しているため、
 * 主に記号マーカーと明示的な否定語で判定する。
 * "error" 単体は「no errors」「errors resolved」等での false positive を避けるため除外。
 */
function visualQaReportsIssues(text: string): boolean {
  // ✅ PASS なら即座に通過
  if (/✅\s*PASS/i.test(text)) return false;

  // ❌ FAIL および重大エラーのみ fix round を発動する（⚠️ WARN は発動しない）
  const negativeMarkers = [
    "❌ FAIL",                  // 明示的な失敗
    "❌ Critical errors",       // 明示的重大エラー
    "❌",                       // ❌ 単体も FAIL 扱い
    "critical error",           // 重大エラー
    "blank page",               // 白画面
    "white screen",             // 白画面
    "nothing displayed",        // 何も表示されていない
    "empty page",               // 空ページ
    "真っ白",                   // 日本語: 真っ白
    "何も表示",                 // 日本語: 何も表示されない
    "no visible",               // 表示要素がない
  ];
  const lower = text.toLowerCase();
  return negativeMarkers.some(marker => lower.includes(marker.toLowerCase()));
}

export async function runPipeline(
  model: LanguageModel,
  requestMessages: Array<Record<string, unknown>>,
  buildTools: ToolBuilderFn,
  signal: AbortSignal,
  hooks?: PipelineHooks,
  _simpleMode?: boolean,
  language?: string,
  isDesktop?: boolean,
  maxSteps?: number,
): Promise<PipelineResult> {
  // runWithTriage から直接呼ばれる場合も含め、パイプライン全体にタイムアウトを適用する
  const phaseSignal = withPipelineTimeout(signal);

  // phaseQueue を使って動的に修正ラウンドを追加できるようにする
  const phaseQueue: Phase[] = ["planner", "coder", "verifier", "visual_qa"];
  let planContext: string | undefined;
  let accumulatedText = "";
  const totalUsage: Usage = { inputTokens: 0, outputTokens: 0 };
  let fixRound = 0;
  let visualQaFeedback: string | null = null;
  const executedPhases: Phase[] = [];

  while (phaseQueue.length > 0) {
    const phase = phaseQueue.shift()!;
    executedPhases.push(phase);
    hooks?.onPhaseStart?.(phase);

    // 各フェーズのメッセージ構築
    let messages: Array<Record<string, unknown>>;
    if (phase === "planner") {
      messages = requestMessages;
    } else {
      messages = [...requestMessages];
      // 修正ラウンド用: Visual QA のフィードバックを追加
      if (visualQaFeedback && (phase === "coder" || phase === "verifier")) {
        messages.push({
          role: "user" as const,
          content: `[Fix Round ${fixRound}/${MAX_FIX_ROUNDS}]\nThe previous verification found these issues that need to be fixed:\n\n${visualQaFeedback}\n\nPlease fix the issues described above.`,
        });
      }
    }

    const result = await runPhase(
      model,
      phase,
      messages,
      buildTools,
      phaseSignal,
      hooks,
      planContext,
      _simpleMode,
      language,
      isDesktop,
      maxSteps,
    );

    hooks?.onPhaseEnd?.(phase, result);

    if (result.text) {
      hooks?.onPhaseDetail?.(phase, result.text);
    }

    if (phase === "planner" && result.plan) {
      planContext = result.plan;
    }

    if (result.text && (phase === "coder" || phase === "visual_qa")) {
      accumulatedText += accumulatedText ? "\n\n" : "";
      accumulatedText += result.text;
    }
    totalUsage.inputTokens += result.usage.inputTokens;
    totalUsage.outputTokens += result.usage.outputTokens;

    // ── Visual QA 終了後の処理 ──────────────────────────────────────────────
    // 問題があれば coder → verifier → visual_qa の fix round
    if (phase === "visual_qa" && result.text) {
      if (visualQaReportsIssues(result.text)) {
        visualQaFeedback = result.text;
        if (fixRound < MAX_FIX_ROUNDS) {
          fixRound++;
          console.log(`[pipeline] Visual QA reports issues — starting fix round ${fixRound}/${MAX_FIX_ROUNDS}`);
          phaseQueue.unshift("visual_qa");
          phaseQueue.unshift("verifier");
          phaseQueue.unshift("coder");
        } else {
          visualQaFeedback = null;
        }
      } else {
        visualQaFeedback = null;
      }
    }

    // 致命的エラーで中断
    if (result.stoppedReason === "error" && !result.text.startsWith("⚠️")) {
      break;
    }
  }

  return {
    text: accumulatedText,
    usage: totalUsage,
    phases: executedPhases,
  };
}
