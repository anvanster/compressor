import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVariants } from '../../src/bench/ablate.ts';
import { readRun } from '../../src/bench/results.ts';
import { runBenchmark } from '../../src/bench/runner.ts';
import { loadSuite, suiteFixturesDir } from '../../src/bench/tasks.ts';
import { encodeProjectDir } from '../../src/claude/transcripts.ts';

const FAKE_CLAUDE = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url));
const SUITE_PATH = fileURLToPath(
  new URL('../../bench/suites/interactive.json', import.meta.url),
);

process.env.COMPRESSOR_CLAUDE_BIN = FAKE_CLAUDE;
process.env.FAKE_CLAUDE_FIXTURES_DIR = suiteFixturesDir(SUITE_PATH);
// see e2e.test.ts: an inherited NODE_TEST_CONTEXT makes nested `node --test`
// checks exit 0 even on failure — strip it so command checks judge honestly
delete process.env.NODE_TEST_CONTEXT;

/** The stub reports this usage in every turn's result JSON (and transcript). */
const PER_TURN_USAGE = { input: 9000, output: 400, cacheCreation: 2000, cacheRead: 30000 };

function scaledUsage(turns: number): typeof PER_TURN_USAGE {
  return {
    input: PER_TURN_USAGE.input * turns,
    output: PER_TURN_USAGE.output * turns,
    cacheCreation: PER_TURN_USAGE.cacheCreation * turns,
    cacheRead: PER_TURN_USAGE.cacheRead * turns,
  };
}

test('offline multi-turn e2e: 1 interactive task × 2 variants via fake --resume', async (t) => {
  process.env.FAKE_CLAUDE_SUCCEED = '1';
  const outDir = await mkdtemp(join(tmpdir(), 'bench-interactive-'));
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_SUCCEED;
    await rm(outDir, { recursive: true, force: true });
  });

  const interactive = await loadSuite(SUITE_PATH);
  const task = interactive.tasks.find((spec) => spec.id === 'add-function-conversation');
  assert.ok(task);
  assert.ok(task.turns);
  const totalTurns = task.turns.length + 1; // opening prompt + scripted turns

  const variants = buildVariants({
    modes: ['full', 'slim'],
    ablate: [],
    ablateAdd: [],
    ablateGroups: [],
    hook: false,
  });

  const { runId, results } = await runBenchmark({
    suite: { name: 'interactive-e2e', tasks: [task] },
    variants,
    trials: 1,
    model: 'test-model',
    maxBudgetUsd: 5,
    concurrency: 2,
    outDir,
    fixturesDir: suiteFixturesDir(SUITE_PATH),
  });

  assert.equal(results.length, 2);
  for (const row of results) {
    assert.equal(row.error, undefined, `${row.variantId}: ${row.error}`);
    // the fixture ships broken; the stub's turn-1 patch makes the final check pass
    assert.equal(row.baselineCheckPassed, false);
    assert.equal(row.success, true);

    // one usage entry per turn, each from that turn's result JSON
    assert.ok(row.turnUsage, `${row.variantId}: turnUsage missing`);
    assert.equal(row.turnUsage.length, totalTurns);
    for (const usage of row.turnUsage) {
      assert.deepEqual(usage, PER_TURN_USAGE);
    }

    // cell usage is the FINAL transcript deduped by requestId — the stub
    // appends 2 uniquely-keyed entries per turn, so it equals turns × per-turn
    assert.deepEqual(row.usage, scaledUsage(totalTurns));

    // per-invocation totals sum across turns
    assert.ok(typeof row.costUsd === 'number');
    assert.ok(Math.abs(row.costUsd - 0.01 * totalTurns) < 1e-9, `costUsd ${row.costUsd}`);
    assert.equal(row.durationMs, 1200 * totalTurns);
    assert.equal(row.numTurns, 3 * totalTurns);
    assert.equal(row.permissionDenials, 0);

    // session id stable across turns: all 4 turns landed in ONE transcript
    // (otherwise the deduped totals above could not equal 4× per-turn), and
    // tool calls from every turn are visible in the final transcript
    assert.ok(row.sessionId?.startsWith('fake-'));
    assert.deepEqual(row.toolCalls, { Read: totalTurns, Bash: totalTurns });
  }

  // results file rows round-trip with turnUsage intact
  const { results: persisted } = await readRun(outDir, runId);
  assert.equal(persisted.length, 2);
  for (const row of persisted) {
    assert.equal(row.runId, runId);
    assert.ok(Array.isArray(row.turnUsage));
    assert.equal(row.turnUsage?.length, totalTurns);
    assert.deepEqual(row.usage, scaledUsage(totalTurns));
  }
});

