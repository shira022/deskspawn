/**
 * useChatStream — Direct AI streaming hook (browser-native)
 *
 * Replaces the old SSE-based useChatSSE hook. Instead of calling a sidecar
 * HTTP server, it uses the Vercel AI SDK directly in the browser to
 * call AI provider APIs.
 */

import { useState, useCallback, useRef } from "react";
import { useAppStore } from "../store/useAppStore";
import type { ChatMessage, StepLogEntry, TokenUsage, PipelineTierLevel } from "../types";
import { providerLabels } from "../lib/constants";
import { isDesktopEnv } from "../lib/platform";
import { newMessageId } from "../lib/ids";
import { getModel } from "../engine/providers";
import { runWithTriage, type QaVerdict } from "../engine/orchestrator";
import { tools } from "../engine/tools";
import {
  readFile,
  listFiles,
  applyArtifact,
  getErrors,
  takeScreenshot,
  createCheckpoint,
} from "../engine/tool-executors";
import { getMCPTools } from "../engine/mcp-client";
import { loadApiKey } from "../lib/storage";
import i18n from "../lib/i18n";
import { calculateCost } from "../lib/cost";
import { initMCPClients } from "../engine/mcp-client";

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

  // Rate limit (429)
  if (errMsg.includes('429') || errMsg.includes('rate limit') || errMsg.includes('rate_limit')) {
    const waitMs = String((error as any)?.retryAfter || '');
    const retryCount = String((error as any)?.retryCount || '');
    const maxRetries = String((error as any)?.maxRetries || '');
    // 3値が揃っている経路だけ詳細文面を使う。欠けた値で埋めると
    // 「（/ 回目、待機 ms）」のように破綻するため、汎用文面へフォールバックする。
    return waitMs && retryCount && maxRetries
      ? i18n.t('chat.error.rateLimitDetailed', { waitMs, retryCount, maxRetries })
      : i18n.t('chat.error.rateLimit');
  }

  // Auth / invalid API key (401, 403)
  if (
    errMsg.includes('api key') ||
    errMsg.includes('unauthorized') ||
    errMsg.includes('401') ||
    errMsg.includes('403') ||
    errMsg.includes('not authorized') ||
    errMsg.includes('invalid')
  ) {
    return i18n.t('chat.error.apiKeyInvalid');
  }

  // Model not found (404 or model-specific messages)
  if (
    errMsg.includes('model') &&
    (errMsg.includes('not found') || errMsg.includes('does not exist') || errMsg.includes('not support'))
  ) {
    const model = cfg?.model || '';
    // モデル名が取れない場合は空の {{model}} で「モデル「」」と破綻しないよう
    // プレースホルダを持たない汎用文面を使う。
    return model
      ? i18n.t('chat.error.modelNotFoundDetailed', { model })
      : i18n.t('chat.error.modelNotFound');
  }

  // Timeout / abort
  if (
    errMsg.includes('timeout') ||
    errMsg.includes('aborted') ||
    errMsg.includes('aborterror')
  ) {
    return i18n.t('chat.error.timeout');
  }

  // Network / connection errors (Failed to fetch, NetworkError, etc.)
  if (
    provider === 'ollama' ||
    errMsg.includes('connection refused') ||
    errMsg.includes('fetch failed') ||
    errMsg.includes('failed to fetch') ||
    errMsg.includes('networkerror') ||
    errMsg.includes('econnrefused') ||
    errMsg.includes('network') ||
    errMsg.includes('econnreset') ||
    errMsg.includes('enotfound')
  ) {
    if (provider === 'ollama') {
      return i18n.t('chat.error.checkOllamaConnection', {
        endpoint: cfg?.customEndpoint || 'http://localhost:11434/v1',
        model: cfg?.model || '',
      });
    }
    return i18n.t('chat.error.networkError');
  }

  // Fallback
  return i18n.t('chat.error.checkProviderSettings', { provider: providerLabel });
}

// ── Pipeline Summary Agent ────────────────────────────────────────────────────

