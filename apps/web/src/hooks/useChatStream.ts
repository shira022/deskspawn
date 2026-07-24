/**
 * useChatStream — Direct AI streaming hook (browser-native)
 *
 * Replaces the old SSE-based useChatSSE hook. Instead of calling a sidecar
 * HTTP server, it uses the Vercel AI SDK directly in the browser to
 * call AI provider APIs.
 */

import { useState, useCallback, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import type { ChatMessage, StepLogEntry, TokenUsage } from "@/types";
import { providerLabels } from "@/lib/constants";
import { getModel } from "@/engine/providers";
import { runWithTriage } from "@/engine/orchestrator";
import { tools } from "@/engine/tools";
import {
  readFile,
  listFiles,
  applyArtifact,
  getErrors,
  takeScreenshot,
  createCheckpoint,
} from "@/engine/tool-executors";
import { getMCPTools } from "@/engine/mcp-client";
import { loadApiKey } from "@/lib/storage";
import i18n from "@/lib/i18n";
import { calculateCost } from "@/lib/cost";
import { initMCPClients } from "@/engine/mcp-client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseChatStreamReturn {
  liveStepLogs: StepLogEntry[];
  phaseOutputs: Record<string, { label: string; text: string }>;
  continuationRound: number;
  maxContinuations: number;
  rateLimitInfo: { retryCount: number; maxRetries: number; waitMs: number } | null;
  startGeneration: (history: ChatMessage[], onComplete?: () => void) => Promise<void>;
  handleStop: () => void;
}

// ── Provider Config Helpers ────────────────────────────────────────────────────

/**
 * Check for provider-specific missing configuration before calling getModel().
 * Returns a localized detail message, or null if config looks complete.
 */
function getProviderConfigIssue(cfg: NonNullable<ReturnType<typeof useAppStore.getState>['aiConfig']>, providerLabel: string): string | null {
  switch (cfg.provider) {
    case 'custom':
      if (!cfg.customEndpoint) {
        return i18n.t('chat.error.customEndpointRequired', { provider: providerLabel });
      }
      break;
    case 'amazon-bedrock':
      if (!cfg.region) {
        return i18n.t('chat.error.regionRequired', { provider: providerLabel });
      }
      break;
    case 'azure-openai':
      if (!cfg.customEndpoint) {
        return i18n.t('chat.error.customEndpointRequired', { provider: providerLabel });
      }
      break;
    case 'ollama':
      if (!cfg.model) {
        return i18n.t('chat.error.ollamaModelRequired', { provider: providerLabel, example: 'llama3.2' });
      }
      break;
  }
  return null;
}

/**
 * Return a provider- and error-specific localized hint string for the generic
 * error message shown to the user.
 */
