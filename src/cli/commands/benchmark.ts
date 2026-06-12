import { exec, execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { buildVariants } from '../../bench/ablate.ts';
import { balanceWarning } from '../../bench/results.ts';
import { runBenchmark } from '../../bench/runner.ts';
import { loadSuite, suiteFixturesDir } from '../../bench/tasks.ts';
import type { SuiteSpec } from '../../bench/types.ts';
import type { Mode } from '../../engine/types.ts';
import { resolveHookCommand } from '../../paths.ts';

const execFileAsync = promisify(execFile);

export interface BenchmarkCliOptions {
  suite: string;
  modes: string;
  trials: string;
  model: string;
  ablate?: string;
  ablateAdd?: string;
  /** comma-separated atom categories (output|behavior) for group ablation */
  ablateGroup?: string;
  /** commander --no-hook: defaults true */
  hook: boolean;
  /** extra args appended to the hook command in every hook-bearing variant */
  hookArgs?: string;
  /**
   * comma-separated marker styles: fans each hook-bearing variant out into
   * one arm per style WITHIN this run (shared budget ceiling, balanced groups)
   */
  markerStyles?: string;
  concurrency: string;
  maxBudgetUsd: string;
  out: string;
}

function parsePositiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} must be a positive integer, got '${value}'`);
  }
  return n;
}

function parsePositiveNumber(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${flag} must be a positive number, got '${value}'`);
  }
  return n;
}

function parseModes(value: string): Mode[] {
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) {
    throw new Error(`--modes must name at least one of full|optimized|slim`);
  }
  return names.map((name) => {
    if (name === 'full' || name === 'optimized' || name === 'slim') {
      return name;
    }
    throw new Error(`unknown mode '${name}' in --modes (expected full|optimized|slim)`);
  });
}

function parseIdList(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

async function isDir(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

async function assertFixtures(fixturesDir: string, suite: SuiteSpec): Promise<void> {
  if (!(await isDir(fixturesDir))) {
    throw new Error(
      `fixtures dir missing: ${fixturesDir} (expected next to the suite as <suiteDir>/../fixtures)`,
    );
  }
  for (const task of suite.tasks) {
    const dir = path.join(fixturesDir, task.fixture);
    if (!(await isDir(dir))) {
      throw new Error(`task '${task.id}': fixture dir missing: ${dir}`);
    }
  }
}

/** Shell out with stdin (hook commands are shell strings with quoted paths). */
function execWithInput(command: string, input: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = exec(
      command,
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, env },
      (error, stdout) => {
        if (error !== null) {
          reject(new Error(errorText(error)));
          return;
        }
        resolve(stdout);
      },
    );
    child.stdin?.end(input);
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Synthetic over-budget PostToolUse payload: distinct rows so only the
 * truncation tier fires and its marker line carries the style. ~51k chars
 * (~14.6k est tokens) clears every mode's touch and truncate thresholds. */
function markerStylePreflightPayload(): string {
  const rows = Array.from(
    { length: 900 },
    (_, i) => `row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur adipiscing`,
  ).join('\n');
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'echo preflight' },
    tool_use_id: 'toolu_preflight',
    tool_response: { stdout: rows, stderr: '', interrupted: false, isImage: false },
  });
}

/**
 * Preflight for marker-style experiments: the hook entry parses argv
 * fail-open, so a STALE dist/hook.js that predates --marker-style ignores
 * the flag silently and every arm measures identical 'plain' behavior — a
 * three-arm run of pure noise with zero errors anywhere. Verify the exact
 * installed hook command by piping the same over-budget payload through it
 * with two different styles and requiring the outputs to differ.
 * COMPRESSOR_NO_LEDGER keeps the probe out of the live savings ledger.
 */
export async function assertHookHandlesMarkerStyle(baseHookCommand: string): Promise<void> {
  const payload = markerStylePreflightPayload();
  const env = { ...process.env, COMPRESSOR_NO_LEDGER: '1' };
  const outputs: string[] = [];
  for (const style of ['plain', 'deterrent'] as const) {
    let stdout: string;
    try {
      stdout = await execWithInput(`${baseHookCommand} --marker-style ${style}`, payload, env);
    } catch (error) {
      throw new Error(
        `marker-style preflight: hook command failed (${baseHookCommand} --marker-style ${style}): ${errorText(error)}`,
      );
    }
    if (stdout.trim() === '') {
      throw new Error(
        `marker-style preflight: hook emitted nothing for an over-budget payload (${baseHookCommand} --marker-style ${style}) — the installed bundle is broken or stale; run 'npm run build' and retry`,
      );
    }
    outputs.push(stdout);
  }
  if (outputs[0] === outputs[1]) {
    throw new Error(
      `marker-style preflight: hook output is byte-identical for --marker-style plain and deterrent — the installed dist/hook.js ignores the flag (stale bundle); run 'npm run build' and retry, or the experiment arms would all measure 'plain'`,
    );
  }
}