/**
 * エラーを示す語（error / failed / エラー 等）を検出するためのパターン。
 * 英単語には語境界 `\b` を付ける。`_` は単語構成文字なので verifier の成功定型文
 * "get_errors() returns empty" には一致しない（成功報告を偽陽性にしないため）。
 * 日本語は語境界の概念がないため部分一致のまま。
 */
const ERROR_SIGNAL_RE = /\berrors?\b|\bfailed\b|\bfailure\b|\bexception\b|エラー|失敗|例外/gi;

/** 両フェーズに適用する明確な失敗マーカー。 */
const FAIL_MARKER_RE = /❌|\bFAIL\b/i;

/**
 * visual_qa にのみ適用する重大マーカー。verifier は "No critical issues" のような
 * 合格表現を出しうるため critical を verifier 判定には使わない（元実装では
 * critical は visual_qa のみで判定していた）。
 */
const CRITICAL_RE = /\bcritical\b/gi;

/**
 * エラー語の直前 ≤16 文字に現れる否定・不在。
 * 英語は前置（"no errors"）、日本語の一部（"未検出のエラー"）を想定。
 */
const NEGATION_BEFORE_RE = /(?:\b(?:no|not|without|zero|none|never)\b|n['’]t|\b0\b|未検出)/i;

/**
 * エラー語の直後 ≤16 文字に現れる否定・不在。
 * 英語の後置（"Errors: 0" / "errors: none"）と日本語の後置
 * （「エラーなし」「エラーはありません」「エラー 0件」）の両方を判定する。
 */
const NEGATION_AFTER_RE = /(?:なし|無し|ない|ありません|問題なし|未検出|ゼロ|\bnone\b|\bzero\b|\b0\b)/i;

/**
 * エラー語の直後に**アンカー**して現れる日本語の否定形。
 * 「エラーもなく」「エラーなく」「エラーが無く」のように、否定語が
 * エラー語の直後（助詞を挟んで）に来る形を捉える。
 *
 * NEGATION_AFTER_RE と違い窓内を広く検索しない。窓検索にすると
 * 「エラーが少なくとも3件」の「少なく」に誤って一致し、本物のエラーを
 * 抑制してしまうため、必ずエラー語の直後から照合する。
 */
const NEGATION_AFTER_ANCHORED_RE = /^\s*(?:も|は|が|、|,)?\s*(?:なく|無く|ありません|ございません)/;

/** エラー語の直後 ≤16 文字に現れる解消表現。 */
const RESOLUTION_AFTER_RE = /(?:resolved|fixed|解消|修正済|対応済|済み)/i;

/** エラー語の直前・直後の判定窓（文字数）。 */
const NEGATION_BEFORE_WINDOW = 16;
const NEGATION_AFTER_WINDOW = 16;

/** 否定判定のときに越えて遡らない節区切り（句読点・改行・閉じ括弧）。 */
const CLAUSE_BOUNDARY_RE = /[.。!?！？\n）)]/;

/**
 * エラー語の直前 ≤16 文字を、最後の節区切り以降に切り詰めて返す。
 * "No files changed. 3 errors found" のような、節をまたいだ否定語で
 * 本物のエラーを抑制しないため。
 */
function getBeforeClause(text: string, index: number): string {
  const segment = text.slice(Math.max(0, index - NEGATION_BEFORE_WINDOW), index);
  let cut = -1;
  for (let i = 0; i < segment.length; i++) {
    if (CLAUSE_BOUNDARY_RE.test(segment[i])) cut = i;
  }
  return cut >= 0 ? segment.slice(cut + 1) : segment;
}

/**
 * テキスト中に「否定・解消されていない」pattern の出現が含まれるかを判定する。
 * 直前は節区切りを越えずに否定語を探し、直後は否定語（0 / none / なし 等）と
 * 解消表現（resolved / 修正済 等）を抑制に使う。
 *
 * 肯定語（passed / success / clean / 正常 / 成功）は抑制に使わない。
 * 「Verification passed, but 1 failure remains」のような本物のエラーを
 * 見逃さないため、抑制は近接した否定・解消表現に限定する。
 */
function hasUnnegatedMatch(text: string, pattern: RegExp): boolean {
  if (!text) return false;
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex++;
      continue;
    }
    const before = getBeforeClause(text, match.index);
    const afterStart = match.index + match[0].length;
    const after = text.slice(afterStart, afterStart + NEGATION_AFTER_WINDOW);
    if (NEGATION_BEFORE_RE.test(before)) continue;
    if (NEGATION_AFTER_RE.test(after)) continue;
    if (NEGATION_AFTER_ANCHORED_RE.test(after)) continue;
    if (RESOLUTION_AFTER_RE.test(after)) continue;
    return true;
  }
  return false;
}

