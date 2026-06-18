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
import { plannerPrompt } from "./system-prompts/planner";
import { coderPrompt } from "./system-prompts/coder";
import { verifierPrompt } from "./system-prompts/verifier";
import { visualQAPrompt } from "./system-prompts/visual-qa";
import type { Phase, Usage } from "./types";

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
  planner:   ["read_file", "list_files", "searchGitHub"],
  coder:     ["read_file", "list_files", "apply_artifact", "get_errors", "searchGitHub"],
  verifier:  ["read_file", "get_errors", "apply_artifact"],
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

function getSystemPrompt(phase: Phase, planContext?: string, simpleMode?: boolean, language?: string): string {
  switch (phase) {
    case "planner": return plannerPrompt(simpleMode, language);
    case "coder": return coderPrompt(planContext, simpleMode, language);
    case "verifier": return verifierPrompt(simpleMode, language);
    case "visual_qa": return visualQAPrompt(simpleMode, language);
    default: return coderPrompt(planContext, simpleMode, language);
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
): Promise<PhaseRunResult> {
  const systemPrompt = getSystemPrompt(phase, planContext, _simpleMode, language);
  const toolNames = getAllowedTools(phase);
  const tools = buildTools(toolNames);
  const config = PHASE_CONFIGS[phase];

  const stepManager = new StepManager(config.stepLimit, 120, config.maxContinuations);
  const onStepFinish = makeStepCallback(phase, stepManager, hooks);

  let allResultText = "";
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
            "[Auto-continuation] The previous code generation reached the step limit, so the next round has started. Review the current project state and continue with unfinished implementation.",
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

// ── Triage ────────────────────────────────────────────────────────────────────

/**
 * 軽量トリアージでリクエストの複雑さを分類する。
 * "single" → Coderのみ / "multi" → フルパイプライン
 */
async function triageRequest(
  requestMessages: Array<Record<string, unknown>>,
  model: LanguageModel,
): Promise<{ mode: "single" | "multi"; reason: string }> {
  const triageSystemPrompt = `You are a request classifier. Analyze the user's request and determine if it needs a simple single-step code change or a complex multi-step implementation.

Respond with one of:
- "single" + reason: For simple changes (fix one file, add one component, minor style change, single feature addition)
- "multi" + reason: For complex requests (multi-file changes, new features with planning, new project creation, refactoring)

Only respond with "mode: single" or "mode: multi" followed by a brief reason.`;

  try {
    const result = await generateText({
      model,
      system: triageSystemPrompt,
      messages: requestMessages as any,
      temperature: 0,
      maxOutputTokens: 200,
    });

    const text = result.text || "";
    if (text.toLowerCase().includes("mode: multi") || text.toLowerCase().includes("single")) {
      const isMulti = text.toLowerCase().includes("mode: multi") || text.toLowerCase().includes("multi");
      return {
        mode: isMulti ? "multi" : "single",
        reason: text.split("\n").slice(1).join(" ").trim() || "Classified by triage",
      };
    }
    // Default: multi for safety
    return { mode: "multi", reason: "Default to multi-agent for completeness" };
  } catch {
    return { mode: "multi", reason: "Fallback: triage failed" };
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
): Promise<PipelineResult> {
  hooks?.onPhaseStart?.("planner");

  const triageResult = await triageRequest(requestMessages, model);
  hooks?.onTriageResult?.(triageResult);

  if (triageResult.mode === "single") {
    const coderResult = await runPhase(
      model, "coder", requestMessages, buildTools, signal, hooks, undefined, _simpleMode, language,
    );
    return {
      text: coderResult.text,
      usage: coderResult.usage,
      phases: ["coder"],
    };
  }

  return runPipeline(model, requestMessages, buildTools, signal, hooks, _simpleMode, language);
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
  // まず ✅ PASS なら即座に通過
  if (/✅\s*PASS/i.test(text)) return false;

  // 否定マーカーで判定
  const negativeMarkers = [
    "❌", "⚠️",                // 記号マーカー
    "❌ FAIL", "⚠️ WARN",      // 明示的な失敗/警告ラベル
    "critical error",           // 重大エラー
    "❌ Critical errors",       // 明示的
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
): Promise<PipelineResult> {
  // phaseQueue を使って動的に修正ラウンドを追加できるようにする
  const phaseQueue: Phase[] = ["planner", "coder", "verifier", "visual_qa"];
  let planContext: string | undefined;
  let accumulatedText = "";
  let totalUsage: Usage = { inputTokens: 0, outputTokens: 0 };
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
          content: `[Fix Round ${fixRound}/${MAX_FIX_ROUNDS}]\nThe previous visual review found these issues that need to be fixed:\n\n${visualQaFeedback}\n\nPlease fix the issues described above.`,
        });
      }
    }

    const result = await runPhase(
      model,
      phase,
      messages,
      buildTools,
      signal,
      hooks,
      planContext,
      _simpleMode,
      language,
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

    // Visual QA 終了後、問題が検出されたら修正ラウンドをキューに追加
    if (phase === "visual_qa" && result.text) {
      visualQaFeedback = result.text;
      if (visualQaReportsIssues(result.text) && fixRound < MAX_FIX_ROUNDS) {
        fixRound++;
        console.log(`[pipeline] Visual QA reports issues — starting fix round ${fixRound}/${MAX_FIX_ROUNDS}`);
        // 次のフェーズとして coder → verifier → visual_qa を先頭に挿入
        phaseQueue.unshift("visual_qa");
        phaseQueue.unshift("verifier");
        phaseQueue.unshift("coder");
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
