import { exec, execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { buildVariants } from '../../bench/ablate.ts';
import type { BenchAuth } from '../../bench/cell.ts';
import { COMPETITORS, competitorVariant, isCompetitor } from '../../bench/competitors.ts';
import { balanceWarning } from '../../bench/results.ts';
import { runBenchmark } from '../../bench/runner.ts';
import { loadSuite, suiteCompetitorsDir, suiteFixturesDir } from '../../bench/tasks.ts';
import type { SuiteSpec, Variant } from '../../bench/types.ts';
import type { Mode } from '../../engine/types.ts';
import { packageRoot, resolveHookCommand } from '../../paths.ts';

const execFileAsync = promisify(execFile);

export interface BenchmarkCliOptions {
  suite: string;
  modes: string;
  trials: string;
  model: string;
  /** 'api' (default, ANTHROPIC_API_KEY) or 'subscription' (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`) */
  auth?: string;
  /** subscription mode: hard executed-cell ceiling (default: all planned cells) */
  maxCells?: string;
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
  /**
   * comma-separated '<label>=<args>' arms: fans each hook-bearing variant out
   * into one arm per entry WITHIN this run (empty args = control arm), e.g.
   * 'budget-on=,budget-off=--recovery-budget off'
   */
  hookArgArms?: string;
  /** fan each hook-bearing variant into hook-on/hook-off arms (pure hook A/B) */
  hookArms?: boolean;
  /** competitor packs to add as output-only arms (e.g. 'caveman') for a head-to-head */
  competitor?: string[];
  concurrency: string;
  maxBudgetUsd: string;
  out: string;
}

/** '<label>=<args>,<label>=<args>' → arms; labels validated in buildVariants. */
export function parseHookArgArms(
  value: string | undefined,
): Array<{ label: string; args: string }> {
  if (value === undefined || value.trim() === '') {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const eq = entry.indexOf('=');
      if (eq <= 0) {
        throw new Error(
          `--hook-arg-arms: expected '<label>=<args>', got '${entry}' (empty args are allowed: 'control=')`,
        );
      }
      return { label: entry.slice(0, eq).trim(), args: entry.slice(eq + 1).trim() };
    });
}

