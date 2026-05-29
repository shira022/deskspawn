/**
 * Dynamic step-limit manager for the agent loop.
 *
 * Grows the step ceiling when the agent is making meaningful progress
 * (file writes, shell commands, new tool types) and contracts / stops
 * early when it detects a loop (same tool+args repeated 3× consecutively).
 *
 * Supports auto-continuation across multiple generateText rounds:
 * when the step limit is reached mid-task and the agent is making
 * progress, a new round starts automatically (up to N continuations).
 *
 * Industry patterns researched (May 2026):
 *   - Claude Code:  maxTurns + maxBudgetUsd, 6 recovery strategies, circuit breakers
 *   - Cursor:       "Done when" conditions + loop fingerprinting + checkpoint rules
 *   - Vercel AI SDK: stepCountIs(N) + composable stop conditions
 *   - Bolt.new:     Agent Standard/Max tier split by task complexity
 *   - Claude 4.7:   bugfix 10-20 / feature 30-60 / refactor 60-100 steps
 *   - AgentPatterns: policy layer (max_steps, loop_detected, no_progress) + audit log
 *
 * Design (v2):
 *   - baseLimit:         initial step ceiling (default 20)
 *   - absoluteMax:       hard safety cap across all rounds (default 120)
 *   - Progress signals:  file writes (+10 each, up to 40), shell execs (+5 each, up to 20)
 *   - Extension cap:     max +60 total from progress
 *   - Loop detection:    same (toolName + argsJSON) seen 3× consecutively → stops early
 *   - Auto-continuation: when max_steps / loop_detected + progress made → auto-start next round (max 2)
 *   - Continuation bonus: +10 extra steps per continuation round
 */

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_BASE_LIMIT = 20;
const DEFAULT_ABSOLUTE_MAX = 120;
const LOOP_THRESHOLD = 3;           // same tool+args count → looping
const MAX_EXTENSION = 60;           // max bonus steps added via progress
const MAX_FILE_WRITE_BONUS = 40;    // cap for file-write contribution
const MAX_SHELL_EXEC_BONUS = 20;    // cap for shell-exec contribution
const DEFAULT_MAX_CONTINUATIONS = 2;
const CONTINUATION_BONUS = 10;      // extra base steps per continuation round

// Error recovery: patterns that indicate the agent is stuck
const MAX_GET_ERRORS_WITHOUT_ACTION = 3; // repeated get_errors with no file writes

// ─── Public types ──────────────────────────────────────────────────────────────

export interface StepRecord {
  toolName: string;
  args: Record<string, unknown>;
}

export interface StepProgress {
  step: number;
  maxSteps: number;
  continuationRound: number;
  maxContinuations: number;
}

export interface StepFinalState {
  step: number;
  maxSteps: number;
  hitLimit: boolean;
  stoppedReason: 'max_steps' | 'loop_detected' | 'normal_completion';
  continuationRound: number;
  maxContinuations: number;
}

// ─── StepManager ───────────────────────────────────────────────────────────────

export class StepManager {
  stepCount = 0;
  currentLimit: number;
  readonly baseLimit: number;
  readonly absoluteMax: number;
  stoppedReason: StepFinalState['stoppedReason'] = 'normal_completion';

  // Progress signals
  private fileWriteCount = 0;
  private shellExecCount = 0;

  // Loop detection (consecutive-pattern based)
  /** Cumulative history for extension/analysis purposes */
  private toolHistory = new Map<string, number>();
  /** Last tool+args key seen (for consecutive tracking) */
  private lastToolKey = '';
  /** How many times the last tool+args has appeared consecutively */
  private consecutiveToolCount = 0;
  /** Loop severity score (incremented when consecutive count hits threshold) */
  private loopScore = 0;

  // Stuck detection (for targeted recovery suggestions)
  /** Consecutive get_errors calls without any apply_artifact between them. */
  private consecutiveGetErrors = 0;
  /** Last tool name seen (to detect no-progress patterns). */
  // private _lastToolName = '';
  /** Total apply_artifact calls in this round. */
  private totalFileActions = 0;

  // Auto-continuation
  readonly maxContinuations: number;
  continuationCount = 0;
  /** Total steps consumed across all continuation rounds (excl. current round). */
  totalStepsBeforeCurrentRound = 0;

