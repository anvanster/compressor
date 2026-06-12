import { exec, execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  addUsage,
  encodeProjectDir,
  readSessionUsage,
  type UsageTotals,
} from '../claude/transcripts.ts';
import { resolveHookCommand } from '../paths.ts';
import type { CellResult, CellSpec, TaskCheck, Variant } from './types.ts';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const CLAUDE_TIMEOUT_MS = 600_000;
const CHECK_TIMEOUT_MS = 600_000;
const MAX_BUFFER = 32 * 1024 * 1024;
const HOOK_MATCHER = 'Read|Bash|Grep|Glob';

export interface CellContext {
  runId: string;
  fixturesDir: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function zeroUsage(): UsageTotals {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

async function gitInitBestEffort(workspace: string): Promise<void> {
  try {
    await execFileAsync('git', ['init', '-q'], { cwd: workspace, timeout: 30_000 });
  } catch {
    // git missing or init failed — workspace works without it
  }
}

/**
 * Hook command installed in a cell: the resolved bundle command plus the
 * variant's extra args (Variant.hookArgs, e.g. '--marker-style informative')
 * so experiments can vary engine behavior per variant. `root` is exposed for
 * tests only; production callers use the package default. Style is pinned to
 * 'absolute': cells must measure THIS build, never whatever compressor-hook
 * happens to resolve to on PATH.
 */
export function hookCommandForVariant(variant: Variant, root?: string): string {
  if (variant.baseMode === 'full') {
    throw new Error(`variant ${variant.id}: hook requires baseMode optimized|slim`);
  }
  const base =
    root === undefined
      ? resolveHookCommand(variant.baseMode, undefined, 'absolute')
      : resolveHookCommand(variant.baseMode, root, 'absolute');
  const extra = variant.hookArgs?.trim() ?? '';
  return extra === '' ? base : `${base} ${extra}`;
}

/** Writes style files + cell settings; returns the settings file path. */
async function writeVariantArtifacts(
  variant: Variant,
  workspace: string,
  scratch: string,
): Promise<string> {
  if (variant.styleBody !== null && variant.styleName !== null) {
    const fileName = `${variant.styleName}.md`;
    // style resolution may use either scope: write both (belt-and-braces)
    const workspaceDir = path.join(workspace, '.claude', 'output-styles');
    const scratchDir = path.join(scratch, 'output-styles');
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(scratchDir, { recursive: true });
    await writeFile(path.join(workspaceDir, fileName), variant.styleBody, 'utf8');
    await writeFile(path.join(scratchDir, fileName), variant.styleBody, 'utf8');
  }

  const settings: Record<string, unknown> = {
    // Headless cells must work unprompted inside their throwaway workspace;
    // denied Edit/Bash calls otherwise corrupt the measurement (the model
    // spins on retries instead of doing the task — observed live: 16 turns
    // of denial loops with the correct fix in hand).
    permissions: { defaultMode: 'bypassPermissions' },
  };
  if (variant.styleName !== null) {
    settings['outputStyle'] = variant.styleName;
  }
  if (variant.hook) {
    settings['hooks'] = {
      PostToolUse: [
        {
          matcher: HOOK_MATCHER,
          hooks: [{ type: 'command', command: hookCommandForVariant(variant) }],
        },
      ],
    };
  }

  const file = path.join(scratch, 'cell-settings.json');
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return file;
}

type CheckOutcome = { kind: 'ran'; passed: boolean } | { kind: 'infra'; message: string };

async function runCommandCheck(command: string, cwd: string): Promise<CheckOutcome> {
  try {
    await execAsync(command, { cwd, timeout: CHECK_TIMEOUT_MS });
    return { kind: 'ran', passed: true };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number') {
      return { kind: 'ran', passed: code === 0 };
    }
    return { kind: 'infra', message: errorMessage(error) };
  }
}

async function baselineCheck(check: TaskCheck, workspace: string): Promise<boolean | null> {
  if (check.kind !== 'command') {
    return null;
  }
  const outcome = await runCommandCheck(check.command, workspace);
  return outcome.kind === 'ran' ? outcome.passed : null;
}

/**
 * Command checks run once in the workspace (after the final turn). For
 * answer-regex the conversation is the answer: pass when the pattern matches
 * ANY single turn's result text (see the semantics note in tasks.ts).
 */
async function judgeSuccess(
  check: TaskCheck,
  workspace: string,
  resultTexts: string[],
): Promise<{ success: boolean | null; checkError: string | null }> {
  if (check.kind === 'command') {
    const outcome = await runCommandCheck(check.command, workspace);
    if (outcome.kind === 'infra') {
      return { success: null, checkError: `success check failed to run: ${outcome.message}` };
    }
    return { success: outcome.passed, checkError: null };
  }
  try {
    const re = new RegExp(check.pattern, check.flags);
    const success = resultTexts.some((text) => {
      re.lastIndex = 0; // 'g'/'y' flags carry state across .test calls
      return re.test(text);
    });
    return { success, checkError: null };
  } catch (error) {
    return { success: null, checkError: `answer-regex invalid: ${errorMessage(error)}` };
  }
}

/**
 * Environment for the claude child process (and therefore for the PostToolUse
 * hook it spawns). CLAUDE_CONFIG_DIR isolates the cell; COMPRESSOR_NO_LEDGER
 * keeps benchmark cells out of the user's LIVE savings ledger — hook-bearing
 * cells run the real hook, and without the kill switch every worthwhile
 * compression would append a synthetic event to ~/.compressor/ledger,
 * corrupting what `compressor savings` reports. Exported for tests.
 */
export function cellEnv(scratch: string): NodeJS.ProcessEnv {
  return { ...process.env, CLAUDE_CONFIG_DIR: scratch, COMPRESSOR_NO_LEDGER: '1' };
}

async function invokeClaude(
  spec: CellSpec,
  workspace: string,
  scratch: string,
  settingsFile: string,
  prompt: string,
  resumeSessionId?: string,
): Promise<string> {
  const bin = process.env.COMPRESSOR_CLAUDE_BIN ?? 'claude';
  // NO --bare: measured 2026-06-11, --bare silently ignores output styles
  // (both scopes) and hooks (settings file AND --settings) while honoring
  // permissions — every --bare cell is an unstyled, hookless full baseline,
  // which invalidated the first results corpus. Isolation holds without it:
  // CLAUDE_CONFIG_DIR=scratch REPLACES the user scope (settings, hooks,
  // styles, plugins, memory, and OAuth credential lookup — keyless scratch
  // cells fail with 'Not logged in', so the operator's subscription is
  // unreachable), and fixture workspaces carry no CLAUDE.md. The
  // treatment-delivery canaries in benchmark.ts hard-fail the run if a cell
  // configured this way ever stops applying styles or firing hooks.
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--model',
    spec.model,
    '--settings',
    settingsFile,
  ];
  if (resumeSessionId !== undefined) {
    // documented headless continuation: claude -p "<prompt>" --resume <id>
    args.push('--resume', resumeSessionId);
  }
  const options = {
    cwd: workspace,
    env: cellEnv(scratch),
    timeout: CLAUDE_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  };
  // .mjs/.js bins (test stubs) are not directly executable: run via node
  const { stdout } = /\.(mjs|js)$/.test(bin)
    ? await execFileAsync(process.execPath, [bin, ...args], options)
    : await execFileAsync(bin, args, options);
  return stdout;
}

