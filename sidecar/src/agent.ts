/**
 * AI Agent — IPC モード（stdin/stdout JSON Lines プロトコル）
 *
 * Rust Tauri バックエンドからの IPC メッセージを処理するエージェント。
 * マルチエージェント位相パイプラインに対応:
 * - デフォルトでは coder フェーズ（従来の単一エージェントと互換）
 * - ChatRequest の phase フィールドでフェーズを指定可能
 * - フェーズごとに異なるシステムプロンプトと制限されたツールセットを使用
 *
 * ツール実行は Rust 側で行われ、結果は次の IPC メッセージで返される。
 */
import { generateText, type LanguageModel, type ToolSet } from 'ai';
import { getModel } from './providers.js';
import { tools } from './tools.js';
import { buildSystemPrompt } from './system-prompt.js';
import { StepManager } from './step-limits.js';
import { withRateLimitRetry } from './retry.js';
import { getSystemPrompt, getAllowedTools } from './orchestrator.js';
import { triageRequest } from './triage.js';
import type {
  ChatRequest,
  ChatMessage,
  ToolCallResponse,
  TextResponse,
  ErrorResponse,
  Phase,
} from './types.js';

/**
 * Normalise an IPC-protocol message into the shape the AI SDK expects.
 *
 * IPC uses `tool_calls` (plural, snake_case) on assistant messages and
 * `tool_call_id` on tool-result messages. The AI SDK uses `toolCalls`
 * and `toolCallId` respectively.
 */
function toCoreMessage(msg: ChatMessage): Record<string, unknown> {
  switch (msg.role) {
    case 'system':
      return { role: 'system', content: msg.content };
    case 'user':
      return { role: 'user', content: msg.content };
    case 'tool':
      return {
        role: 'tool',
        content: [{ type: 'tool-result' as const, toolCallId: msg.tool_call_id ?? '', result: msg.content }],
      };
    case 'assistant': {
      const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
        type: 'tool-call' as const,
        toolCallId: tc.id ?? '',
        toolName: tc.function.name,
        args: JSON.parse(tc.function.arguments),
      }));
      return {
        role: 'assistant',
        content: msg.content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    }
    default:
      return { role: 'user', content: msg.content };
  }
}

/**
 * Build a filtered tool set for the given phase.
 * IPC mode uses bare tool definitions (no execute functions)
 * — tool execution happens on the Rust side.
 */
function buildPhaseTools(phase: Phase): ToolSet {
  const allowedNames = getAllowedTools(phase);
  const phaseTools: Record<string, unknown> = {};
  for (const name of allowedNames) {
    if (name in tools) {
      phaseTools[name] = tools[name as keyof typeof tools];
    }
  }
  return phaseTools as unknown as ToolSet;
}

/**
 * Format a summary of the plan context to inject into the system prompt.
 * The plan is included in the conversation context when transitioning
 * from planner to coder phase.
 */
function formatPlanForIPC(planText: string): string {
  try {
    const plan = JSON.parse(planText);
    const summary = plan.summary || '';
    const tasks = Array.isArray(plan.tasks) ? plan.tasks.length : 0;
    return `[Architect Plan] ${summary} (${tasks} tasks). See chat history for details.`;
  } catch {
    return planText.substring(0, 200);
  }
}

/**
 * Handle an incoming chat request.
 *
 * Supports multi-agent phases via the optional `phase` field:
 *   - planner:   Read project, analyze request, create plan
 *   - coder:     Implement code (default, backward-compatible)
 *   - verifier:  Detect and fix TypeScript errors
 *   - visual_qa: Take screenshots, verify UI
 *
 * 1. Resolve the language model from the config.
 * 2. Determine the phase (default: coder).
 * 3. Build phase-specific system prompt and filtered tools.
 * 4. Call the AI SDK's `generateText`.
 * 5. Forward tool calls to Rust via the `send` callback in `onStepFinish`.
 * 6. Emit the final text response (or error).
 */
