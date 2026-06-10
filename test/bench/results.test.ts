import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CellResult, RunMeta } from '../../src/bench/types.ts';
import {
  aggregate,
  appendResult,
  newRunId,
  readRun,
  writeRunMeta,
} from '../../src/bench/results.ts';

function row(partial: Partial<CellResult> & { variantId: string }): CellResult {
  return {
    runId: 'bench-test',
    taskId: 't1',
    trial: 1,
    model: 'm',
    servedModels: ['m'],
    baselineCheckPassed: null,
    success: true,
    usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    costUsd: 0.01,
    durationMs: 100,
    numTurns: 1,
    permissionDenials: 0,
    toolCalls: {},
    sessionId: 's',
    timestamp: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

test('newRunId is bench-yyyymmdd-hhmmss', () => {
  assert.match(newRunId(), /^bench-\d{8}-\d{6}$/);
});

test('append/read round-trip tolerates garbage lines', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'bench-results-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const runId = 'bench-20260101-000000';

  const a = row({ variantId: 'v1', taskId: 'task-a' });
  const b = row({ variantId: 'v2', taskId: 'task-b', success: false, error: 'boom' });
  const file = await appendResult(outDir, runId, a);
  await appendFile(file, 'not json at all {\n[1,2,3]\n"just a string"\n42\n');
  await appendResult(outDir, runId, b);

  const meta: RunMeta = {
    runId,
    suite: 'smoke',
    variantIds: ['v1', 'v2'],
    model: 'm',
    trials: 1,
    startedAt: '2026-01-01T00:00:00.000Z',
    maxBudgetUsd: 5,
  };
  await writeRunMeta(outDir, meta);

  const run = await readRun(outDir, runId);
  assert.deepEqual(run.meta, meta);
  assert.equal(run.results.length, 2);
  assert.deepEqual(run.results[0], a);
  assert.deepEqual(run.results[1], b);
});

test('readRun on a missing run yields null meta and no results', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'bench-results-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const run = await readRun(outDir, 'bench-nope');
  assert.equal(run.meta, null);
  assert.deepEqual(run.results, []);
});

test('aggregate: medians/IQR over non-error cells, even count', () => {
  const results: CellResult[] = [
    row({
      variantId: 'a',
      success: true,
      costUsd: 0.01,
      usage: { input: 100, output: 10, cacheCreation: 10, cacheRead: 1000 },
      durationMs: 100,
      numTurns: 1,
      toolCalls: { Read: 2 },
    }),
    row({
      variantId: 'a',
      success: true,
      costUsd: 0.02,
      usage: { input: 200, output: 20, cacheCreation: 20, cacheRead: 2000 },
      durationMs: 200,
      numTurns: 2,
      toolCalls: { Read: 1, Bash: 3 },
    }),
    row({
      variantId: 'a',
      success: false,
      costUsd: 0.03,
      usage: { input: 300, output: 30, cacheCreation: 30, cacheRead: 3000 },
      durationMs: 300,
      numTurns: 3,
    }),
    row({
      variantId: 'a',
      success: null,
      costUsd: null,
      usage: { input: 400, output: 40, cacheCreation: 40, cacheRead: 4000 },
      durationMs: 400,
      numTurns: 4,
    }),
    // error cell: excluded from every aggregate except cells/errors
    row({
      variantId: 'a',
      success: null,
      error: 'claude exploded',
      costUsd: 9,
      usage: { input: 9999, output: 9999, cacheCreation: 9999, cacheRead: 9999 },
      toolCalls: { Bash: 99 },
    }),
  ];

  const aggs = aggregate(results);
  assert.equal(aggs.length, 1);
  const a = aggs[0];
  assert.ok(a);
  assert.equal(a.variantId, 'a');
  assert.equal(a.cells, 5);
  assert.equal(a.errors, 1);
  assert.equal(a.valid, 4);
  assert.equal(a.successRate, 2 / 3);
  assert.equal(a.medianInput, 250);
  assert.equal(a.medianOutput, 25);
  assert.equal(a.medianCacheCreation, 25);
  assert.equal(a.medianCacheRead, 2500);
  assert.equal(a.medianCostUsd, 0.02);
  assert.equal(a.medianDurationMs, 250);
  assert.equal(a.medianTurns, 2.5);
  assert.deepEqual(a.iqrOutput, [17.5, 32.5]);
  assert.deepEqual(a.toolCallTotals, { Read: 3, Bash: 3 });
});

test('aggregate: odd count and all-error variants', () => {
  const results: CellResult[] = [
    row({ variantId: 'b', usage: { input: 0, output: 1, cacheCreation: 0, cacheRead: 0 } }),
    row({ variantId: 'b', usage: { input: 0, output: 5, cacheCreation: 0, cacheRead: 0 } }),
    row({ variantId: 'b', usage: { input: 0, output: 100, cacheCreation: 0, cacheRead: 0 } }),
    row({ variantId: 'c', success: null, costUsd: null, error: 'skipped: budget' }),
  ];

  const aggs = aggregate(results);
  const b = aggs.find((x) => x.variantId === 'b');
  assert.ok(b);
  assert.equal(b.cells, 3);
  assert.equal(b.errors, 0);
  assert.equal(b.valid, 3);
  assert.equal(b.successRate, 1);
  assert.equal(b.medianOutput, 5);
  assert.deepEqual(b.iqrOutput, [3, 52.5]);

  const c = aggs.find((x) => x.variantId === 'c');
  assert.ok(c);
  assert.equal(c.cells, 1);
  assert.equal(c.errors, 1);
  assert.equal(c.valid, 0);
  assert.equal(c.successRate, null);
  assert.equal(c.medianCostUsd, null);
  assert.equal(c.medianOutput, 0);
  assert.deepEqual(c.iqrOutput, [0, 0]);
  assert.deepEqual(c.toolCallTotals, {});
});