interface ParsedResult {
  sessionId: string | null;
  servedModels: string[];
  usage: UsageTotals;
  costUsd: number | null;
  durationMs: number;
  numTurns: number;
  permissionDenials: number;
  resultText: string;
}

function parseResultJson(stdout: string): ParsedResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const head = stdout.trim().slice(0, 200);
    throw new Error(`result JSON parse failed: ${head === '' ? '(empty stdout)' : head}`);
  }
  if (!isRecord(parsed)) {
    throw new Error('result JSON parse failed: not an object');
  }
  const usage = isRecord(parsed['usage']) ? parsed['usage'] : {};
  return {
    sessionId: typeof parsed['session_id'] === 'string' ? parsed['session_id'] : null,
    servedModels: Object.keys(isRecord(parsed['modelUsage']) ? parsed['modelUsage'] : {}),
    usage: {
      input: num(usage['input_tokens']),
      output: num(usage['output_tokens']),
      cacheCreation: num(usage['cache_creation_input_tokens']),
      cacheRead: num(usage['cache_read_input_tokens']),
    },
    costUsd: typeof parsed['total_cost_usd'] === 'number' ? parsed['total_cost_usd'] : null,
    durationMs: num(parsed['duration_ms']),
    numTurns: num(parsed['num_turns']),
    permissionDenials: Array.isArray(parsed['permission_denials'])
      ? parsed['permission_denials'].length
      : 0,
    resultText: typeof parsed['result'] === 'string' ? parsed['result'] : '',
  };
}

function transcriptFilePath(scratch: string, workspace: string, sessionId: string): string {
  return path.join(scratch, 'projects', encodeProjectDir(workspace), `${sessionId}.jsonl`);
}

