import { exec, execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { encodeProjectDir, type UsageTotals } from '../claude/transcripts.ts';
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

/** Writes style files + cell settings; returns the settings file path. */
async function writeVariantArtifacts(
  variant: Variant,
  workspace: string,
  scratch: string,
): Promise<string> {
  if (variant.styleBody !== null && variant.styleName !== null) {
    const fileName = `${variant.styleName}.md`;
    // style resolution under --bare may use either scope: write both
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
    if (variant.baseMode === 'full') {
      throw new Error(`variant ${variant.id}: hook requires baseMode optimized|slim`);
    }
    settings['hooks'] = {
      PostToolUse: [
        {
          matcher: HOOK_MATCHER,
          hooks: [{ type: 'command', command: resolveHookCommand(variant.baseMode) }],
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

async function judgeSuccess(
  check: TaskCheck,
  workspace: string,
  resultText: string,
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
    return { success: re.test(resultText), checkError: null };
  } catch (error) {
    return { success: null, checkError: `answer-regex invalid: ${errorMessage(error)}` };
  }
}

async function invokeClaude(
  spec: CellSpec,
  workspace: string,
  scratch: string,
  settingsFile: string,
): Promise<string> {
  const bin = process.env.COMPRESSOR_CLAUDE_BIN ?? 'claude';
  const args = [
    '--bare',
    '-p',
    spec.task.prompt,
    '--output-format',
    'json',
    '--model',
    spec.model,
    '--settings',
    settingsFile,
  ];
  const options = {
    cwd: workspace,
    env: { ...process.env, CLAUDE_CONFIG_DIR: scratch },
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

    const stdout = await invokeClaude(spec, workspace, scratch, settingsFile);
    const parsed = parseResultJson(stdout);

    const toolCalls =
      parsed.sessionId === null
        ? {}
        : await countToolCalls(
            path.join(
              scratch,
              'projects',
              encodeProjectDir(workspace),
              `${parsed.sessionId}.jsonl`,
            ),
          );

    const { success, checkError } = await judgeSuccess(
      spec.task.check,
      workspace,
      parsed.resultText,
    );

    return {
      ...base,
      servedModels: parsed.servedModels,
      baselineCheckPassed,
      success,
      usage: parsed.usage,
      costUsd: parsed.costUsd,
      durationMs: parsed.durationMs,
      numTurns: parsed.numTurns,
      permissionDenials: parsed.permissionDenials,
      toolCalls,
      sessionId: parsed.sessionId,
      ...(checkError !== null ? { error: checkError } : {}),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ...base,
      servedModels: [],
      baselineCheckPassed,
      success: null,
      usage: zeroUsage(),
      costUsd: null,
      durationMs: 0,
      numTurns: 0,
      permissionDenials: 0,
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
