/**
 * Triage Agent — Lightweight request complexity classification.
 *
 * Analyzes the request with a minimum-cost LLM call before the main processing
 * to decide between single-agent (simple) or multi-agent (complex) execution.
 *
 * Cost: ~100-200 tokens, <1 second.
 */
import { generateText, type LanguageModel } from 'ai';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TriageResult {
  mode: 'single' | 'multi';
  /** User-facing reason for the triage decision (short text) */
  reason: string;
}

// ─── System Prompt ─────────────────────────────────────────────────────────────

const TRIAGE_SYSTEM_PROMPT = `You are a request classifier for an AI code generation system.

Your ONLY job is to determine whether a user's request needs a simple single-step execution or a full multi-step pipeline.

## Rules

Respond with "single" when:
- Fixing typos, errors, or small bugs
- Simple 1-2 file modifications (e.g., "change button color", "add an input field")
- Running a shell command (e.g., "npm install")
- Reading files or checking project structure
- Small UI adjustments (text changes, spacing, layout tweaks)
- Adding a simple utility function
- Renaming or refactoring a single file

Respond with "multi" when:
- Creating a new app or feature from scratch
- Building a complete CRUD feature (types + store + components + hooks)
- Multi-file generation with dependencies between files
- The request requires planning before implementation
- The user describes a complex feature with multiple components
- The task would benefit from separate planning, implementation, and verification phases

## Output Format

Always respond with valid JSON only (no markdown, no explanation):

{"mode": "single", "reason": "Simple fix, running in single mode"}
{"mode": "multi", "reason": "Multiple files needed, running multi-agent mode"}

Keep reasons short (max 50 chars), user-facing.`;

// ─── Triage Function ──────────────────────────────────────────────────────────

/**
 * Run lightweight triage on the user's request to determine execution mode.
 *
 * Uses a minimal generateText call (no tools, low temperature, low max tokens)
 * to classify the request as needing single or multi-agent execution.
 *
 * @param messages - Conversation messages (uses only the last user message)
 * @param model - Language model instance (same as main, but minimal tokens)
 * @returns Triage decision with mode and user-facing reason
 */
export async function triageRequest(
  messages: Array<Record<string, unknown>>,
  model: LanguageModel,
): Promise<TriageResult> {
  // Extract the last user message for triage
  const lastUserMsg = findLastUserMessage(messages);

  if (!lastUserMsg) {
    return {
      mode: 'single',
      reason: 'No user message found, running single mode',
    };
  }

  try {
    const result = await generateText({
      model,
      system: TRIAGE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: lastUserMsg }],
      temperature: 0.1,  // Low temperature for consistent classification
      maxOutputTokens: 100,
    });

    const parsed = parseTriageResult(result.text);
    if (parsed) return parsed;

    // Fallback: parse failed
    console.warn('[triage] Failed to parse triage response, falling back to single:', result.text);
    return { mode: 'single', reason: 'Could not determine complexity, running single mode' };
  } catch (error) {
    console.warn('[triage] Triage call failed, falling back to single:', error);
    return { mode: 'single', reason: 'Analysis error, running single mode' };
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
  // Try direct JSON parse
  try {
    const parsed = JSON.parse(text.trim()) as Partial<TriageResult>;
    if (parsed.mode === 'single' || parsed.mode === 'multi') {
      return { mode: parsed.mode, reason: parsed.reason || '' };
    }
  } catch {
    // Not valid JSON — try extracting from markdown code block
  }

  // Try extracting from ```json ... ``` block
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n?(\{[\s\S]*?\})\s*\n?```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim()) as Partial<TriageResult>;
      if (parsed.mode === 'single' || parsed.mode === 'multi') {
        return { mode: parsed.mode, reason: parsed.reason || '' };
      }
    } catch {
      // ignore
    }
  }

  // Try extracting any JSON object
  const looseJsonMatch = text.match(/\{[\s\S]*?"mode"[\s\S]*?\}/);
  if (looseJsonMatch) {
    try {
      const parsed = JSON.parse(looseJsonMatch[0]) as Partial<TriageResult>;
      if (parsed.mode === 'single' || parsed.mode === 'multi') {
        return { mode: parsed.mode, reason: parsed.reason || '' };
      }
    } catch {
      // ignore
    }
  }

  return null;
}
