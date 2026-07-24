/**
 * @deskspawn/browser-engine — Dynamic step-limit manager
 *
 * Grows the step ceiling when the agent is making meaningful progress
 * and stops early when it detects a loop.
 * Supports auto-continuation across multiple generateText rounds.
 */

const DEFAULT_BASE_LIMIT = 20;
const DEFAULT_ABSOLUTE_MAX = 120;
const LOOP_THRESHOLD = 3;
const MAX_EXTENSION = 60;
const MAX_FILE_WRITE_BONUS = 40;
const DEFAULT_MAX_CONTINUATIONS = 2;
const CONTINUATION_BONUS = 10;
const MAX_GET_ERRORS_WITHOUT_ACTION = 3;

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

export class StepManager {
  stepCount = 0;
  currentLimit: number;
  readonly baseLimit: number;
  readonly absoluteMax: number;
  stoppedReason: StepFinalState['stoppedReason'] = 'normal_completion';

  private fileWriteCount = 0;
  private toolHistory = new Map<string, number>();
  private lastToolKey = '';
  private consecutiveToolCount = 0;
  private loopScore = 0;
  private consecutiveGetErrors = 0;
  private totalFileActions = 0;

  readonly maxContinuations: number;
  continuationCount = 0;
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

  shouldStop(opts: { steps: Array<unknown> }): boolean {
    const currentStep = opts.steps.length;
    if (currentStep >= this.currentLimit) {
      this.stoppedReason = 'max_steps';
      return true;
    }
    if (this.totalStepsBeforeCurrentRound + currentStep >= this.absoluteMax) {
      this.stoppedReason = 'max_steps';
      return true;
    }
    if (this.loopScore >= LOOP_THRESHOLD) {
      this.stoppedReason = 'loop_detected';
      return true;
    }
    return false;
  }

  recordStep(toolCalls: StepRecord[]): void {
    this.stepCount++;
    for (const call of toolCalls) {
      this.recordToolCall(call.toolName, call.args);
    }
    this.updateLimit();
  }

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

  canAutoContinue(): boolean {
    if (this.stoppedReason === 'normal_completion') return false;
    if (this.continuationCount >= this.maxContinuations) return false;
    if (this.fileWriteCount === 0) return false;
    return true;
  }

  prepareForContinuation(): void {
    this.continuationCount++;
    this.totalStepsBeforeCurrentRound += this.stepCount;
    this.stepCount = 0;
    this.toolHistory = new Map<string, number>();
    this.lastToolKey = '';
    this.consecutiveToolCount = 0;
    this.loopScore = 0;
    this.consecutiveGetErrors = 0;
    this.totalFileActions = 0;
    this.stoppedReason = 'normal_completion';
    this.currentLimit = Math.min(
      this.baseLimit + this.getExtension() + (this.continuationCount * CONTINUATION_BONUS),
      this.absoluteMax,
    );
  }

  getSuggestion(): string | null {
    if (this.consecutiveGetErrors >= MAX_GET_ERRORS_WITHOUT_ACTION && this.totalFileActions === 0) {
      return 'You only read files without making any changes. Use apply_artifact to actually generate code.';
    }
    if (this.stoppedReason === 'loop_detected' && this.fileWriteCount === 0) {
      return 'You are repeating the same tool calls. Try a different approach or review the file contents you have read.';
    }
    if (this.stoppedReason === 'loop_detected' && this.fileWriteCount >= 3) {
      return 'Repeated fixes are not resolving the issue. Try using a template action (type: "template") to generate CRUD, or verify you are only using pre-installed components.';
    }
    if (this.stoppedReason === 'max_steps' && this.fileWriteCount >= 3) {
      return 'You have modified many files but reached the step limit. Send "continue" to resume from where you left off.';
    }
    return null;
  }

  private recordToolCall(toolName: string, args: Record<string, unknown>): void {
    const key = this.makeKey(toolName, args);
    const count = (this.toolHistory.get(key) || 0) + 1;
    this.toolHistory.set(key, count);

    const DIAGNOSTIC_TOOLS = [
      'get_errors', 'list_files', 'read_file',
      'take_screenshot',
    ];
    const isDiagnostic = DIAGNOSTIC_TOOLS.includes(toolName);

    if (!isDiagnostic) {
      if (key === this.lastToolKey) {
        this.consecutiveToolCount++;
        if (this.consecutiveToolCount >= LOOP_THRESHOLD) {
          this.loopScore++;
        }
      } else {
        this.lastToolKey = key;
        this.consecutiveToolCount = 1;
      }
    } else {
      this.consecutiveToolCount = 0;
    }

    if (toolName === 'apply_artifact') {
      this.fileWriteCount++;
      this.totalFileActions++;
      this.consecutiveGetErrors = 0;
    } else if (toolName === 'get_errors') {
      this.consecutiveGetErrors++;
    }
  }

  private getExtension(): number {
    let extension = 0;
    extension += Math.min(this.fileWriteCount * 10, MAX_FILE_WRITE_BONUS);
    return Math.min(extension, MAX_EXTENSION);
  }

  private updateLimit(): void {
    if (this.loopScore >= 2) return;
    const extension = this.getExtension();
    this.currentLimit = Math.min(this.baseLimit + extension, this.absoluteMax);
  }

  private makeKey(toolName: string, args: Record<string, unknown>): string {
    const normalised = args ? stableStringify(args) : '';
    return `${toolName}::${normalised}`;
  }
}

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