export async function handleChat(
  request: ChatRequest,
  send: (
    response: TextResponse | ToolCallResponse | ErrorResponse
  ) => void
): Promise<void> {
  let model: LanguageModel;

  try {
    model = getModel(request.config);
  } catch (err) {
    send({
      type: 'error',
      id: request.id,
      error: `Failed to initialise model: ${String(err)}`,
    });
    return;
  }

  // Determine execution mode:
  //   - If Rust sends explicit `phase`: use it (backward compat)
  //   - If Rust sends `mode`: use it (triage on Rust side)
  //   - Otherwise: run lightweight triage to decide
  const explicitPhase = (request as any).phase as string | undefined;
  const explicitMode = (request as any).mode as string | undefined;
  const planContext: string | undefined = (request as any).planContext;

  let phase: Phase;
  if (explicitPhase) {
    phase = explicitPhase as Phase;
  } else if (explicitMode) {
    phase = explicitMode === 'multi' ? 'planner' : 'coder';
  } else {
    // No explicit direction — run lightweight triage
    try {
      const lastMessages = (request.messages ?? []).map(toCoreMessage);
      const triageResult = await triageRequest(lastMessages, model);
      console.log(`[triage] IPC mode=${triageResult.mode} reason="${triageResult.reason}"`);

      if (triageResult.mode === 'multi') {
        phase = 'planner'; // start with planner; subsequent messages continue the pipeline
      } else {
        phase = 'coder';
      }
    } catch {
      // Triage failed — fall back to single-agent (backward compatible)
      phase = 'coder';
    }
  }

  // Build phase-specific system prompt
  let systemPrompt: string;
  if (phase === 'coder' && planContext) {
    // Inject plan context for coder phase
    systemPrompt = getSystemPrompt('coder', formatPlanForIPC(planContext));
  } else {
    // For non-coder phases or when no plan is available,
    // use the backward-compatible buildSystemPrompt (same as coder prompt)
    systemPrompt = phase === 'coder'
      ? buildSystemPrompt()
      : getSystemPrompt(phase);
  }

  const phaseTools = buildPhaseTools(phase);
  const conversationMessages = (request.messages ?? []).map(toCoreMessage);

  try {
    const stepManager = new StepManager(request.maxSteps ?? 15);
    const result = await withRateLimitRetry(
      () => generateText({
        model,
        system: systemPrompt,
        messages: conversationMessages as any,
        tools: phaseTools,
        stopWhen: (opts) => stepManager.shouldStop(opts),
        temperature: request.config.temperature ?? 0.2,
        maxOutputTokens: request.config.maxTokens ?? 16384,
        onStepFinish: (event: any) => {
          const toolCalls = event.toolCalls || [];
          stepManager.recordStep(
            toolCalls.map((tc: any) => ({
              toolName: tc.toolName,
              args: (tc.args ?? tc.input ?? {}) as Record<string, unknown>,
            })),
          );

          if (toolCalls.length > 0) {
            for (const call of toolCalls) {
              const rawArgs = (call.input ?? call.args ?? {}) as Record<string, unknown>;
              // apply_artifact now passes structured {id, title, actions} instead of
              // {json: "..."}. Convert to the format Rust's harness.rs expects.
              const args = call.toolName === 'apply_artifact'
                ? { json: JSON.stringify({ name: rawArgs.id, description: rawArgs.title, actions: rawArgs.actions }) }
                : rawArgs;
              send({
                type: 'tool_call',
                id: request.id,
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                args,
              });
            }
          }
        },
      }),
    );

    // Determine stop reason
    const finalState = stepManager.getFinalState();
    const { step: _stepCount, maxSteps: effectiveMaxSteps, hitLimit, stoppedReason } = finalState;

    let finalText = result.text;
    if (!finalText || finalText.trim().length === 0) {
      const suggestion = stepManager.getSuggestion();

      if (hitLimit) {
        if (stoppedReason === 'loop_detected') {
          finalText = suggestion
            ? `⚠️ 処理がループしているため終了しました。${suggestion}`
            : `⚠️ 同じ処理を繰り返していると判断されたため、生成を終了しました。「続けて」と送信することで続きの生成を試みます。`;
        } else {
          finalText = suggestion
            ? `⚠️ 最大ステップ数（${effectiveMaxSteps}）に達しました。${suggestion}`
            : `⚠️ 最大ステップ数（${effectiveMaxSteps}）に達したため、生成を終了しました。「続けて」と送信することで続きの生成を試みます。`;
        }
      } else {
        finalText = '⚠️ 応答の生成に失敗しました。もう一度お試しください。';
      }
    }

    send({
      type: 'text',
      id: request.id,
      text: finalText,
      usage: {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      },
    });
  } catch (error) {
    send({
      type: 'error',
      id: request.id,
      error: `Generation failed: ${String(error)}`,
    });
  }
}
