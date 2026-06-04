/**
 * useChatSSE — AIチャットのSSEストリーミング管理フック
 *
 * ChatPanel から SSE 通信ロジックとストリーミング状態を分離。
 * - サイドカーとの HTTP SSE 接続
 * - ツール呼び出しログ・フェーズ詳細のリアルタイム追跡
 * - レートリミット・継続ラウンド情報の管理
 * - 停止・破棄のライフサイクル
 */
import { useState, useCallback, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import type { ChatMessage as ChatMessageType, AiConfig, StepLogEntry } from "@/types";
import { sidecarBase, providerLabels, sidecarChatUrl } from "@/lib/constants";
import i18n from "@/lib/i18n";
import { calculateCost } from "@/lib/cost";

// ─── SSE Message Types ──────────────────────────────────────────────────────────

interface SSEMessage {
  type: "tool_call" | "tool_result" | "text" | "error" | "done" | "step_progress" | "checkpoint" | "continuation" | "rate_limit" | "triage_start" | "triage_result" | "phase_detail";
  id?: string;
  step?: number;
  maxSteps?: number;
  continuationRound?: number;
  maxContinuations?: number;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: string;
  detail?: Record<string, unknown>;
  text?: string;
  error?: string;
  errorCode?: string;
  usage?: { inputTokens: number; outputTokens: number };
  steps?: number;
  round?: number;
  maxRounds?: number;
  retryCount?: number;
  maxRetries?: number;
  waitMs?: number;
  mode?: "single" | "multi";
  reason?: string;
  label?: string;
  phase?: string;
}

// ─── Return Type ─────────────────────────────────────────────────────────────────

export interface UseChatSSEReturn {
  liveStepLogs: StepLogEntry[];
  phaseOutputs: Record<string, { label: string; text: string }>;
  continuationRound: number;
  maxContinuations: number;
  rateLimitInfo: { retryCount: number; maxRetries: number; waitMs: number } | null;
  /** Start generation — sends history to sidecar via SSE and processes stream */
  startGeneration: (history: ChatMessageType[], onComplete?: () => void) => Promise<void>;
  /** Stop generation */
  handleStop: () => void;
}

// ─── タスク複雑度推定 ─────────────────────────────────────────────────────────

/**
 * メッセージ履歴からタスク複雑度を推定し、適切な初期最大ステップ数を返す。
 * - バグ修正・小規模変更 → 20 steps
 * - 機能追加（中程度） → 30 steps
 * - 新規作成・大規模タスク → 50 steps
 */
function estimateTaskComplexity(messages: ChatMessageType[]): number {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) return 20;

  const text = lastUserMsg.content;
  const length = text.length;
  const lower = text.toLowerCase();

  const complexPatterns = [
    "create", "new app", "新規", "作って", "フル", "full", "complete",
    "アプリにして", "アプリ作成", "一から", "from scratch",
    "dashboard", "ダッシュボード", "管理画面", "全て",
    "全部", "一括", "全体", "フルスタック",
  ];
  const simplePatterns = [
    "fix", "bug", "直し", "バグ", "修正", "typo",
    "微小", "少し", "ちょっと", "だけ", "のみ",
    "色を変え", "文字を変え",
  ];

  const isComplex = complexPatterns.some((p) => lower.includes(p));
  const isSimple = simplePatterns.some((p) => lower.includes(p)) && length < 200;

  if (isComplex || length > 500) return 50;
  if (length > 300) return 50;
  if (length > 150 && !isSimple) return 30;
  if (isSimple) return 20;
  return 20;
}

// ─── SSE ストリーミング実行 ──────────────────────────────────────────────────

/**
 * Sidecar にメッセージ履歴を送信し、SSE ストリームを処理する。
 * @returns true なら AI がテキスト応答を生成した、false なら空
 */