/** テキスト中に否定されていないエラー語が含まれるか。 */
function hasUnnegatedError(text: string): boolean {
  return hasUnnegatedMatch(text, ERROR_SIGNAL_RE);
}

/** テキスト中に否定されていない critical 表現が含まれるか（visual_qa 専用）。 */
function hasUnnegatedCritical(text: string): boolean {
  return hasUnnegatedMatch(text, CRITICAL_RE);
}

/** ❌ / FAIL の明確な失敗マーカー（verifier / visual_qa 共通）。 */
function hasFailMarker(text: string): boolean {
  return !!text && FAIL_MARKER_RE.test(text);
}

/**
 * 時間切れ行に埋め込む短いフェーズ名。
 * 既存 locale の phase.* は説明的で（例: 「エラーチェックと修正」）、
 * インラインのフェーズ言及には長いため、サマリ専用の短い名称を持つ。
 */
const PHASE_NAMES: Record<string, { ja: string; en: string }> = {
  planner: { ja: "計画", en: "planning" },
  coder: { ja: "実装", en: "coding" },
  verifier: { ja: "検証", en: "verification" },
  visual_qa: { ja: "表示確認", en: "visual check" },
};

function phaseName(phase: string | undefined, isJa: boolean): string {
  const entry = phase ? PHASE_NAMES[phase] : undefined;
  if (entry) return isJa ? entry.ja : entry.en;
  return isJa ? "最終" : "final";
}

export interface SummarizeOptions {
  simpleMode?: boolean;
  language?: string;
  /**
   * stepLogs に記録された error 件数（試行錯誤を検証フェーズの失敗と
   * 区別して情報表示するために使う）。
   */
  stepErrorCount?: number;
  /**
   * 例外などで停止したフェーズが存在するか（failedPhases）。
   * テキストにエラー語が現れない失敗でも警告を出すための構造的シグナル。
   */
  phaseFailed?: boolean;
  /**
   * 直近の visual_qa 判定の状態。
   * current = 判定は最終コードを指す（断定してよい）。
   * stale   = 判定はあるが、その後に修正が入った（断定しない）。
   * not-run = visual_qa 未実行（そのティアに含まれない。表示確認の行は出さない）。
   * failed  = visual_qa は実行されたが判定を返さなかった（最終状態は未確認）。
   */
  qaVerdict?: QaVerdict;
  /** ループを中断した理由。'aborted' はユーザーの停止操作。 */
  interruptedBy?: "timeout" | "aborted" | "error";
  /** 例外などで停止したフェーズ名（interruptedBy のフェーズ表示に使う）。 */
  failedPhases?: string[];
  /** パイプライン中に成功したファイル変更が1つでもあったか。 */
  fileChangesApplied?: boolean;
}

/**
 * Summarize all phase outputs into a single clean response.
 * In simpleMode: user-friendly summary (what was built, key features, errors).
 * In !simpleMode: includes technical details (files, tests, build status).
 */