  constructor(
    baseLimit = DEFAULT_BASE_LIMIT,
    absoluteMax = DEFAULT_ABSOLUTE_MAX,
    maxContinuations = DEFAULT_MAX_CONTINUATIONS,
  ) {
    this.baseLimit = baseLimit;
    this.absoluteMax = absoluteMax;
    this.maxContinuations = maxContinuations;
    this.currentLimit = baseLimit;
  }

  // ── Public API used by the agent loop ────────────────────────────────

  /**
   * Called in `stopWhen` before every step.
   * Receives `{ steps: StepResult[] }` from the AI SDK v6.
   * Returns `true` when the loop should stop.
   */
  shouldStop(opts: { steps: Array<unknown> }): boolean {
    const currentStep = opts.steps.length;

    // Per-round step limit
    if (currentStep >= this.currentLimit) {
      this.stoppedReason = 'max_steps';
      return true;
    }
    // Absolute max across all rounds combined
    if (this.totalStepsBeforeCurrentRound + currentStep >= this.absoluteMax) {
      this.stoppedReason = 'max_steps';
      return true;
    }
    // Loop detection: bail early before wasting steps
    if (this.loopScore >= LOOP_THRESHOLD) {
      this.stoppedReason = 'loop_detected';
      return true;
    }
    return false;
  }

  /**
   * Called in `onStepFinish` after every step.
   * Records tool calls, updates progress signals, recalculates limit.
   */
  recordStep(toolCalls: StepRecord[]): void {
    this.stepCount++;

    for (const call of toolCalls) {
      this.recordToolCall(call.toolName, call.args);
    }

    this.updateLimit();
  }

  /**
   * Returns current progress for SSE events (continuation-aware).
   */
  getProgress(): StepProgress {
    return {
      step: this.totalStepsBeforeCurrentRound + this.stepCount,
      maxSteps: Math.min(
        this.totalStepsBeforeCurrentRound + this.currentLimit,
        this.absoluteMax,
      ),
      continuationRound: this.continuationCount,
      maxContinuations: this.maxContinuations,
    };
  }

  /**
   * Returns final state after the loop ends (or after each round).
   */
  getFinalState(): StepFinalState {
    return {
      step: this.totalStepsBeforeCurrentRound + this.stepCount,
      maxSteps: Math.min(
        this.totalStepsBeforeCurrentRound + this.currentLimit,
        this.absoluteMax,
      ),
      hitLimit: this.stoppedReason !== 'normal_completion',
      stoppedReason: this.stoppedReason,
      continuationRound: this.continuationCount,
      maxContinuations: this.maxContinuations,
    };
  }

  // ── Auto-continuation API ────────────────────────────────────────────

  /**
   * Whether the manager should auto-continue into a new round.
   * Conditions:
   *   - Not a normal completion (max_steps or loop_detected are both recoverable)
   *   - Under the max continuation count
   *   - Made meaningful progress (wrote files or ran commands)
   */
  canAutoContinue(): boolean {
    if (this.stoppedReason === 'normal_completion') return false;
    if (this.continuationCount >= this.maxContinuations) return false;
    // Only continue if meaningful progress was made
    if (this.fileWriteCount === 0 && this.shellExecCount === 0) return false;
    return true;
  }

  /**
   * Prepare state for a new continuation round.
   * Must be called between generateText() calls.
   */
  prepareForContinuation(): void {
    this.continuationCount++;
    this.totalStepsBeforeCurrentRound += this.stepCount;
    this.stepCount = 0;

    // Reset loop detection (fresh context for the new round)
    this.toolHistory = new Map<string, number>();
    this.lastToolKey = '';
    this.consecutiveToolCount = 0;
    this.loopScore = 0;
    this.consecutiveGetErrors = 0;
    this.totalFileActions = 0;
    this.stoppedReason = 'normal_completion';

    // Recalculate limit with continuation bonus
    this.currentLimit = Math.min(
      this.baseLimit + this.getExtension() + (this.continuationCount * CONTINUATION_BONUS),
      this.absoluteMax,
    );
  }

  // ── Internals ────────────────────────────────────────────────────────

