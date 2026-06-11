import type { Mode } from '../engine/types.ts';
import type { UsageTotals } from '../claude/transcripts.ts';

/** How a task's outcome is judged. Binary, no vibes. */
export type TaskCheck =
  /** run in the cell workspace; exit 0 = pass */
  | { kind: 'command'; command: string }
  /** matched against the model's final answer text (output-heavy tasks) */
  | { kind: 'answer-regex'; pattern: string; flags?: string };

export interface TaskSpec {
  id: string;
  prompt: string;
  /**
   * Follow-up prompts forming a scripted multi-turn conversation: the runner
   * sends `prompt`, then each entry via `claude -p --resume <session-id>`.
   * Absent = single-shot (existing behavior).
   */
  turns?: string[];
  /** directory name under bench/fixtures/ copied into the cell workspace */
  fixture: string;
  check: TaskCheck;
  /** e.g. ['log-heavy', 'output-heavy', 'large-file'] — reporting only */
  tags?: string[];
}

export interface SuiteSpec {
  name: string;
  tasks: TaskSpec[];
}

/**
 * One experimental condition. Modes map to variants 1:1; ablations add
 * variants like 'optimized-minus-out.no-preamble' (that atom removed) and
 * 'optimized-plus-tokens.drop-articles' (a rejected atom added back).
 */
export interface Variant {
  id: string;
  baseMode: Mode;
  /** rendered output-style body to install; null = no artifacts (full baseline) */
  styleBody: string | null;
  /** style name for settings.outputStyle; null for full */
  styleName: string | null;
  /** install the compression hook in this cell */
  hook: boolean;
  /**
   * Extra args appended to the hook command (e.g. '--marker-style informative')
   * so experiments can vary engine behavior per variant.
   */
  hookArgs?: string;
}

export interface CellSpec {
  task: TaskSpec;
  variant: Variant;
  trial: number;
  /** requested model */
  model: string;
}

export interface CellResult {
  runId: string;
  taskId: string;
  variantId: string;
  trial: number;
  model: string;
  /** modelUsage keys from the result JSON — fallback can silently substitute */
  servedModels: string[];
  /**
   * For command checks: did the check pass BEFORE the agent ran? A bugfix
   * fixture whose check already passes is vacuous — report flags these.
   */
  baselineCheckPassed: boolean | null;
  /** null = the check itself errored (infra problem, not task failure) */
  success: boolean | null;
  usage: UsageTotals;
  costUsd: number | null;
  durationMs: number;
  numTurns: number;
  /**
   * Count of permission_denials in the result JSON. Non-zero denials corrupt
   * the measurement (the model burns turns retrying instead of working) —
   * the report flags them as a data-quality problem.
   */
  permissionDenials: number;
  /**
   * Per-turn usage for multi-turn cells (one entry per scripted turn, from
   * each turn's result JSON). Absent for single-shot cells. Cell-level
   * `usage` stays authoritative (summed from the final transcript).
   */
  turnUsage?: UsageTotals[];
  /** tool_use counts by tool name, from the session transcript */
  toolCalls: Record<string, number>;
  sessionId: string | null;
  /** cell-level infrastructure failure (claude crashed, timeout, parse error) */
  error?: string;
  timestamp: string;
}

export interface RunMeta {
  runId: string;
  suite: string;
  variantIds: string[];
  model: string;
  trials: number;
  startedAt: string;
  /** hard cost ceiling; the runner stops scheduling cells when exceeded */
  maxBudgetUsd: number;
}
