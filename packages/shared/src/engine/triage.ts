/**
 * @deskspawn/browser-engine
 * Triage Agent — Lightweight request complexity classification on a 5-level scale.
 *
 * Analyzes the request with a minimum-cost LLM call before the main processing
 * to classify complexity into one of 5 levels, which the orchestrator maps to
 * different pipeline configurations.
 *
 * Level 1 — Trivial: typo fix, style tweak, single-line change
 * Level 2 — Minor: small feature, ≤ 2 files
 * Level 3 — Standard: full feature, multi-file generation
 * Level 4 — Complex: cross-cutting changes, needs testing & verification
 * Level 5 — Major: new app, architecture change, migration
 *
 * Cost: ~100-200 tokens, <1 second.
 */
import { generateText, type LanguageModel } from 'ai';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type { ComplexityLevel } from './types';

export interface TriageResult {
  /** 1 (= trivial) through 5 (= major, full pipeline required) */
  level: number; // JSON returns numbers; cast to ComplexityLevel at boundary
  /** User-facing reason for the triage decision (short text) */
  reason: string;
}

// ─── System Prompt ─────────────────────────────────────────────────────────────

const TRIAGE_SYSTEM_PROMPT = `You are a request classifier for an AI code generation system.

Your ONLY job is to classify the complexity of the user's request on a scale of 1 to 5.

## Classification Criteria

### Level 1 — Trivial
- Fixing typos, spelling mistakes
- One-line CSS / style change
- Changing text content
- Very minor visual adjustment (color, padding)
- Checking what files exist

### Level 2 — Minor
- Small bug fix (≤ 2 files affected)
- Adding one simple component or hook
- Small UI adjustment across a few lines
- Adding a single form field
- Modifying existing logic slightly

### Level 3 — Standard
- Full feature implementation
- Multi-file generation (types + component + hook)
- CRUD operations (list, create, edit, delete)
- Feature that requires coordination between multiple files
- Needs both planning and implementation

### Level 4 — Complex
- Cross-cutting changes affecting many files/modules
- Changes that require testing strategies
- Architecture modifications within an existing app
- Data model changes with migration considerations
- Multi-step workflows requiring verifier / QA

### Level 5 — Major
- Creating a new application from scratch
- Complete architecture redesign
- Major migrations or rewrites
- Integrating entirely new subsystems
- Building multi-page applications with routing

## Rules

- Classify based on the FULL scope of what the user is asking, including implied work.
- If the user asks for a "complete app" or says "build me X" where X is substantial → Level 3+.
- If the user mentions specific technical depth (testing, architecture review) → add one level.
- When uncertain, prefer the higher level (safer to over-classify).

## Output Format

Always respond with valid JSON only (no markdown, no explanation):

{"level": 1, "reason": "Typo fix, trivial change"}
{"level": 5, "reason": "New full-stack application"}

Keep reasons short (max 50 chars), user-facing. Level must be an integer from 1 to 5.`;

// ─── Triage Function ──────────────────────────────────────────────────────────

/**
 * Run lightweight triage on the user's request to determine execution complexity.
 *
 * Uses a minimal generateText call (no tools, low temperature, low max tokens)
 * to classify the request into one of 5 complexity levels (1-5),
 * which the orchestrator maps to different pipeline configurations.
 *
 * @param messages - Conversation messages (uses only the last user message)
 * @param model - Language model instance (same as main, but minimal tokens)
 * @param signal - Optional abort signal (Stop ボタン / 全体タイムアウトで生成を中断)
 * @returns Triage decision with level (1–5) and user-facing reason
 */
export async function triageRequest(
  messages: Array<Record<string, unknown>>,
  model: LanguageModel,
  signal?: AbortSignal,
): Promise<TriageResult> {
  // Extract the last user message for triage
  const lastUserMsg = findLastUserMessage(messages);

  if (!lastUserMsg) {
    return {
      level: 1,
      reason: 'No user message found, defaulting to simplest execution',
    };
  }

  try {
    const result = await generateText({
      model,
      system: TRIAGE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: lastUserMsg }],
      abortSignal: signal,
      timeout: 30_000,  // 軽量コールなので短めのタイムアウト
      temperature: 0.1,  // Low temperature for consistent classification
      maxOutputTokens: 100,
    });

    const parsed = parseTriageResult(result.text);
    if (parsed) return parsed;

    // Fallback: parse failed
    console.warn('[triage] Failed to parse triage response, falling back to level 2:', result.text);
    return { level: 2, reason: 'Could not determine complexity, defaulting to minor' };
  } catch (error) {
    console.warn('[triage] Triage call failed, falling back to level 2:', error);
    return { level: 2, reason: 'Analysis error, defaulting to minor' };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the last user message content from the conversation.
 * Handles both IPC format (content as string) and AI SDK format.
 */
function findLastUserMessage(messages: Array<Record<string, unknown>>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user') {
      const content = msg.content;
      if (typeof content === 'string' && content.trim()) {
        return content;
      }
      // Handle array content format (multimodal)
      if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part === 'object' && part !== null && (part as any).type === 'text') {
            return (part as any).text as string;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Parse the triage LLM response into a TriageResult.
 * Handles JSON in various formats (bare JSON, code-fenced, mixed text).
 */
function parseTriageResult(text: string): TriageResult | null {
  /** Validate a parsed JSON blob against the new 5-level schema. */
  function isLevel(v: unknown): v is number {
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
  }

  // ── direct JSON ────────────────────────────────────────────────────────
  try {
    const parsed = JSON.parse(text.trim()) as Partial<TriageResult>;
    if (isLevel(parsed.level)) {
      return { level: parsed.level, reason: parsed.reason || '' };
    }
  } catch {
    // fall through
  }

  // ── fenced code block ──────────────────────────────────────────────────
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\s*\n?```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim()) as Partial<TriageResult>;
      if (isLevel(parsed.level)) {
        return { level: parsed.level, reason: parsed.reason || '' };
      }
    } catch { /* ignore */ }
  }

  // ── any JSON object containing "level" ─────────────────────────────────
  const looseJsonMatch = text.match(/\{[\s\S]*?"level"[^\}]*\}/);
  if (looseJsonMatch) {
    try {
      const parsed = JSON.parse(looseJsonMatch[0]) as Partial<TriageResult>;
      if (isLevel(parsed.level)) {
        return { level: parsed.level, reason: parsed.reason || '' };
      }
    } catch { /* ignore */ }
  }

  return null;
}