  private recordToolCall(toolName: string, args: Record<string, unknown>): void {
    const key = this.makeKey(toolName, args);
    const count = (this.toolHistory.get(key) || 0) + 1;
    this.toolHistory.set(key, count);

    // ── Loop detection ──────────────────────────────────────────────
    // Only write/execute tools (apply_artifact, run_shell) can trigger
    // loop detection. Diagnostic tools (get_errors, list_files, read_file)
    // are excluded because they are called repeatedly during normal
    // development cycles (read→write→check→fix), and should NOT count
    // as loop evidence.
    const DIAGNOSTIC_TOOLS = ['get_errors', 'list_files', 'read_file'];
    const isDiagnostic = DIAGNOSTIC_TOOLS.includes(toolName);

    if (!isDiagnostic) {
      // Same tool+args seen 3× consecutively → looping.
      // Non-consecutive repeats (e.g. write→check→write→check) are normal
      // progress patterns and should NOT trigger loop detection.
      if (key === this.lastToolKey) {
        this.consecutiveToolCount++;
        if (this.consecutiveToolCount >= LOOP_THRESHOLD) {
          this.loopScore++;
        }
      } else {
        this.lastToolKey = key;
        this.consecutiveToolCount = 1;
      }
    }
    // Diagnostic tools reset the consecutive counter because they
    // represent progress-checking activity between write operations.
    // E.g. apply_artifact → get_errors → apply_artifact should NOT
    // look like consecutive apply_artifact calls.
    else {
      this.consecutiveToolCount = 0;
    }

    // Progress signals
    if (toolName === 'apply_artifact') {
      this.fileWriteCount++;
      this.totalFileActions++;
      this.consecutiveGetErrors = 0; // reset: we're taking action
    } else if (toolName === 'run_shell') {
      this.shellExecCount++;
      this.consecutiveGetErrors = 0; // reset: we're taking action
    } else if (toolName === 'get_errors') {
      this.consecutiveGetErrors++;
    }

  }

  /**
   * Returns a recovery suggestion when the agent appears stuck.
   * Called after loop detection fires, to give the user a hint.
   */
  getSuggestion(): string | null {
    // Pattern A: Repeated get_errors without any file writes
    if (this.consecutiveGetErrors >= MAX_GET_ERRORS_WITHOUT_ACTION && this.totalFileActions === 0) {
      return 'コードを読んだだけで何も変更していないようです。apply_artifact を使って実際にコードを生成してみてください。';
    }

    // Pattern B: Loop detected and no file changes at all
    if (this.stoppedReason === 'loop_detected' && this.fileWriteCount === 0) {
      return '同じツール呼び出しを繰り返しています。別のアプローチを試すか、読み取ったファイルの内容を確認してください。';
    }

    // Pattern C: Loop detected after many file writes (stuck in fix loop)
    if (this.stoppedReason === 'loop_detected' && this.fileWriteCount >= 3) {
      return '修正を繰り返していますが解決していません。テンプレートアクション (type: "template") を使ってCRUDを生成するか、または pre-installed の shadcn/ui コンポーネントのみを使用しているか確認してください。';
    }

    // Pattern D: Max steps reached with file writes but errors likely remain
    if (this.stoppedReason === 'max_steps' && this.fileWriteCount >= 3) {
      return '多くのファイルを変更しましたが上限に達しました。「続けて」と送信すると続きから再開します。';
    }

    return null;
  }

  private makeKey(toolName: string, args: Record<string, unknown>): string {
    // Normalise by sorting keys so {a:1,b:2} and {b:2,a:1} produce the same key
    const normalised = args ? stableStringify(args) : '';
    return `${toolName}::${normalised}`;
  }

  private getExtension(): number {
    let extension = 0;
    extension += Math.min(this.fileWriteCount * 10, MAX_FILE_WRITE_BONUS);
    extension += Math.min(this.shellExecCount * 5, MAX_SHELL_EXEC_BONUS);
    return Math.min(extension, MAX_EXTENSION);
  }

  private updateLimit(): void {
    // Don't extend if looping
    if (this.loopScore >= 2) {
      return;
    }

    const extension = this.getExtension();
    this.currentLimit = Math.min(
      this.baseLimit + extension,
      this.absoluteMax,
    );
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Deterministic JSON.stringify that sorts object keys.
 * Used for tool-call fingerprinting so the same args always produce the same key.
 */
function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${pairs.join(',')}}`;
}