function parseAuth(value: string | undefined): BenchAuth {
  if (value === undefined || value === 'api') {
    return 'api';
  }
  if (value === 'subscription') {
    return 'subscription';
  }
  throw new Error(`--auth must be 'api' or 'subscription', got '${value}'`);
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
// A FILE READ, not bash: CCR (Phase 2) supersedes the marker-style recovery
// clause for non-file (bash/search/MCP) output — plain and deterrent become
// byte-identical there (both carry a content-addressed retrieve handle). File
// reads are NOT CCR-eligible (staleness-proof re-read; CCR-PLAN §7/B), so their
// offset/limit markers still vary by style — the property this preflight needs
// to discriminate a flag-honoring bundle from a stale flag-blind one.
function markerStylePreflightPayload(): string {
  const filePath = '/preflight/marker-style-probe.txt';
  const rows = Array.from(
    { length: 900 },
    (_, i) =>
      `${String(i + 1).padStart(6)}→row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur`,
  ).join('\n');
  return JSON.stringify({
    session_id: 'preflight-marker-style-session',
    tool_name: 'Read',
    tool_input: { file_path: filePath },
    tool_use_id: 'toolu_preflight',
    tool_response: { type: 'text', file: { filePath, content: rows } },
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
/**
 * Treatment-delivery canaries — the guard born from the 2026-06-11
 * invalidation: every prior run used `--bare`, which silently ignores output
 * styles and hooks, so all arms were identical full baselines and $48 of
 * results were noise. Fail-open treatment means ABSENCE IS SILENT; the only
 * defense is proving delivery inside a real cell before any spend. Two micro
 * cells (haiku, ~$0.02 total, outside the run ceiling):
 *   style canary — a canary output style must visibly shape the reply;
 *   hook canary  — a canary PostToolUse hook must observably fire on a Read.
 * Either failing aborts the run with an actionable error. Skipped only under
 * COMPRESSOR_CLAUDE_BIN (the offline stub runs no styles/hooks by nature).
 */
export async function assertTreatmentDelivery(
  model = 'claude-haiku-4-5',
  auth: BenchAuth = 'api',
): Promise<void> {
  const runCanaryCell = async (
    label: string,
    setup: (workspace: string, scratch: string) => Promise<{ prompt: string; settings: Record<string, unknown> }>,
    check: (resultText: string, scratch: string) => Promise<string | null>,
  ): Promise<void> => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'compressor-canary-w-'));
    const scratch = await mkdtemp(path.join(tmpdir(), 'compressor-canary-s-'));
    try {
      const { prompt, settings } = await setup(workspace, scratch);
      const settingsFile = path.join(scratch, 'cell-settings.json');
      await writeFile(settingsFile, JSON.stringify(settings), 'utf8');
      // same auth discipline as cells: strip the other mode's credential so
      // the canary proves the EXACT billing path the run will use
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CLAUDE_CONFIG_DIR: scratch,
        COMPRESSOR_NO_LEDGER: '1',
      };
      delete env[auth === 'api' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'];
      const { stdout } = await execFileAsync(
        'claude',
        ['-p', prompt, '--output-format', 'json', '--model', model, '--settings', settingsFile],
        {
          cwd: workspace,
          env,
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      const parsed: unknown = JSON.parse(stdout);
      const resultText =
        typeof parsed === 'object' && parsed !== null
          ? String((parsed as Record<string, unknown>)['result'] ?? '')
          : '';
      const problem = await check(resultText, scratch);
      if (problem !== null) {
        throw new Error(
          `treatment-delivery canary FAILED (${label}): ${problem} — a run in this state would measure identical arms and produce noise; not spending. (Did the claude CLI change how cells receive styles/hooks?)`,
        );
      }
    } finally {
      await rm(workspace, { recursive: true, force: true }).catch(() => {});
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
  };

  await runCanaryCell(
    'output style',
    async (workspace, _scratch) => {
      const styleDir = path.join(workspace, '.claude', 'output-styles');
      await mkdir(styleDir, { recursive: true });
      await writeFile(
        path.join(styleDir, 'canary.md'),
        '---\ndescription: delivery canary\nkeep-coding-instructions: true\n---\n## Mandatory\nBegin every single reply with the exact word CANARY_STYLE_APPLIED in capitals.\n',
        'utf8',
      );
      return {
        prompt: 'Reply with the single word: done',
        settings: { permissions: { defaultMode: 'bypassPermissions' }, outputStyle: 'canary' },
      };
    },
    async (resultText) =>
      resultText.includes('CANARY_STYLE_APPLIED')
        ? null
        : `the canary output style did not shape the reply (got: ${JSON.stringify(resultText.slice(0, 80))})`,
  );

  await runCanaryCell(
    'PostToolUse hook',
    async (workspace, scratch) => {
      await writeFile(path.join(workspace, 'target.txt'), 'canary target\n', 'utf8');
      return {
        prompt: 'Use the Read tool to read target.txt, then reply with one word: done',
        settings: {
          permissions: { defaultMode: 'bypassPermissions' },
          hooks: {
            PostToolUse: [
              {
                matcher: 'Read',
                hooks: [{ type: 'command', command: `touch "${path.join(scratch, 'HOOK_FIRED')}"` }],
              },
            ],
          },
        },
      };
    },
    async (_resultText, scratch) => {
      try {
        await stat(path.join(scratch, 'HOOK_FIRED'));
        return null;
      } catch {
        return 'the canary PostToolUse hook never fired on a Read';
      }
    },
  );
}

/**
 * Preflight for recovery-budget experiments. Budget behavior is stateful, so
 * a single stateless call cannot discriminate a stale bundle: probe with a
 * hermetic recovery dir and a fixed session id — call 1 is an untargeted Read
 * that gets truncated (creating the truncation record), call 2 is a TARGETED
 * read of the same file under '--recovery-budget 0'. A bundle that honors the
 * flag compresses call 2 (non-empty stdout); a stale bundle passes it through
 * untouched (default budget 3) and every arm would measure identical behavior.
 */
export async function assertHookHandlesRecoveryBudget(baseHookCommand: string): Promise<void> {
  const recoveryDir = await mkdtemp(path.join(tmpdir(), 'compressor-preflight-recovery-'));
  const env = {
    ...process.env,
    COMPRESSOR_NO_LEDGER: '1',
    COMPRESSOR_RECOVERY_DIR: recoveryDir,
  };
  const filePath = '/preflight/recovery-probe.txt';
  const rows = Array.from(
    { length: 900 },
    (_, i) => `row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur adipiscing`,
  ).join('\n');
  const readPayload = (targeted: boolean): string =>
    JSON.stringify({
      session_id: 'preflight-recovery-session',
      tool_name: 'Read',
      tool_input: { file_path: filePath, ...(targeted ? { offset: 1, limit: 900 } : {}) },
      tool_use_id: 'toolu_preflight_recovery',
      tool_response: { type: 'text', file: { filePath, content: rows } },
    });
  try {
    const first = await execWithInput(baseHookCommand, readPayload(false), env);
    if (first.trim() === '') {
      throw new Error(
        `recovery-budget preflight: hook emitted nothing for an over-budget untargeted read (${baseHookCommand}) — broken or stale bundle; run 'npm run build' and retry`,
      );
    }
    const second = await execWithInput(
      `${baseHookCommand} --recovery-budget 0`,
      readPayload(true),
      env,
    );
    if (second.trim() === '') {
      throw new Error(
        `recovery-budget preflight: targeted read passed through despite '--recovery-budget 0' after a recorded truncation — the installed bundle ignores the flag (stale); run 'npm run build' and retry, or the experiment arms would be indistinguishable`,
      );
    }
  } finally {
    await rm(recoveryDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** A Bash (non-file) over-budget payload so the hook takes the CCR-eligible path
 * and its omission marker carries a `compressor retrieve <handle>` clause. */
function ccrPreflightBashPayload(): string {
  const rows = Array.from(
    { length: 4000 },
    (_, i) => `INFO line ${String(i).padStart(6, '0')} lorem ipsum dolor sit amet consectetur adipiscing elit`,
  ).join('\n');
  return JSON.stringify({
    session_id: 'preflight-ccr-session',
    tool_name: 'Bash',
    tool_input: { command: 'bash run.sh' },
    tool_use_id: 'toolu_preflight_ccr',
    tool_response: { stdout: rows, stderr: '', interrupted: false, isImage: false },
  });
}

/**
 * CCR delivery preflight (CCR-PATH-2 / CCR-2): the ON-arm only saves anything if
 * the model's `compressor retrieve <handle>` resolves to a build that HAS the
 * retrieve subcommand. A stale global on PATH (e.g. published 0.3.0) silently
 * emits empty stdout — indistinguishable from a real stash miss — and every
 * ON-arm cell produces a bogus savings figure. There is no way to tell after the
 * fact, so prove it before spending:
 *
 *   1. Pipe an over-budget Bash payload through the hook with `--ccr on` and a
 *      hermetic stash dir; require the marker to carry `compressor retrieve
 *      <handle>` (the engine stashed the cut bytes).
 *   2. Resolve `compressor` exactly as a cell will — on the cell PATH, which the
 *      runner has prepended bench/bin to — and run `compressor retrieve <handle>`
 *      against the SAME stash dir. Require it to print the stashed bytes. A
 *      retrieve-less binary fails here (commander 'unknown command', or empty).
 *   3. Run `compressor retrieve __preflight_missing__` and require the fresh-build
 *      MISS-NOTE shape ("not found ... re-run the original command"), proving the
 *      resolved binary is a positive `retrieve` implementation and not a stale one
 *      that merely exits nonzero.
 *
 * `cellPath` is the PATH the cells run with (runner prepends bench/bin); the
 * preflight uses it so a stale resolution fails fast with an actionable error.
 */
export async function assertCcrRetrieveWorks(
  baseHookCommand: string,
  cellPath: string,
): Promise<void> {
  const ccrDir = await mkdtemp(path.join(tmpdir(), 'compressor-preflight-ccr-'));
  const env = {
    ...process.env,
    PATH: cellPath,
    COMPRESSOR_NO_LEDGER: '1',
    COMPRESSOR_CCR_DIR: ccrDir,
  };
  try {
    const hookOut = await execWithInput(
      `${baseHookCommand} --ccr on`,
      ccrPreflightBashPayload(),
      env,
    );
    const handle = /compressor retrieve ([A-Za-z0-9_-]{16})/.exec(hookOut)?.[1];
    if (handle === undefined) {
      throw new Error(
        `CCR preflight: the hook did not stash a chunk / emit a 'compressor retrieve <handle>' marker for an over-budget Bash output (${baseHookCommand} --ccr on) — CCR is broken or the bundle is stale; run 'npm run build' and retry`,
      );
    }
    // resolve `compressor` on the CELL PATH and round-trip the stashed chunk
    let retrieved: string;
    try {
      const { stdout } = await execFileAsync('compressor', ['retrieve', handle], {
        env,
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      retrieved = stdout;
    } catch (error) {
      throw new Error(
        `CCR preflight: 'compressor retrieve ${handle}' failed on the cell PATH — the resolved 'compressor' is stale or lacks the retrieve subcommand (published builds before CCR do). Prepend ${path.join('bench', 'bin')} to PATH or rebuild ('npm run build'). Detail: ${errorText(error)}`,
      );
    }
    if (retrieved.trim() === '') {
      throw new Error(
        "CCR preflight: 'compressor retrieve <handle>' produced EMPTY stdout for a freshly-stashed chunk — the resolved binary is stale (a stale global silently returns nothing, indistinguishable from a real miss). Prepend bench/bin to PATH or rebuild.",
      );
    }
    // positive-capability: a missing handle must yield the FRESH miss-note shape,
    // not commander's "unknown command 'retrieve'" or a silent success.
    let missErr = '';
    try {
      await execFileAsync('compressor', ['retrieve', '_______missing_____'], {
        env,
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (error) {
      missErr = errorText(error);
    }
    if (/unknown command/i.test(missErr)) {
      throw new Error(
        "CCR preflight: 'compressor' on the cell PATH does not know the 'retrieve' subcommand (commander 'unknown command') — it is the stale published build. Prepend bench/bin to PATH or rebuild.",
      );
    }
  } finally {
    await rm(ccrDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function assertHookHandlesMarkerStyle(baseHookCommand: string): Promise<void> {
  const payload = markerStylePreflightPayload();
  // Disable the recovery budget for the probe: the payload is now a file Read,
  // and recording a truncation would otherwise write recovery state to the real
  // dir. (Bash payloads, which this used to be, never touched that state.)
  const env = {
    ...process.env,
    COMPRESSOR_NO_LEDGER: '1',
    COMPRESSOR_NO_RECOVERY_BUDGET: '1',
  };
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

  // competitor packs (real upstream assets) load from <suiteDir>/../competitors
  const competitorNames = opts.competitor ?? [];
  const competitors: Variant[] = [];
  for (const name of competitorNames) {
    if (!isCompetitor(name)) {
      throw new Error(`--competitor: unknown '${name}' (known: ${COMPETITORS.join(', ')})`);
    }
    competitors.push(await competitorVariant(name, suiteCompetitorsDir(suitePath)));
  }

  const hookArgs = opts.hookArgs?.trim();
  const markerStyles = parseIdList(opts.markerStyles);
  const hookArgArms = parseHookArgArms(opts.hookArgArms);
  const variants = buildVariants({
    modes,
    ablate: parseIdList(opts.ablate),
    ablateAdd: parseIdList(opts.ablateAdd),
    ablateGroups: parseIdList(opts.ablateGroup),
    hook: opts.hook,
    ...(hookArgs !== undefined && hookArgs !== '' ? { hookArgs } : {}),
    ...(markerStyles.length > 0 ? { markerStyles } : {}),
    ...(hookArgArms.length > 0 ? { hookArgArms } : {}),
    ...(opts.hookArms === true ? { hookArms: true } : {}),
    ...(competitors.length > 0 ? { competitors } : {}),
  });

  // Treatment-delivery canary for the CCR A/B (CCR-2): a malformed arm spec
  // fails OPEN toward CCR-ON (the more expensive arm) and silently, so when a
  // `--ccr` experiment is configured, REQUIRE exactly one arm to disable CCR and
  // at least one to leave it on — otherwise both arms measure the same treatment
  // and the run is pure noise. applyCcrArg recognizes only `--ccr off`/`--ccr on`.
  const hasCcrArm = hookArgArms.some((arm) => /(^|\s)--ccr(\s|$)/.test(arm.args));
  if (hasCcrArm) {
    const armCcrState = (args: string): 'off' | 'on' => {
      const m = /(?:^|\s)--ccr\s+(\S+)/.exec(args);
      const v = m?.[1];
      if (v !== undefined && v !== 'off' && v !== 'on') {
        throw new Error(
          `--hook-arg-arms: unrecognized '--ccr ${v}' (expected 'on' or 'off') — applyCcrArg would ignore it and the arm would fail toward CCR-ON, silently measuring the same treatment as the on-arm`,
        );
      }
      // applyCcrArg fail-open: only `off` disables CCR; anything else leaves it on
      return v === 'off' ? 'off' : 'on';
    };
    const offArms = hookArgArms.filter((arm) => armCcrState(arm.args) === 'off');
    const onArms = hookArgArms.filter((arm) => armCcrState(arm.args) === 'on');
    if (offArms.length !== 1 || onArms.length < 1) {
      throw new Error(
        `--hook-arg-arms CCR A/B requires exactly ONE arm with '--ccr off' and at least one without (CCR on); got ${offArms.length} off / ${onArms.length} on. Use e.g. --hook-arg-arms 'ccr-on=,ccr-off=--ccr off'.`,
      );
    }
  }

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
    if (variants.some((v) => v.hook && v.hookArgs?.includes('--recovery-budget') === true)) {
      await assertHookHandlesRecoveryBudget(hookCommand);
    }
    // CCR delivery preflight: prove the model's `compressor retrieve` resolves to
    // a build that HAS the subcommand, on the EXACT PATH cells run with (runner
    // prepends bench/bin). A stale global silently produces empty stdout that
    // looks like a real miss and inverts the savings number — fail fast instead.
    if (hasCcrArm || variants.some((v) => v.hook && v.hookArgs?.includes('--ccr') === true)) {
      const cellPath =
        path.join(packageRoot(), 'bench', 'bin') + path.delimiter + (process.env.PATH ?? '');
      await assertCcrRetrieveWorks(hookCommand, cellPath);
    }
  }

  const auth: BenchAuth = parseAuth(opts.auth);
  const bin = process.env.COMPRESSOR_CLAUDE_BIN;
  if (bin === undefined && auth === 'api' && (process.env.ANTHROPIC_API_KEY ?? '') === '') {
    throw new Error(
      'ANTHROPIC_API_KEY is not set: cells run with an isolated CLAUDE_CONFIG_DIR that has no credentials (verified: keyless cells fail with "Not logged in" — your OAuth subscription is unreachable), so API-billed benchmarks need ANTHROPIC_API_KEY exported. (To bill your Claude plan instead: --auth subscription with CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`.)',
    );
  }
  if (bin === undefined && auth === 'subscription') {
    if ((process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '') === '') {
      throw new Error(
        "--auth subscription needs CLAUDE_CODE_OAUTH_TOKEN exported: run `claude setup-token` once (interactive OAuth), then export the printed token (config.local is a sensible home). Cells strip ANTHROPIC_API_KEY so billing is deterministically your Claude plan.",
      );
    }
    console.log(
      'auth: subscription — cells bill YOUR Claude plan usage (5-hour windows / weekly caps), not API dollars. No per-cell cost exists; ceiling is --max-cells, progress shows tokens consumed. Big runs compete with your own usage — consider off-hours and modest --concurrency.',
    );
  }
  await assertClaudeAnswersVersion(bin ?? 'claude');

  if (bin === undefined) {
    // real binary: prove styles + hooks actually reach cells before spending
    // (the stub neither styles nor hooks by nature — gated, documented).
    // Canaries run under the SAME auth as cells: a dead setup-token fails
    // here, before any capacity is consumed on real cells.
    await assertTreatmentDelivery('claude-haiku-4-5', auth);
    console.log('treatment-delivery canaries passed (output style + PostToolUse hook)');
  }

  const cellCount = suite.tasks.length * variants.length * trials;
  console.log(
    `${cellCount} cells: ${suite.tasks.length} tasks × ${variants.length} variants (${variants
      .map((variant) => variant.id)
      .join(', ')}) × ${trials} trials`,
  );
  console.log(
    auth === 'api'
      ? `hard ceiling: $${maxBudgetUsd} (--max-budget-usd)`
      : `hard ceiling: ${opts.maxCells ?? 'all planned'} cells (--max-cells) — plan-billed, no dollar accounting exists`,
  );

  const maxCells =
    opts.maxCells === undefined ? undefined : parsePositiveInt(opts.maxCells, '--max-cells');
  const { runId, results, resultsFile } = await runBenchmark({
    suite,
    variants,
    trials,
    model: opts.model,
    maxBudgetUsd,
    concurrency,
    outDir,
    fixturesDir,
    auth,
    ...(maxCells !== undefined ? { maxCells } : {}),
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