test('stub: --resume reuses the session id and appends to the transcript', async (t) => {
  // realpath so encodeProjectDir(workspace) matches the cwd the child reports
  // (macOS tmpdir lives under the /var → /private/var symlink)
  const configDir = await realpath(await mkdtemp(join(tmpdir(), 'fake-claude-cfg-')));
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'fake-claude-ws-')));
  t.after(async () => {
    await rm(configDir, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  const run = (args: string[]): Record<string, unknown> => {
    const stdout = execFileSync(process.execPath, [FAKE_CLAUDE, ...args], {
      cwd: workspace,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      encoding: 'utf8',
    });
    return JSON.parse(stdout) as Record<string, unknown>;
  };

  const base = ['--output-format', 'json', '--model', 'm'];
  const first = run([...base, '-p', 'first question']);
  const sessionId = first['session_id'];
  assert.ok(typeof sessionId === 'string' && sessionId.startsWith('fake-'));

  const second = run([...base, '-p', 'follow-up', '--resume', sessionId]);
  assert.equal(second['session_id'], sessionId, 'resume must keep the session id');
  assert.match(String(second['result']), /turn=2/);
  const third = run([...base, '-p', 'another follow-up', '--resume', sessionId]);
  assert.equal(third['session_id'], sessionId);
  assert.match(String(third['result']), /turn=3/);

  // the transcript accumulated all three turns with unique requestIds
  const transcript = await readFile(
    join(configDir, 'projects', encodeProjectDir(workspace), `${sessionId}.jsonl`),
    'utf8',
  );
  const lines = transcript.trim().split('\n');
  assert.equal(lines.length, 6, 'expected 2 transcript entries per turn × 3 turns');
  const requestIds = lines.map((line) => (JSON.parse(line) as { requestId: string }).requestId);
  assert.equal(new Set(requestIds).size, 6, `requestIds not unique: ${requestIds.join(', ')}`);
  for (const line of lines) {
    assert.equal((JSON.parse(line) as { sessionId: string }).sessionId, sessionId);
  }
});

test('a turn failure errors the cell but keeps usage for completed turns', async (t) => {
  process.env.FAKE_CLAUDE_SUCCEED = '1';
  process.env.FAKE_CLAUDE_FAIL_ON_RESUME = '1';
  const outDir = await mkdtemp(join(tmpdir(), 'bench-interactive-fail-'));
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_SUCCEED;
    delete process.env.FAKE_CLAUDE_FAIL_ON_RESUME;
    await rm(outDir, { recursive: true, force: true });
  });

  const interactive = await loadSuite(SUITE_PATH);
  const task = interactive.tasks.find((spec) => spec.id === 'add-function-conversation');
  assert.ok(task);

  const { results } = await runBenchmark({
    suite: { name: 'interactive-fail', tasks: [task] },
    variants: [
      { id: 'full', baseMode: 'full', styleBody: null, styleName: null, hook: false },
    ],
    trials: 1,
    model: 'test-model',
    maxBudgetUsd: 5,
    concurrency: 1,
    outDir,
    fixturesDir: suiteFixturesDir(SUITE_PATH),
  });

  assert.equal(results.length, 1);
  const row = results[0];
  assert.ok(row);
  // the first --resume turn (turn 2 of 4) failed — cell errors with the label
  assert.match(row.error ?? '', /^turn 2\/4: /);
  assert.equal(row.success, null);
  assert.equal(row.sessionId, null);
  // ...but the completed opening turn's usage is preserved
  assert.deepEqual(row.turnUsage, [PER_TURN_USAGE]);
  // usage stays CONSISTENT with turnUsage on the error path: completed turns
  // are summed, never zeroed — an aggregator summing `usage` and one summing
  // `turnUsage` must agree on real spend
  assert.deepEqual(row.usage, PER_TURN_USAGE);
  // the completed turn's cost is reported so the budget ceiling sees it —
  // a systematic resume failure burns real money on every errored cell
  assert.equal(row.costUsd, 0.01);
});