export function summarizePipelineResult(
  phaseOutputs: Record<string, { label: string; text: string }>,
  options: SummarizeOptions = {},
): string {
  const {
    simpleMode,
    language,
    stepErrorCount = 0,
    phaseFailed = false,
    qaVerdict = "current",
    interruptedBy,
    failedPhases = [],
    fileChangesApplied = false,
  } = options;
  const phases = ["planner", "coder", "verifier", "visual_qa"];
  const availablePhases = phases.filter((p) => phaseOutputs[p]?.text?.trim());
  if (availablePhases.length === 0) return "";

  const coderText = phaseOutputs["coder"]?.text || "";
  const verifierText = phaseOutputs["verifier"]?.text || "";
  const visualQaText = phaseOutputs["visual_qa"]?.text || "";
  const plannerText = phaseOutputs["planner"]?.text || "";

  // Extract key information from phase outputs
  const fileChanges = coderText.match(/(?:created?|updated?|modified?|written?|written to|changes? (?:made|in)|files? (?:created?|modified?))[\s:]+([^\n]+)/gi) || [];
  // verifier / visual_qa それぞれの「否定されていないエラー語」。critical は
  // visual_qa のみに適用する（verifier は "No critical issues" のような
  // 合格表現を出しうるため）。
  const verifierHasError = hasFailMarker(verifierText) || hasUnnegatedError(verifierText);
  const visualQaHasError =
    hasFailMarker(visualQaText) ||
    hasUnnegatedError(visualQaText) ||
    hasUnnegatedCritical(visualQaText);
  // hasErrors: いずれかのフェーズに未否定のエラー語 / 失敗マーカーがあるか。
  const hasErrors = verifierHasError || visualQaHasError;
  // simple mode は、テキストに出ない構造的失敗（phaseFailed）も検証失敗として警告する。
  const verificationFailed = phaseFailed || hasErrors;
  const hasWarnings = /⚠️|warning|警告/i.test(verifierText) || /⚠️|warning|警告/i.test(visualQaText);
  const passStatus = /✅|PASS|passed|success/i.test(visualQaText);
  // technical mode: ❌ は visual_qa の明確な失敗のみ。verifier のみのエラー語は
  // hasErrors として「⚠️ 警告付きパス」に残す（旧来の分岐を到達可能に戻す）。
  const failStatus = hasFailMarker(visualQaText) || hasUnnegatedCritical(visualQaText);
  const hasStepErrors = stepErrorCount > 0;
  // 時間切れ行のフェーズ表示（生 id を出さない）。
  const timeoutPhase = phaseName(failedPhases[0], language === "ja");

  // Extract file list from coder output
  const fileListMatch = coderText.match(/```[\s\S]*?(?:created?|files?)[\s\S]*?```/gi) || [];
  const fileCount = fileListMatch.length || (fileChanges.length > 0 ? fileChanges.length : null);

  // 検証の後に修正が入った場合（stale）、目の前の判定は最終コードではなく
  // 古い状態を指す。visual_qa は実行されたが判定を返さなかった場合（failed）も
  // 最終状態は未確認。どちらも「問題が検出された／修正が必要」と断定しない。
  // not-run は visual_qa がそのティアに無いだけで、表示確認に関する行は出さない。
  const staleVerdict = qaVerdict === "stale";
  const failedVerdict = qaVerdict === "failed";

  // Simple mode: user-friendly summary
  if (simpleMode) {
    const parts: string[] = [];
    const isJa = language === "ja";

    if (isJa) {
      parts.push("## 生成完了\n");
      // Extract user-facing description from planner output
      const descMatch = plannerText.match(/(?:summary|概要|description|説明)[\s:]+([^\n]+)/i);
      if (descMatch) {
        parts.push(`**アプリ概要**: ${descMatch[1].trim()}\n`);
      }

      if (fileCount) {
        parts.push(`**ファイル数**: ${fileCount} ファイルを作成・更新しました\n`);
      }

      if (failedVerdict) {
        parts.push("⚠️ **ステータス**: 表示確認（visual_qa）が完了しませんでした。最終状態は未確認です。\n");
      } else if (staleVerdict) {
        parts.push("⚠️ **ステータス**: 検証で問題が指摘され、修正を適用しました。最終状態はまだ確認されていません。\n");
      } else if (verificationFailed) {
        parts.push("⚠️ **ステータス**: 一部の問題が検出されました。詳細は下の「フェーズ詳細」で確認できます。\n");
      } else if (hasStepErrors) {
        parts.push(`ℹ️ **ステータス**: 生成中に ${stepErrorCount} 件のツールエラーがありましたが、生成は完了しました。\n`);
      } else {
        parts.push("✅ **ステータス**: 正常に生成されました\n");
      }

      if (failedVerdict || staleVerdict) {
        parts.push("ℹ️ **確認**: プレビューで最終状態をご確認ください。\n");
      } else if (verificationFailed) {
        parts.push("⚠️ **注意**: エラーが検出されました。修正が必要な場合があります。\n");
      } else if (hasWarnings) {
        parts.push("💡 **ヒント**: 一部の警告がありますが、アプリは動作します。\n");
      }

      if (interruptedBy === "timeout") {
        parts.push(
          fileChangesApplied
            ? `⏱️ **時間切れ**: ${timeoutPhase} フェーズが時間切れで終了しました（適用済みの変更はそのまま残っています）。\n`
            : `⏱️ **時間切れ**: ${timeoutPhase} フェーズがタイムアウトしたため終了しました。\n`,
        );
      }

      parts.push("\nアプリはプレビューパネルで確認できます。");
    } else {
      parts.push("## Generation Complete\n");
      const descMatch = plannerText.match(/(?:summary|description)[\s:]+([^\n]+)/i);
      if (descMatch) {
        parts.push(`**App Overview**: ${descMatch[1].trim()}\n`);
      }

      if (fileCount) {
        parts.push(`**Files**: ${fileCount} file(s) created/updated\n`);
      }

      if (failedVerdict) {
        parts.push("⚠️ **Status**: Visual QA did not complete. The final state has not been confirmed.\n");
      } else if (staleVerdict) {
        parts.push("⚠️ **Status**: Issues were reported during verification and fixes were applied. The final state has not been verified yet.\n");
      } else if (verificationFailed) {
        parts.push("⚠️ **Status**: Some issues were detected. Check 'Phase Details' below for more info.\n");
      } else if (hasStepErrors) {
        parts.push(`ℹ️ **Status**: ${stepErrorCount} tool error(s) occurred during generation, but the generation completed.\n`);
      } else {
        parts.push("✅ **Status**: Generated successfully\n");
      }

      if (failedVerdict || staleVerdict) {
        parts.push("ℹ️ **Check**: Please review the final state in the preview.\n");
      } else if (verificationFailed) {
        parts.push("⚠️ **Note**: Errors were detected. You may need to make corrections.\n");
      } else if (hasWarnings) {
        parts.push("💡 **Tip**: Some warnings were found, but the app should work.\n");
      }

      if (interruptedBy === "timeout") {
        parts.push(
          fileChangesApplied
            ? `⏱️ **Timeout**: The ${timeoutPhase} phase ended due to a timeout (applied changes have been kept).\n`
            : `⏱️ **Timeout**: The ${timeoutPhase} phase ended because it timed out.\n`,
        );
      }

      parts.push("\nYou can preview the app in the preview panel.");
    }

    return parts.join("\n");
  }

  // Technical mode: include details
  const parts: string[] = [];
  const isJa = language === "ja";

  if (isJa) {
    parts.push("## 生成完了 — 詳細レポート\n");

    if (plannerText) {
      parts.push("### プランナー\n");
      parts.push(plannerText.substring(0, 500) + (plannerText.length > 500 ? "..." : "") + "\n");
    }

    parts.push("### コーダー\n");
    if (fileCount) {
      parts.push(`**ファイル変更**: ${fileCount} ファイル\n`);
    }
    // Show first 300 chars of coder output for technical users
    parts.push(coderText.substring(0, 300) + (coderText.length > 300 ? "..." : "") + "\n");

    parts.push("### バリデーター\n");
    if (staleVerdict) {
      parts.push("❌ **判定は修正前のもの**: 修正を適用済み／最終確認は未実施\n");
    } else if (failStatus) {
      parts.push("❌ **失敗**: 問題が検出されました\n");
    } else if (hasErrors) {
      parts.push("⚠️ **警告付きパス**: エラーあり\n");
    } else if (passStatus) {
      parts.push("✅ **パス**: 問題なし\n");
    }
    if (verifierText) {
      parts.push(verifierText.substring(0, 500) + (verifierText.length > 500 ? "..." : "") + "\n");
    }

    if (failedVerdict || visualQaText) {
      parts.push("### ビジュアルQA\n");
      if (failedVerdict) {
        parts.push("⚠️ **表示確認（visual_qa）が完了しませんでした**: 最終状態は未確認です\n");
      }
      if (visualQaText) {
        parts.push(visualQaText.substring(0, 500) + (visualQaText.length > 500 ? "..." : "") + "\n");
      }
    }

    if (interruptedBy === "timeout") {
      parts.push(
        fileChangesApplied
          ? `⏱️ **時間切れ**: ${timeoutPhase} フェーズが時間切れで終了しました（適用済みの変更はそのまま残っています）。\n`
          : `⏱️ **時間切れ**: ${timeoutPhase} フェーズがタイムアウトしたため終了しました。\n`,
      );
    }

    parts.push("\n> 完全なフェーズ出力は下の「フェーズ詳細」パネルで確認できます。");
  } else {
    parts.push("## Generation Complete — Detailed Report\n");

    if (plannerText) {
      parts.push("### Planner\n");
      parts.push(plannerText.substring(0, 500) + (plannerText.length > 500 ? "..." : "") + "\n");
    }

    parts.push("### Coder\n");
    if (fileCount) {
      parts.push(`**File Changes**: ${fileCount} file(s)\n`);
    }
    parts.push(coderText.substring(0, 300) + (coderText.length > 300 ? "..." : "") + "\n");

    parts.push("### Verifier\n");
    if (staleVerdict) {
      parts.push("❌ **Verdict is from before fixes**: Fixes were applied / final check not performed\n");
    } else if (failStatus) {
      parts.push("❌ **Failed**: Issues detected\n");
    } else if (hasErrors) {
      parts.push("⚠️ **Passed with warnings**: Errors found\n");
    } else if (passStatus) {
      parts.push("✅ **Passed**: No issues\n");
    }
    if (verifierText) {
      parts.push(verifierText.substring(0, 500) + (verifierText.length > 500 ? "..." : "") + "\n");
    }

    if (failedVerdict || visualQaText) {
      parts.push("### Visual QA\n");
      if (failedVerdict) {
        parts.push("⚠️ **Visual QA did not complete**: The final state has not been confirmed\n");
      }
      if (visualQaText) {
        parts.push(visualQaText.substring(0, 500) + (visualQaText.length > 500 ? "..." : "") + "\n");
      }
    }

    if (interruptedBy === "timeout") {
      parts.push(
        fileChangesApplied
          ? `⏱️ **Timeout**: The ${timeoutPhase} phase ended due to a timeout (applied changes have been kept).\n`
          : `⏱️ **Timeout**: The ${timeoutPhase} phase ended because it timed out.\n`,
      );
    }

    parts.push("\n> Full phase outputs are available in the 'Phase Details' panel below.");
  }

  return parts.join("\n");
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
      const { aiConfig: cfg, currentAppId: pid, addMessage, updateMessage, setAgentStatus, setAgentStepCount } = state;

      // Validate config
      if (!cfg) {
        addMessage({
          id: newMessageId("msg-err"),
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
          id: newMessageId("msg-err"),
          role: "assistant",
          content: i18n.t('chat.error.noAppSelected', { newAppLabel: i18n.t('app.newApp') }),
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
          id: newMessageId("msg-err"),
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

      // D2 (ADR-013): 生成中アシスタントメッセージのID（try の外で宣言し
      // catch / abort パスからも参照できるようにする）。
      let activeBotMsgId: string | null = null;

      try {
        // Init MCP clients (may throw)
        await initMCPClients();

        // Provider-specific config validation (localized)
        const configIssue = getProviderConfigIssue(cfg, providerLabel);
        if (configIssue) {
          addMessage({
            id: newMessageId("msg-err"),
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

      const { settings, agentTier } = useAppStore.getState();
      const stepLogs: StepLogEntry[] = [];
      const localPhaseOutputs: Record<string, { label: string; text: string }> = {};

      /**
       * D2 (ADR-013): 生成開始と同時にアシスタントメッセージをプレース
       * ホルダーとして永続化する。アプリが途中で閉じられても、ここまでの
       * ステップログ／フェーズ詳細がDBに残る（未完了生成の復元・
       * 「AI応答が保存されない」データ欠落の根本対策）。
       * 以降、このメッセージを updateMessage で更新していく。
       */
      const botMsgId = newMessageId("msg-bot");
      addMessage({
        id: botMsgId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      });
      activeBotMsgId = botMsgId;

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
        updateMessage(botMsgId, { stepLogs: [...stepLogs] });
        return idx;
      };

      /**
       * 既存のエントリを更新する（running → success / error）
       */
      const updateEntry = (idx: number, status: "success" | "error", result?: string, detail?: Record<string, unknown>) => {
        if (idx >= 0 && idx < stepLogs.length) {
          stepLogs[idx] = { ...stepLogs[idx], status, result, detail };
          setLiveStepLogs([...stepLogs]);
          updateMessage(botMsgId, { stepLogs: [...stepLogs] });
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
                  const { previewManager } = await import("../lib/preview");
                  const pid = useAppStore.getState().currentAppId;
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
                  const { previewManager } = await import("../lib/preview");
                  const pid = useAppStore.getState().currentAppId;
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
              // フェーズ詳細も逐次永続化（D2）
              updateMessage(botMsgId, {
                phaseOutputs: Object.entries(localPhaseOutputs).map(([phase, { label, text }]) => ({
                  phase,
                  label,
                  text,
                })),
              });
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
            onTriageResult: (result) => {
              // 規模の可視化: オート判定 / 手動選択を区別してストアへ保存する
              const manual = useAppStore.getState().agentTier !== "auto";
              useAppStore.getState().setLastTriage({
                level: result.level,
                source: manual ? "manual" : "auto",
                reason: result.reason,
              });
            },
          },
          isDesktopEnv(),
          // AiConfig.maxSteps — 動的ステップ管理のベース値（未設定ならエンジン既定値）
          cfg.maxSteps,
          // 手動ティア選択（"auto" の場合は null → triage の LLM 判定を実行）
          agentTier === "auto"
            ? null
            : (Number(agentTier.slice(1)) as PipelineTierLevel),
        );

        generationActive.current = false;
        abortRef.current = null;

        if (pipelineResult.text) {
          // ── Create checkpoint ──
          // Snapshot app files so the user can navigate back to this state.
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

          // Generate summary from phase outputs instead of showing raw pipeline text
          const summaryText = summarizePipelineResult(localPhaseOutputs, {
            simpleMode: settings.simpleMode,
            language: settings.language,
            stepErrorCount: stepLogs.filter((l) => l.status === "error").length,
            phaseFailed: pipelineResult.failedPhases.length > 0,
            qaVerdict: pipelineResult.qaVerdict,
            interruptedBy: pipelineResult.interruptedBy,
            failedPhases: pipelineResult.failedPhases,
            fileChangesApplied: pipelineResult.fileChangesApplied,
          });
          updateMessage(botMsgId, {
            content: summaryText || pipelineResult.text,
            checkpointId,
            stepLogs: [...stepLogs],
            phaseOutputs: Object.entries(localPhaseOutputs).map(([phase, { label, text }]) => ({
              phase,
              label,
              text,
            })),
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
          updateMessage(botMsgId, {
            content: i18n.t('chat.error.emptyResponse', {
              provider: providerLabel,
              model: cfg.model || i18n.t('ai.notConfiguredShort'),
            }),
          });
        }
      } catch (e: any) {
        generationActive.current = false;
        abortRef.current = null;
        if (e?.name === "AbortError") {
          setAgentStatus("idle");
          // 中断された生成: プレースホルダーに注記を残す（部分ログは保存済み）
          if (activeBotMsgId) {
            const cur = useAppStore.getState().messages.find((m) => m.id === activeBotMsgId);
            if (cur && !cur.content) {
              updateMessage(activeBotMsgId, {
                content: i18n.t("chat.error.generationInterrupted"),
              });
            }
          }
          onComplete?.();
          return;
        }
        console.error("[chat] Generation error:", e);
        setAgentStatus("error");
        if (activeBotMsgId) {
          updateMessage(activeBotMsgId, {
            content: i18n.t('chat.error.generic', {
              errMsg: e?.message || String(e),
              hint: getErrorHint(cfg?.provider, cfg, e),
            }),
          });
        }
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