async function assertClaudeAnswersVersion(bin: string): Promise<void> {
  try {
    // .mjs/.js bins (test stubs) are not directly executable: run via node
    if (/\.(mjs|js)$/.test(bin)) {
      await execFileAsync(process.execPath, [bin, '--version'], { timeout: 30_000 });
    } else {
      await execFileAsync(bin, ['--version'], { timeout: 30_000 });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `claude binary '${bin}' failed --version — install Claude Code (or point COMPRESSOR_CLAUDE_BIN at a working binary): ${detail}`,
    );
  }
}

export async function runBenchmarkCommand(opts: BenchmarkCliOptions): Promise<void> {
  const trials = parsePositiveInt(opts.trials, '--trials');
  const concurrency = parsePositiveInt(opts.concurrency, '--concurrency');
  const maxBudgetUsd = parsePositiveNumber(opts.maxBudgetUsd, '--max-budget-usd');
  const modes = parseModes(opts.modes);
  const suitePath = path.resolve(opts.suite);
  const outDir = path.resolve(opts.out);

  // preflight: every check below runs before any workspace or results file exists
  const suite = await loadSuite(suitePath);
  const fixturesDir = suiteFixturesDir(suitePath);
  await assertFixtures(fixturesDir, suite);

  const hookArgs = opts.hookArgs?.trim();
  const markerStyles = parseIdList(opts.markerStyles);
  const variants = buildVariants({
    modes,
    ablate: parseIdList(opts.ablate),
    ablateAdd: parseIdList(opts.ablateAdd),
    ablateGroups: parseIdList(opts.ablateGroup),
    hook: opts.hook,
    ...(hookArgs !== undefined && hookArgs !== '' ? { hookArgs } : {}),
    ...(markerStyles.length > 0 ? { markerStyles } : {}),
  });

  const hooked = variants.find((variant) => variant.hook);
  if (hooked !== undefined && hooked.baseMode !== 'full') {
    // throws 'run npm run build' when dist/hook.js is missing; absolute style
    // to match the cells (bench always measures the local build)
    const hookCommand = resolveHookCommand(hooked.baseMode, undefined, 'absolute');
    // a bundle that EXISTS can still predate --marker-style: verify it
    // before spending a single API dollar on indistinguishable arms
    if (variants.some((v) => v.hook && v.hookArgs?.includes('--marker-style') === true)) {
      await assertHookHandlesMarkerStyle(hookCommand);
    }
  }

  const bin = process.env.COMPRESSOR_CLAUDE_BIN;
  if (bin === undefined && (process.env.ANTHROPIC_API_KEY ?? '') === '') {
    throw new Error(
      'ANTHROPIC_API_KEY is not set: claude --bare never reads OAuth/keychain, so benchmarks need ANTHROPIC_API_KEY exported.',
    );
  }
  await assertClaudeAnswersVersion(bin ?? 'claude');

  const cellCount = suite.tasks.length * variants.length * trials;
  console.log(
    `${cellCount} cells: ${suite.tasks.length} tasks × ${variants.length} variants (${variants
      .map((variant) => variant.id)
      .join(', ')}) × ${trials} trials`,
  );
  console.log(`hard ceiling: $${maxBudgetUsd} (--max-budget-usd)`);

  const { runId, results, resultsFile } = await runBenchmark({
    suite,
    variants,
    trials,
    model: opts.model,
    maxBudgetUsd,
    concurrency,
    outDir,
    fixturesDir,
    onProgress: (line) => console.log(line),
  });

  console.log('');
  // post-run balance assertion: unbalanced variants invalidate comparisons
  const imbalance = balanceWarning(results);
  if (imbalance !== null) {
    console.log(imbalance);
  }
  console.log(`results: ${resultsFile}`);
  console.log(`next: compressor report --run ${runId} --out ${outDir}`);
}