/**
 * Transcript totals and summed per-turn result JSONs count the same API
 * responses, so they must roughly agree. Divergence beyond this relative
 * tolerance means one of the two known failure topologies happened: a
 * resumed session forked ids and the final transcript does NOT carry the
 * full copied history (transcript ≪ sum: usage silently undercounts to
 * roughly the last turn), or per-turn result JSONs report cumulative
 * session usage (sum ≫ transcript: the fallback double-counts). Neither is
 * detectable from one side alone; the cell is flagged data-quality-suspect.
 */
export const USAGE_MISMATCH_TOLERANCE = 0.25;

function totalTokens(usage: UsageTotals): number {
  return usage.input + usage.output + usage.cacheCreation + usage.cacheRead;
}

/**
 * Cell-level usage for multi-turn cells: the FINAL transcript, deduped by
 * requestId (readSessionUsage), is authoritative across all turns — resumed
 * sessions carry the full history, and per-turn result JSONs would double
 * count anything the API reported on more than one turn. Falls back to
 * summing the turn result JSONs when the transcript is missing/empty.
 * When the transcript IS used, it is cross-checked against the summed
 * per-turn usage; disagreement flags the cell instead of silently reporting
 * a wrong total (`suspect` carries the data-quality note).
 */
async function multiTurnUsage(
  scratch: string,
  workspace: string,
  sessionId: string | null,
  turnUsage: UsageTotals[],
): Promise<{ totals: UsageTotals; suspect: string | null }> {
  const summed = turnUsage.reduce(addUsage, zeroUsage());
  if (sessionId === null) {
    return { totals: summed, suspect: null };
  }
  try {
    const session = await readSessionUsage(transcriptFilePath(scratch, workspace, sessionId));
    if (session.turns === 0) {
      return { totals: summed, suspect: null };
    }
    const fromTranscript = totalTokens(session.totals);
    const fromTurns = totalTokens(summed);
    const limit = Math.max(fromTranscript, fromTurns) * USAGE_MISMATCH_TOLERANCE;
    const suspect =
      fromTurns > 0 && Math.abs(fromTranscript - fromTurns) > limit
        ? `usage data-quality: final transcript totals (${fromTranscript} tokens) diverge from summed per-turn usage (${fromTurns} tokens) by >${Math.round(USAGE_MISMATCH_TOLERANCE * 100)}% — resumed session may have forked without full history, or per-turn result JSONs may be cumulative`
        : null;
    return { totals: session.totals, suspect };
  } catch {
    return { totals: summed, suspect: null };
  }
}

