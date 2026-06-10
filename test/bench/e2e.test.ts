import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVariants } from '../../src/bench/ablate.ts';
import { aggregate, readRun } from '../../src/bench/results.ts';
import { runBenchmark } from '../../src/bench/runner.ts';
import { loadSuite, suiteFixturesDir } from '../../src/bench/tasks.ts';
import {
  buildRunReport,
  formatReport,
  formatComparison,
} from '../../src/cli/commands/report.ts';

const FAKE_CLAUDE = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url));
const SUITE_PATH = fileURLToPath(new URL('../../bench/suites/basic.json', import.meta.url));

process.env.COMPRESSOR_CLAUDE_BIN = FAKE_CLAUDE;
// the workspace never contains fix.patch.json (answer-key leak); the stub
// "solves" tasks by reading patches from the fixture source dir instead
process.env.FAKE_CLAUDE_FIXTURES_DIR = suiteFixturesDir(SUITE_PATH);

// node:test exports NODE_TEST_CONTEXT to its child processes; a nested
// `node --test test.mjs` cell check inheriting it exits 0 even on failures,
// which would make every command check vacuously pass. Strip it so the suite's
// real checks judge honestly. (Verified: with it set, failing tests exit 0.)
delete process.env.NODE_TEST_CONTEXT;

const COMMAND_TASKS = [
  'bugfix-off-by-one',
  'add-function',
  'refactor-extract',
  'diagnose-failing-test',
  'large-file-edit',
];

test('offline e2e: real suite + fixtures through runner, aggregation, and report', async (t) => {
  process.env.FAKE_CLAUDE_SUCCEED = '1';
  const outDir = await mkdtemp(join(tmpdir(), 'bench-e2e-'));
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_SUCCEED;
    await rm(outDir, { recursive: true, force: true });
  });

  const suite = await loadSuite(SUITE_PATH);
  assert.equal(suite.tasks.length, 6);
  const variants = buildVariants({
    modes: ['full', 'slim'],
    ablate: [],
    ablateAdd: [],
    hook: false,
  });

  const { runId, results } = await runBenchmark({
    suite,
    variants,
    trials: 1,
    model: 'test-model',
    maxBudgetUsd: 5,
    concurrency: 3,
    outDir,
    fixturesDir: suiteFixturesDir(SUITE_PATH),
  });

  // 6 tasks × 2 variants × 1 trial
  assert.equal(results.length, 12);
  assert.deepEqual(
    results.filter((r) => r.error !== undefined).map((r) => `${r.taskId}: ${r.error}`),
    [],
  );

  const byKey = new Map(results.map((r) => [`${r.taskId}/${r.variantId}`, r]));
  for (const taskId of COMMAND_TASKS) {
    for (const variantId of ['full', 'slim']) {
      const row = byKey.get(`${taskId}/${variantId}`);
      assert.ok(row, `missing cell ${taskId}/${variantId}`);
      // non-vacuous fixture: the check failed before the agent ran, passed after
      assert.equal(row.baselineCheckPassed, false, `${taskId}/${variantId} baseline`);
      assert.equal(row.success, true, `${taskId}/${variantId} success`);
    }
  }

  // The answer-regex task judges the stub's canned text against the REAL
  // shipped pattern (/beforeDispatch/), which the canned text does not contain.
  // Offline e2e validates plumbing, not model quality — the observed
  // deterministic outcome is failure, and that is what we assert.
  for (const variantId of ['full', 'slim']) {
    const row = byKey.get(`explain-codebase/${variantId}`);
    assert.ok(row);
    assert.equal(row.baselineCheckPassed, null);
    assert.equal(row.success, false);
  }

  const aggregates = aggregate(results);
  assert.equal(aggregates.length, 2);
  assert.deepEqual(new Set(aggregates.map((a) => a.variantId)), new Set(['full', 'slim']));
  for (const agg of aggregates) {
    assert.equal(agg.cells, 6);
    assert.equal(agg.errors, 0);
    assert.equal(agg.successRate, 5 / 6);
    // stub reports fixed usage per cell, so medians equal those constants
    assert.equal(agg.medianInput, 9000);
    assert.equal(agg.medianOutput, 400);
    assert.equal(agg.medianCacheCreation, 2000);
    assert.equal(agg.medianCacheRead, 30000);
    assert.equal(agg.medianCostUsd, 0.01);
    assert.equal(agg.medianDurationMs, 1200);
    assert.equal(agg.medianTurns, 3);
  }

  // report aggregation/formatting exercised directly (no subprocess)
  const { meta } = await readRun(outDir, runId);
  assert.ok(meta);
  const report = buildRunReport(runId, meta, results);
  assert.equal(report.aggregates.length, 2);
  assert.ok(report.deltas);
  const slimDelta = report.deltas.find((d) => d.variantId === 'slim');
  assert.ok(slimDelta);
  assert.equal(slimDelta.outputPct, 0);
  assert.equal(slimDelta.costPct, 0);
  assert.equal(slimDelta.successPp, 0);
  assert.deepEqual(report.issues.vacuousTasks, []);
  assert.deepEqual(report.issues.substitutedCells, []);
  assert.deepEqual(report.issues.errorCells, []);

  const table = formatReport(report, 'table');
  assert.ok(table.includes('full'));
  assert.ok(table.includes('slim'));
  assert.ok(!/estimat/i.test(table), 'actual usage must never be labeled estimated');

  const md = formatReport(report, 'md');
  assert.ok(md.includes('| variant |'));
  assert.ok(md.includes('| full |'));

  const json: unknown = JSON.parse(formatReport(report, 'json'));
  assert.ok(typeof json === 'object' && json !== null);
  assert.equal((json as { runId?: unknown }).runId, runId);

  const comparison = formatComparison(report, report, 'table');
  assert.ok(comparison.includes('slim'));
});