async function callSidecar(
  messages: ChatMessageType[],
  addMessage: (msg: ChatMessageType) => void,
  setStep: (step: number) => void,
  setMaxSteps: (maxSteps: number) => void,
  setLiveStepLogs: (logs: StepLogEntry[]) => void,
  setWorkspaceReady: (ready: boolean) => void,
  config: AiConfig | null,
  abortRef: React.MutableRefObject<AbortController | null>,
  estimatedMaxSteps?: number,
  simpleMode?: boolean,
  language?: string,
  setContinuationRound?: (round: number) => void,
  setMaxContinuations?: (max: number) => void,
  setRateLimitInfo?: (info: { retryCount: number; maxRetries: number; waitMs: number } | null) => void,
  setPhaseOutputs?: (outputs: Record<string, { label: string; text: string }>) => void,
): Promise<boolean> {
  const provider = config?.provider ?? "ollama";
  const model = config?.model ?? "";
  const apiKey = config?.apiKey ?? "";
  const customEndpoint = config?.customEndpoint;
  const temperature = config?.temperature ?? 0.2;
  const maxTokens = config?.maxTokens ?? 16384;

  const abortController = new AbortController();
  abortRef.current = abortController;

  const response = await fetch(sidecarChatUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: abortController.signal,
    body: JSON.stringify({
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      simpleMode: simpleMode ?? true,
      language,
      config: {
        provider, model, apiKey, customEndpoint, temperature, maxTokens,
        maxSteps: estimatedMaxSteps ?? 20,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Sidecar responded with ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let lastCheckpointId: string | undefined;
  let currentStep = 0;
  let maxSteps = 10;
  let sawError = false;
  let lastUsage: { inputTokens: number; outputTokens: number } | undefined;

  // 構造化ステップログ追跡
  const stepLogs: StepLogEntry[] = [];
  const pendingResults: Array<{ toolName: string; result: string; detail?: Record<string, unknown> }> = [];

  // フェーズ詳細出力追跡
  const localPhaseOutputs: Record<string, { label: string; text: string }> = {};

  const flushStepLogs = () => {
    setLiveStepLogs([...stepLogs]);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6);
      try {
        const msg: SSEMessage = JSON.parse(jsonStr);

        if (msg.type === "triage_start" || msg.type === "triage_result") {
          // トリアージ情報 — フロントエンド表示には使わない
        } else if (msg.type === "checkpoint") {
          lastCheckpointId = msg.id as string;
        } else if (msg.type === "rate_limit") {
          if (setRateLimitInfo) {
            setRateLimitInfo({
              retryCount: msg.retryCount ?? 0,
              maxRetries: msg.maxRetries ?? 3,
              waitMs: msg.waitMs ?? 1000,
            });
          }
        } else if (msg.type === "continuation") {
          const round = msg.round ?? 0;
          const maxRounds = msg.maxRounds ?? 0;
          if (setContinuationRound) setContinuationRound(round);
          if (setMaxContinuations) setMaxContinuations(maxRounds);
        } else if (msg.type === "step_progress") {
          currentStep = msg.step ?? currentStep;
          const backendMaxSteps = msg.maxSteps;
          if (backendMaxSteps !== undefined) {
            maxSteps = backendMaxSteps;
          } else if (currentStep > maxSteps) {
            maxSteps = currentStep;
          }
          setStep(currentStep);
          setMaxSteps(maxSteps);
          if (msg.continuationRound !== undefined && setContinuationRound) {
            setContinuationRound(msg.continuationRound);
          }
          if (msg.maxContinuations !== undefined && setMaxContinuations) {
            setMaxContinuations(msg.maxContinuations);
          }
        } else if (msg.type === "tool_call") {
          const matchIdx = pendingResults.findIndex((r) => r.toolName === msg.toolName);
          const matched = matchIdx >= 0 ? pendingResults.splice(matchIdx, 1)[0] : undefined;

          const step = msg.step ?? currentStep;
          const entry: StepLogEntry = {
            step,
            toolName: msg.toolName ?? "unknown",
            args: (msg.args ?? {}) as Record<string, unknown>,
            result: matched?.result,
            detail: matched?.detail,
            status: matched ? "success" : "running",
          };
          stepLogs.push(entry);
          flushStepLogs();

          if (msg.step) setStep(msg.step);
        } else if (msg.type === "tool_result") {
          const openEntry = stepLogs.find(
            (e) => e.toolName === msg.toolName && e.status === "running" && !e.result,
          );
          if (openEntry) {
            openEntry.result = msg.result;
            openEntry.detail = msg.detail;
            openEntry.status = "success";
            flushStepLogs();
          } else {
            pendingResults.push({
              toolName: msg.toolName ?? "unknown",
              result: msg.result ?? "",
              detail: msg.detail,
            });
          }
        } else if (msg.type === "text") {
          fullText = msg.text ?? "";
          if (msg.usage) lastUsage = msg.usage;
          if (setRateLimitInfo) setRateLimitInfo(null);
        } else if (msg.type === "phase_detail") {
          const phase = msg.phase;
          const text = msg.text;
          const label = msg.label;
          if (phase && text) {
            const entry = { label: label || phase, text };
            localPhaseOutputs[phase] = entry;
            if (setPhaseOutputs) setPhaseOutputs({ ...localPhaseOutputs });
          }
        } else if (msg.type === "error") {
          if (!abortRef.current) continue;
          sawError = true;
          if (setRateLimitInfo) setRateLimitInfo(null);
          const err = new Error(msg.error);
          (err as any).errorCode = msg.errorCode;
          throw err;
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  abortRef.current = null;
  if (setRateLimitInfo) setRateLimitInfo(null);

  // ストリーム終了後、未完了の tool_call を error に
  let hasStaleRunning = false;
  for (const entry of stepLogs) {
    if (entry.status === "running") {
      entry.status = "error";
      entry.result = entry.result || i18n.t('chat.streamEndedWithoutResult');
      hasStaleRunning = true;
    }
  }
  if (hasStaleRunning) flushStepLogs();

  const phaseOutputsArray = Object.keys(localPhaseOutputs).length > 0
    ? Object.entries(localPhaseOutputs).map(([phase, { label, text }]) => ({ phase, label, text }))
    : undefined;

  if (fullText) {
    const cfg = useAppStore.getState().aiConfig;

    // Compute usage object — embed directly in the message for persistence
    let usage: import("@/types").TokenUsage | undefined;
    if (lastUsage && cfg) {
      const cost = calculateCost({
        inputTokens: lastUsage.inputTokens,
        outputTokens: lastUsage.outputTokens,
        model: cfg.model || undefined,
      });
      usage = {
        inputTokens: lastUsage.inputTokens,
        outputTokens: lastUsage.outputTokens,
        timestamp: new Date().toISOString(),
        provider: cfg.provider,
        model: cfg.model || undefined,
        estimatedCost: cost,
      };
    }

    addMessage({
      id: `msg-bot-${Date.now()}`,
      role: "assistant",
      content: fullText,
      timestamp: Date.now(),
      checkpointId: lastCheckpointId,
      stepLogs,
      phaseOutputs: phaseOutputsArray,
      usage,
    });
    setLiveStepLogs([]);
    setWorkspaceReady(true);
    return true;
  }

  setLiveStepLogs([]);

  if (sawError) {
    return false;
  }

  console.warn("[chat] Sidecar returned empty text — no output produced");
  return false;
}

// ─── フック本体 ─────────────────────────────────────────────────────────────────

export function useChatSSE(): UseChatSSEReturn {
  const [liveStepLogs, setLiveStepLogs] = useState<StepLogEntry[]>([]);
  const [phaseOutputs, setPhaseOutputs] = useState<Record<string, { label: string; text: string }>>({});
  const [continuationRound, setContinuationRound] = useState(0);
  const [maxContinuations, setMaxContinuations] = useState(0);
  const [rateLimitInfo, setRateLimitInfo] = useState<{ retryCount: number; maxRetries: number; waitMs: number } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    useAppStore.getState().setAgentStatus("idle");
    setLiveStepLogs([]);
  }, []);

  const startGeneration = useCallback(
    async (history: ChatMessageType[], onComplete?: () => void) => {
      const state = useAppStore.getState();
      const { aiConfig: cfg, currentProjectId: pid, addMessage, setAgentStatus, setAgentStepCount, setWorkspaceReady } = state;

      if (!cfg) {
        addMessage({
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: i18n.t('chat.error.aiNotConfiguredDetailed', { notConfiguredLabel: i18n.t('ai.notConfiguredShort') }),
          timestamp: Date.now(),
        });
        onComplete?.();
        return;
      }

      if (!pid) {
        addMessage({
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: i18n.t('chat.error.noProjectSelected', { newAppLabel: i18n.t('project.newApp') }),
          timestamp: Date.now(),
        });
        onComplete?.();
        return;
      }

      if (cfg.provider !== "ollama" && !cfg.apiKey && !cfg.apiKeyConfigured) {
        addMessage({
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: i18n.t('chat.error.apiKeyRequiredDetailed', {
          provider: providerLabels[cfg.provider] || cfg.provider,
          modelLabel: cfg.model || i18n.t('ai.notConfiguredShort'),
        }),
          timestamp: Date.now(),
        });
        onComplete?.();
        return;
      }

      const estimatedMaxSteps = estimateTaskComplexity(history);
      const { setAgentMaxSteps } = useAppStore.getState();
      setAgentStatus("running");
      setAgentStepCount(0);
      setAgentMaxSteps(estimatedMaxSteps);
      setLiveStepLogs([]);
      setPhaseOutputs({});
      setContinuationRound(0);
      setMaxContinuations(0);
      setRateLimitInfo(null);

      const { settings } = useAppStore.getState();
      const simpleMode = settings.simpleMode;
      const language = settings.language;

      try {
        const producedOutput = await callSidecar(
          history, addMessage, setAgentStepCount, setAgentMaxSteps, setLiveStepLogs,
          setWorkspaceReady, cfg, abortControllerRef, estimatedMaxSteps, simpleMode, language,
          setContinuationRound, setMaxContinuations, setRateLimitInfo, setPhaseOutputs,
        );

        if (!producedOutput) {
          setAgentStatus("error");
          setWorkspaceReady(true);
          addMessage({
            id: `msg-err-${Date.now()}`,
            role: "assistant",
            content: i18n.t('chat.error.emptyResponse', {
              provider: cfg.provider,
              model: cfg.model || i18n.t('common.notSelected'),
            }),
            timestamp: Date.now(),
          });
          onComplete?.();
          return;
        }

        setAgentStatus("complete");

        // Show toast notification on completion
        const { addToast: showToast, messages: msgs } = useAppStore.getState();
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        const hasArtifacts = lastMsg?.stepLogs?.some((s: any) => s.toolName === "apply_artifact") ?? false;
        const totalCost = msgs.reduce((sum: number, m: any) => sum + (m.usage?.estimatedCost ?? 0), 0);
        showToast({
          message: i18n.t('chat.generationComplete', {
            sparkle: hasArtifacts ? " ✨" : "",
            cost: totalCost > 0 ? ` ($${totalCost.toFixed(4)})` : "",
          }),
          variant: "success",
          duration: 4000,
        });

        const { setWorkspacePort, workspacePort, fetchCheckpoints, setCurrentCheckpointIndex, triggerReload } = useAppStore.getState();

        fetch(`${sidecarBase()}/projects/ready`)
          .then(r => r.json())
          .then(data => {
            if (typeof data.port === 'number' && data.port !== workspacePort) {
              setWorkspacePort(data.port);
            }
          })
          .catch(() => {});

        await fetchCheckpoints();
        setCurrentCheckpointIndex(useAppStore.getState().checkpoints.length - 1);
        triggerReload();
      } catch (e: any) {
        if (e?.name === "AbortError") {
          console.log("[chat] Generation cancelled by user");
          setWorkspaceReady(true);
          onComplete?.();
          return;
        }
        console.error("Sidecar error:", e);
        const errMsg = String(e);
        const errorCode = e?.errorCode as string | undefined;

        if (errorCode && ['RATE_LIMIT', 'GENERATION_FAILED', 'PROJECT_DELETE_ACTIVE'].includes(errorCode)) {
          addMessage({
            id: `msg-err-${Date.now()}`,
            role: "assistant",
            content: i18n.t(`sidecarError.${errorCode}`, { error: errMsg ? ` ${errMsg}` : '' }),
            timestamp: Date.now(),
          });
        } else {
          const hint = errMsg.includes("API key") || errMsg.includes("401")
            ? i18n.t('chat.error.invalidApiKey')
            : errMsg.includes("fetch") || errMsg.includes("Load failed") || errMsg.includes("NetworkError")
              ? i18n.t('chat.error.sidecarConnectionFailed')
              : i18n.t('chat.error.sidecarConnectionHint');
          addMessage({
            id: `msg-err-${Date.now()}`,
            role: "assistant",
            content: i18n.t('chat.error.generic', { errMsg, hint }),
            timestamp: Date.now(),
          });
        }
        setAgentStatus("error");
        setWorkspaceReady(true);
      }

      onComplete?.();
    },
    [],
  );

  return {
    liveStepLogs,
    phaseOutputs,
    continuationRound,
    maxContinuations,
    rateLimitInfo,
    startGeneration,
    handleStop,
  };
}