async function countToolCalls(transcriptFile: string): Promise<Record<string, number>> {
  let text: string;
  try {
    text = await readFile(transcriptFile, 'utf8');
  } catch {
    return {};
  }
  // PLAN.md: the same API response can appear on multiple transcript lines —
  // dedupe by requestId/message.id, last occurrence wins (matches
  // readSessionUsage in src/claude/transcripts.ts)
  const byKey = new Map<string, string[]>();
  let anonCounter = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || parsed['type'] !== 'assistant') continue;
    const message = parsed['message'];
    if (!isRecord(message) || !Array.isArray(message['content'])) continue;
    const names: string[] = [];
    for (const block of message['content'] as unknown[]) {
      if (isRecord(block) && block['type'] === 'tool_use' && typeof block['name'] === 'string') {
        names.push(block['name']);
      }
    }
    const key =
      typeof parsed['requestId'] === 'string'
        ? parsed['requestId']
        : typeof message['id'] === 'string'
          ? message['id']
          : `anon-${anonCounter++}`;
    byKey.set(key, names);
  }
  const counts: Record<string, number> = {};
  for (const names of byKey.values()) {
    for (const name of names) {
      counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  return counts;
}

/** Best-effort removal, refusing anything outside the OS temp dir. */
async function cleanupTempDir(dir: string): Promise<void> {
  if (dir === '') return;
  try {
    const tmpReal = await realpath(tmpdir());
    const rel = path.relative(tmpReal, dir);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return;
    await rm(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

export async function runCell(spec: CellSpec, ctx: CellContext): Promise<CellResult> {
  const base = {
    runId: ctx.runId,
    taskId: spec.task.id,
    variantId: spec.variant.id,
    trial: spec.trial,
    model: spec.model,
  };
  let workspace = '';
  let scratch = '';
  let baselineCheckPassed: boolean | null = null;
  const isMultiTurn = spec.task.turns !== undefined;
  // accumulated outside the try so a failed turn still reports completed
  // turns — including their COSTS: every completed turn's costUsd is known
  // at failure time, and discarding it would leave the runner's budget
  // ceiling blind to real spend on exactly the runs that misbehave
  const turnUsage: UsageTotals[] = [];
  const turnCosts: number[] = [];

  try {
    // realpath both sides so the encoded transcript dir matches the cwd the
    // child reports (macOS tmpdir is a symlinked /var/folders path)
    workspace = await realpath(await mkdtemp(path.join(tmpdir(), 'compressor-bench-ws-')));
    scratch = await realpath(await mkdtemp(path.join(tmpdir(), 'compressor-bench-cfg-')));

    // fix.patch.json is the answer key (scripted fix for stubs/fixture tests);
    // copying it would hand the agent the literal solution
    await cp(path.join(ctx.fixturesDir, spec.task.fixture), workspace, {
      recursive: true,
      filter: (src) => path.basename(src) !== 'fix.patch.json',
    });
    await gitInitBestEffort(workspace);

    const settingsFile = await writeVariantArtifacts(spec.variant, workspace, scratch);
    baselineCheckPassed = await baselineCheck(spec.task.check, workspace);

    // scripted conversation: first the task prompt, then each turn resumed
    // from the previous turn's session id (sessions can fork ids on resume,
    // so each turn chains from the one before it)
    const prompts = [spec.task.prompt, ...(spec.task.turns ?? [])];
    const turns: ParsedResult[] = [];
    for (const [index, prompt] of prompts.entries()) {
      const label = prompts.length > 1 ? `turn ${index + 1}/${prompts.length}: ` : '';
      let resume: string | undefined;
      if (index > 0) {
        const prevSession = turns[index - 1]?.sessionId ?? null;
        if (prevSession === null) {
          throw new Error(`${label}previous turn reported no session_id to --resume from`);
        }
        resume = prevSession;
      }
      let parsed: ParsedResult;
      try {
        const stdout = await invokeClaude(spec, workspace, scratch, settingsFile, prompt, resume);
        parsed = parseResultJson(stdout);
      } catch (error) {
        // single-shot keeps its original message; conversations get the label
        throw label === '' ? error : new Error(`${label}${errorMessage(error)}`);
      }
      turns.push(parsed);
      turnUsage.push(parsed.usage);
      if (typeof parsed.costUsd === 'number') {
        turnCosts.push(parsed.costUsd);
      }
    }

    const final = turns[turns.length - 1];
    if (final === undefined) {
      throw new Error('no turns ran'); // unreachable: prompts is never empty
    }

    // final transcript covers the whole conversation (toolCalls + usage)
    const toolCalls =
      final.sessionId === null
        ? {}
        : await countToolCalls(transcriptFilePath(scratch, workspace, final.sessionId));
    const multi = isMultiTurn
      ? await multiTurnUsage(scratch, workspace, final.sessionId, turnUsage)
      : null;
    const usage = multi === null ? final.usage : multi.totals;

    const { success, checkError } = await judgeSuccess(
      spec.task.check,
      workspace,
      turns.map((turn) => turn.resultText),
    );

    const problems = [checkError, multi?.suspect ?? null].filter(
      (note): note is string => note !== null,
    );

    return {
      ...base,
      servedModels: [...new Set(turns.flatMap((turn) => turn.servedModels))],
      baselineCheckPassed,
      success,
      usage,
      // each invocation reports its own totals: sum across turns
      costUsd: turnCosts.length === 0 ? null : turnCosts.reduce((sum, cost) => sum + cost, 0),
      durationMs: turns.reduce((sum, turn) => sum + turn.durationMs, 0),
      numTurns: turns.reduce((sum, turn) => sum + turn.numTurns, 0),
      permissionDenials: turns.reduce((sum, turn) => sum + turn.permissionDenials, 0),
      ...(isMultiTurn ? { turnUsage: [...turnUsage] } : {}),
      toolCalls,
      sessionId: final.sessionId,
      ...(problems.length > 0 ? { error: problems.join('; ') } : {}),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ...base,
      servedModels: [],
      baselineCheckPassed,
      success: null,
      // a failed/garbled turn errors the cell, but completed turns still
      // count: usage sums them (keeps `usage` consistent with `turnUsage` —
      // an aggregator summing either must see the same spend) and costUsd
      // carries the partial spend so the runner's budget ceiling sees it
      usage: turnUsage.reduce(addUsage, zeroUsage()),
      costUsd: turnCosts.length === 0 ? null : turnCosts.reduce((sum, cost) => sum + cost, 0),
      durationMs: 0,
      numTurns: 0,
      permissionDenials: 0,
      ...(isMultiTurn && turnUsage.length > 0 ? { turnUsage: [...turnUsage] } : {}),
      toolCalls: {},
      sessionId: null,
      error: errorMessage(error),
      timestamp: new Date().toISOString(),
    };
  } finally {
    await cleanupTempDir(workspace);
    await cleanupTempDir(scratch);
  }
}