function getErrorHint(provider: string | undefined, cfg: { model?: string; customEndpoint?: string } | null, error: unknown): string {
  const providerLabel = provider
    ? (providerLabels[provider as keyof typeof providerLabels] || provider)
    : '';
  const errMsg = String((error as any)?.message || error || '').toLowerCase();

  // Auth / invalid API key
  if (
    errMsg.includes('api key') ||
    errMsg.includes('unauthorized') ||
    errMsg.includes('401') ||
    errMsg.includes('403') ||
    errMsg.includes('not authorized') ||
    errMsg.includes('invalid')
  ) {
    return i18n.t('chat.error.checkProviderSettings', { provider: providerLabel });
  }

  // Model not found or not supported
  if (
    errMsg.includes('model') &&
    (errMsg.includes('not found') || errMsg.includes('does not exist') || errMsg.includes('not support'))
  ) {
    return i18n.t('chat.error.checkModelSettings', {
      model: cfg?.model || '',
    });
  }

  // Connection / network errors (especially Ollama)
  if (
    provider === 'ollama' ||
    errMsg.includes('connection refused') ||
    errMsg.includes('fetch failed') ||
    errMsg.includes('networkerror') ||
    errMsg.includes('econnrefused')
  ) {
    return i18n.t('chat.error.checkOllamaConnection', {
      endpoint: cfg?.customEndpoint || 'http://localhost:11434/v1',
      model: cfg?.model || '',
    });
  }

  // Fallback
  return i18n.t('chat.error.checkProviderSettings', { provider: providerLabel });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChatStream(): UseChatStreamReturn {
  const [liveStepLogs, setLiveStepLogs] = useState<StepLogEntry[]>([]);
  const [phaseOutputs, setPhaseOutputs] = useState<Record<string, { label: string; text: string }>>({});
  const [continuationRound, setContinuationRound] = useState(0);
  const [maxContinuations, setMaxContinuations] = useState(0);
  const [rateLimitInfo, setRateLimitInfo] = useState<{ retryCount: number; maxRetries: number; waitMs: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationActive = useRef(false);

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    generationActive.current = false;
    useAppStore.getState().setAgentStatus("idle");
    setLiveStepLogs([]);
  }, []);

  const startGeneration = useCallback(
    async (history: ChatMessage[], onComplete?: () => void) => {
      if (generationActive.current) return;
      generationActive.current = true;

      const state = useAppStore.getState();
      const { aiConfig: cfg, currentProjectId: pid, addMessage, setAgentStatus, setAgentStepCount } = state;

      // Validate config
      if (!cfg) {
        addMessage({
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: i18n.t('chat.error.aiNotConfiguredDetailed', { notConfiguredLabel: i18n.t('ai.notConfiguredShort') }),
          timestamp: Date.now(),
        });
        generationActive.current = false;
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
        generationActive.current = false;
        onComplete?.();
        return;
      }

      // Load API key for the current provider from encrypted storage
      const apiKey = await loadApiKey(cfg.provider);

      if (cfg.provider !== "ollama" && !apiKey) {
        addMessage({
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: i18n.t('chat.error.apiKeyRequiredDetailed', {
            provider: providerLabels[cfg.provider as keyof typeof providerLabels] || cfg.provider,
            modelLabel: cfg.model || i18n.t('ai.notConfiguredShort'),
          }),
          timestamp: Date.now(),
        });
        generationActive.current = false;
        onComplete?.();
        return;
      }

      // Set up abort controller
      const abortController = new AbortController();
      abortRef.current = abortController;

      const providerLabel = providerLabels[cfg.provider as keyof typeof providerLabels] || cfg.provider;

      try {
        // Init MCP clients (may throw)
        await initMCPClients();

        // Provider-specific config validation (localized)
        const configIssue = getProviderConfigIssue(cfg, providerLabel);
        if (configIssue) {
          addMessage({
            id: `msg-err-${Date.now()}`,
            role: "assistant",
            content: i18n.t('chat.error.providerConfigError', { provider: providerLabel, detail: configIssue }),
            timestamp: Date.now(),
          });
          generationActive.current = false;
          onComplete?.();
          return;
        }

        // Configure the model (may throw — missing API key, unsupported provider, etc.)
        const model = getModel({
          provider: cfg.provider,
          model: cfg.model,
          apiKey: apiKey || undefined,
          customEndpoint: cfg.customEndpoint,
          region: cfg.region,
        });

      // Build tool set
      const allToolExecs: Record<string, any> = {
        read_file: {
          ...tools.read_file,
          execute: async ({ path }: { path: string }) => {
            const entryIdx = addRunningEntry("read_file", { path });
            try {
              const content = await readFile(path);
              updateEntry(entryIdx, "success", `${content.length} chars read from ${path}`, { file: path, size: content.length });
              return content;
            } catch (e: any) {
              updateEntry(entryIdx, "error", `❌ ${e.message || e}`, { file: path, error: e.message });
              return `❌ ${e.message || e}`;
            }
          },
        },
        list_files: {
          ...tools.list_files,
          execute: async () => {
            const entryIdx = addRunningEntry("list_files", {});
            try {
              const files = await listFiles();
              updateEntry(entryIdx, "success", `${files.length} files found`);
              return files;
            } catch (e: any) {
              updateEntry(entryIdx, "error", `❌ ${e.message || e}`);
              return [];
            }
          },
        },
        apply_artifact: {
          ...tools.apply_artifact,
          execute: async (input: { id: string; title: string; actions: unknown[] }) => {
            const entryIdx = addRunningEntry("apply_artifact", { id: input.id, title: input.title });
            try {
              const result = await applyArtifact({ id: input.id, title: input.title, actions: input.actions as any });
              updateEntry(
                entryIdx,
                result.success ? "success" : "error",
                result.success
                  ? `${result.filesChanged.length} files changed: ${result.filesChanged.join(', ')}`
                  : `Failed: ${(result.errors || []).join('; ')}`,
                { filesChanged: result.filesChanged, errors: result.errors },
              );
              return result;
            } catch (e: any) {
              updateEntry(entryIdx, "error", `❌ ${e.message || e}`);
              return { success: false, filesChanged: [], errors: [e.message || String(e)] };
            }
          },
        },
        get_errors: {
          ...tools.get_errors,
          execute: async () => {
            const entryIdx = addRunningEntry("get_errors", {});
            try {
              const errors = await getErrors();
              const summary = errors.length === 0 ? "No errors found" : `${errors.length} errors found`;
              updateEntry(entryIdx, "success", summary, { errors });
              return errors;
            } catch (e: any) {
              updateEntry(entryIdx, "error", `❌ ${e.message || e}`);
              return [];
            }
          },
        },
        take_screenshot: {
          ...tools.take_screenshot,
          execute: async (input: any) => {
            const entryIdx = addRunningEntry("take_screenshot", { width: input?.width, height: input?.height, waitAfterLoad: input?.waitAfterLoad });
            try {
              const result = await takeScreenshot({
                width: input?.width ?? 1280,
                height: input?.height ?? 720,
                waitAfterLoad: input?.waitAfterLoad,
                compareWithPrevious: input?.compareWithPrevious,
              });
              if (result.success) {
                const issueCount = result.detectedIssues?.length ?? 0;
                const errorCount = result.detectedIssues?.filter(i => i.severity === "error").length ?? 0;
                const warnCount = result.detectedIssues?.filter(i => i.severity === "warning").length ?? 0;
                let summary = `📸 Screenshot captured`;
                if (issueCount > 0) {
                  summary += ` | ${errorCount} errors, ${warnCount} warnings detected`;
                }
                updateEntry(entryIdx, "success", summary, {
                  elementsCount: result.elements?.length ?? 0,
                  consoleErrors: result.consoleErrors?.length ?? 0,
                  detectedIssues: result.detectedIssues,
                });
              } else {
                updateEntry(entryIdx, "error", `❌ ${result.error}`);
              }
              return JSON.stringify(result);
            } catch (e: any) {
              updateEntry(entryIdx, "error", `❌ ${e.message || e}`);
              return JSON.stringify({ success: false, error: e.message });
            }
          },
        },
      };

      // Add MCP tools
      const mcpTools = getMCPTools();
      if (mcpTools) {
        Object.assign(allToolExecs, mcpTools);
      }

      // Build tool set function for the orchestrator
      const buildTools = (toolNames: string[]) => {
        const subset: Record<string, any> = {};
        for (const name of toolNames) {
          if (allToolExecs[name]) {
            subset[name] = allToolExecs[name];
          }
        }
        return subset;
      };

        // Reset state
      setAgentStatus("running");
      setAgentStepCount(0);
      setLiveStepLogs([]);
      setPhaseOutputs({});
      setContinuationRound(0);
      setMaxContinuations(0);
      setRateLimitInfo(null);
      // Mark workspace as dirty — preview will rebuild on triggerReload
      useAppStore.getState().setWorkspaceReady(false);

      const { settings } = useAppStore.getState();
      const stepLogs: StepLogEntry[] = [];
      const localPhaseOutputs: Record<string, { label: string; text: string }> = {};

      /**
       * ツール実行開始時に "running" エントリを作成し、そのインデックスを返す。
       * ツール完了時に updateEntry() で同じエントリを更新する。
       */
      const addRunningEntry = (toolName: string, args: Record<string, unknown>): number => {
        const idx = stepLogs.length;
        stepLogs.push({
          step: idx + 1,
          toolName,
          args,
          status: "running",
        });
        setLiveStepLogs([...stepLogs]);
        return idx;
      };

      /**
       * 既存のエントリを更新する（running → success / error）
       */
      const updateEntry = (idx: number, status: "success" | "error", result?: string, detail?: Record<string, unknown>) => {
        if (idx >= 0 && idx < stepLogs.length) {
          stepLogs[idx] = { ...stepLogs[idx], status, result, detail };
          setLiveStepLogs([...stepLogs]);
        }
      };

      // Convert messages to AI SDK format
      const aiMessages = history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

        // Run the pipeline
        const pipelineResult = await runWithTriage(
          model,
          aiMessages,
          buildTools,
          abortController.signal,
          settings.simpleMode,
          settings.language,
          {
            onPhaseStart: async (_phase) => {
              // visual_qa フェーズ開始前にプレビューを最新のコードに同期する
              if (_phase === "visual_qa") {
                try {
                  const { previewManager } = await import("@/lib/preview");
                  const pid = useAppStore.getState().currentProjectId;
                  if (pid) {
                    await previewManager.syncForErrors(pid);
                  }
                } catch {
                  // 同期に失敗しても処理は続行する
                }
              }
            },
            onPhaseEnd: async (_phase, _result) => {
              // coder フェーズ終了後、書き込まれたファイルをプレビューに反映する
              // （visual_qa が最新コードで動作できるようにする）
              if (_phase === "coder") {
                try {
                  const { previewManager } = await import("@/lib/preview");
                  const pid = useAppStore.getState().currentProjectId;
                  if (pid) {
                    await previewManager.syncForErrors(pid);
                  }
                } catch {
                  // 同期に失敗しても処理は続行する
                }
              }
            },
            onPhaseDetail: (_phase, text) => {
              localPhaseOutputs[_phase] = { label: _phase, text };
              setPhaseOutputs({ ...localPhaseOutputs });
            },
            onToolCall: (_phase, _toolName, _args) => {
              // エントリ作成は各ツールの execute 関数内で addRunningEntry/updateEntry により行われます
            },
            onStepProgress: (_phase, { step, maxSteps }) => {
              setAgentStepCount(step);
              useAppStore.getState().setAgentMaxSteps(maxSteps);
            },
            onRateLimit: (_phase, retryCount, maxRetries, waitMs) => {
              setRateLimitInfo({ retryCount, maxRetries, waitMs });
            },
            onContinuation: (_phase, round, maxRounds) => {
              setContinuationRound(round);
              setMaxContinuations(maxRounds);
            },
            onTriageResult: (_result) => {},
          },
        );

        generationActive.current = false;
        abortRef.current = null;

        if (pipelineResult.text) {
          // ── Create checkpoint ──
          // Snapshot project files so the user can navigate back to this state.
          let checkpointId: string | undefined;
          try {
            checkpointId = await createCheckpoint(pid);
          } catch (e) {
            console.warn("[chat] Failed to create checkpoint:", e);
          }

          // Calculate cost
          let usage: TokenUsage | undefined;
          if (cfg) {
            const cost = calculateCost({
              inputTokens: pipelineResult.usage.inputTokens,
              outputTokens: pipelineResult.usage.outputTokens,
              model: cfg.model || undefined,
            });
            usage = {
              inputTokens: pipelineResult.usage.inputTokens,
              outputTokens: pipelineResult.usage.outputTokens,
              timestamp: new Date().toISOString(),
              provider: cfg.provider,
              model: cfg.model || undefined,
              estimatedCost: cost,
            };
          }

          addMessage({
            id: `msg-bot-${Date.now()}`,
            role: "assistant",
            content: pipelineResult.text,
            timestamp: Date.now(),
            checkpointId,
            stepLogs: [...stepLogs],
            phaseOutputs: Object.entries(localPhaseOutputs).map(([phase, { label, text }]) => ({ phase, label, text })),
            usage,
          });
          setLiveStepLogs([]);
          // Mark complete IMMEDIATELY — prevents UI from staying stuck on "running"
          // if subsequent non-critical operations (fetchCheckpoints, preview reload) fail.
          setAgentStatus("complete");

          // ── Non-critical post-processing ──
          // These update checkpoints and trigger preview reload. If they fail, the
          // generation is still considered complete — the user can reload manually.
          try {
            await useAppStore.getState().fetchCheckpoints();
            useAppStore.getState().setCurrentCheckpointIndex(useAppStore.getState().checkpoints.length - 1);
          } catch (e) {
            console.warn("[chat] Checkpoint update failed after generation:", e);
          }
          useAppStore.getState().setWorkspaceReady(true);
          useAppStore.getState().triggerReload();
        } else {
          setAgentStatus("error");
          addMessage({
            id: `msg-err-${Date.now()}`,
            role: "assistant",
            content: i18n.t('chat.error.emptyResponse', {
              provider: providerLabel,
              model: cfg.model || i18n.t('ai.notConfiguredShort'),
            }),
            timestamp: Date.now(),
          });
        }
      } catch (e: any) {
        generationActive.current = false;
        abortRef.current = null;
        if (e?.name === "AbortError") {
          setAgentStatus("idle");
          onComplete?.();
          return;
        }
        console.error("[chat] Generation error:", e);
        setAgentStatus("error");
        addMessage({
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: i18n.t('chat.error.generic', {
            errMsg: e?.message || String(e),
            hint: getErrorHint(cfg?.provider, cfg, e),
          }),
          timestamp: Date.now(),
        });
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