test('partial cost from failed cells counts against the budget ceiling', async (t) => {
  process.env.FAKE_CLAUDE_SUCCEED = '1';
  process.env.FAKE_CLAUDE_FAIL_ON_RESUME = '1';
  const outDir = await mkdtemp(join(tmpdir(), 'bench-interactive-budget-'));
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_SUCCEED;
    delete process.env.FAKE_CLAUDE_FAIL_ON_RESUME;
    await rm(outDir, { recursive: true, force: true });
  });

  const interactive = await loadSuite(SUITE_PATH);
  const task = interactive.tasks.find((spec) => spec.id === 'add-function-conversation');
  assert.ok(task);

  // every cell fails on its first --resume turn after burning turn 1
  // ($0.01); with a $0.015 ceiling the third trial must be skipped by the
  // BUDGET stop (under the old cost-discarding behavior these cells reported
  // costUsd null, spentUsd stayed 0, and trial 3 would run)
  const { results } = await runBenchmark({
    suite: { name: 'interactive-partial-cost', tasks: [task] },
    variants: [
      { id: 'full', baseMode: 'full', styleBody: null, styleName: null, hook: false },
    ],
    trials: 3,
    model: 'test-model',
    maxBudgetUsd: 0.015,
    concurrency: 1,
    outDir,
    fixturesDir: suiteFixturesDir(SUITE_PATH),
  });

  assert.equal(results.length, 3);
  const [first, second, third] = results;
  assert.ok(first && second && third);
  assert.match(first.error ?? '', /^turn 2\/4: /);
  assert.equal(first.costUsd, 0.01);
  assert.match(second.error ?? '', /^turn 2\/4: /);
  assert.equal(second.costUsd, 0.01);
  // $0.02 spent ≥ $0.015 ceiling — invisible-spend bug would run this cell
  assert.equal(third.error, 'skipped: budget ceiling 0.015 USD reached');
});

test('a forked resume without history is flagged as usage data-quality suspect', async (t) => {
  process.env.FAKE_CLAUDE_SUCCEED = '1';
  process.env.FAKE_CLAUDE_FORK_ON_RESUME = '1';
  const outDir = await mkdtemp(join(tmpdir(), 'bench-interactive-fork-'));
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_SUCCEED;
    delete process.env.FAKE_CLAUDE_FORK_ON_RESUME;
    await rm(outDir, { recursive: true, force: true });
  });

  const interactive = await loadSuite(SUITE_PATH);
  const task = interactive.tasks.find((spec) => spec.id === 'add-function-conversation');
  assert.ok(task);
  assert.ok(task.turns);
  const totalTurns = task.turns.length + 1;

  const { results } = await runBenchmark({
    suite: { name: 'interactive-fork', tasks: [task] },
    variants: [
      { id: 'full', baseMode: 'full', styleBody: null, styleName: null, hook: false },
    ],
    trials: 1,
    model: 'test-model',
    maxBudgetUsd: 5,
    concurrency: 1,
    outDir,
    fixturesDir: suiteFixturesDir(SUITE_PATH),
  });

  assert.equal(results.length, 1);
  const row = results[0];
  assert.ok(row);
  // every turn completed, so turnUsage covers the whole conversation...
  assert.equal(row.turnUsage?.length, totalTurns);
  // ...but the final transcript holds ONLY the last forked turn: the
  // transcript-derived cell usage silently undercounts to ~1 turn. The
  // cross-check must flag the cell instead of reporting it as clean data.
  assert.match(row.error ?? '', /usage data-quality/);
  assert.match(row.error ?? '', /diverge/);
  assert.deepEqual(row.usage, PER_TURN_USAGE);
  assert.ok(row.sessionId?.includes('-fork-'));
});
