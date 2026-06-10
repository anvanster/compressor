import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { buildVariants } from '../../bench/ablate.ts';
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
  /** commander --no-hook: defaults true */
  hook: boolean;
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

  const variants = buildVariants({
    modes,
    ablate: parseIdList(opts.ablate),
    ablateAdd: parseIdList(opts.ablateAdd),
    hook: opts.hook,
  });

  const hooked = variants.find((variant) => variant.hook);
  if (hooked !== undefined && hooked.baseMode !== 'full') {
    resolveHookCommand(hooked.baseMode); // throws 'run npm run build' when dist/hook.js is missing
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

  const { runId, resultsFile } = await runBenchmark({
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
  console.log(`results: ${resultsFile}`);
  console.log(`next: compressor report --run ${runId} --out ${outDir}`);
}
