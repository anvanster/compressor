import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CellResult } from '../../src/bench/types.ts';
import { aggregate } from '../../src/bench/results.ts';
import {
  buildRunReport,
  computeAblationDeltas,
  computeDeltas,
  findIssues,
  formatReport,
} from '../../src/cli/commands/report.ts';

function row(partial: Partial<CellResult> & { variantId: string }): CellResult {
  return {
    runId: 'bench-test',
    taskId: 't1',
    trial: 1,
    model: 'm',
    servedModels: ['m'],
    baselineCheckPassed: null,
    success: true,
    usage: { input: 1000, output: 400, cacheCreation: 0, cacheRead: 0 },
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

test('a variant whose every cell errored yields null deltas, never output -100%', () => {
  const aggregates = aggregate([
    row({ variantId: 'full' }),
    row({ variantId: 'x', success: null, costUsd: null, error: 'boom' }),
  ]);
  const deltas = computeDeltas(aggregates);
  assert.ok(deltas);
  const x = deltas.find((d) => d.variantId === 'x');
  assert.ok(x);
  assert.equal(x.outputPct, null);
  assert.equal(x.costPct, null);
  assert.equal(x.successPp, null);

  // and an all-error FULL baseline nulls every variant's deltas too
  const aggregates2 = aggregate([
    row({ variantId: 'full', success: null, costUsd: null, error: 'boom' }),
    row({ variantId: 'y' }),
  ]);
  const deltas2 = computeDeltas(aggregates2);
  assert.ok(deltas2);
  assert.equal(deltas2[0]?.outputPct, null);
});

test('ablation variants get marginal deltas vs their own baseline, not only vs full', () => {
  const results: CellResult[] = [
    row({ variantId: 'optimized', usage: { input: 0, output: 400, cacheCreation: 0, cacheRead: 0 } }),
    row({
      variantId: 'optimized-minus-out-no-preamble',
      usage: { input: 0, output: 500, cacheCreation: 0, cacheRead: 0 },
      success: false,
    }),
    row({ variantId: 'slim', usage: { input: 0, output: 200, cacheCreation: 0, cacheRead: 0 } }),
    row({
      variantId: 'slim-minus-out-code-only-default',
      usage: { input: 0, output: 300, cacheCreation: 0, cacheRead: 0 },
    }),
  ];
  const groups = computeAblationDeltas(aggregate(results));
  assert.ok(groups);
  assert.deepEqual(
    groups.map((g) => g.baselineId),
    ['optimized', 'slim'],
  );

  const opt = groups.find((g) => g.baselineId === 'optimized');
  assert.ok(opt);
  assert.equal(opt.deltas.length, 1);
  const minusPreamble = opt.deltas[0];
  assert.ok(minusPreamble);
  assert.equal(minusPreamble.variantId, 'optimized-minus-out-no-preamble');
  assert.equal(minusPreamble.outputPct, 25);
  assert.equal(minusPreamble.successPp, -100);

  const slim = groups.find((g) => g.baselineId === 'slim');
  assert.ok(slim);
  assert.equal(slim.deltas[0]?.outputPct, 50);

  // the gate must be answerable WITHOUT a full variant in the run:
  // --modes optimized --ablate ... still produces an ablation section
  const report = buildRunReport('bench-test', null, results);
  assert.equal(report.deltas, null);
  assert.ok(report.ablationDeltas);
  const table = formatReport(report, 'table');
  assert.match(table, /ablation deltas vs optimized/);
  assert.match(table, /optimized-minus-out-no-preamble: output \+25\.0%/);
  assert.match(table, /ablation deltas vs slim/);
  const md = formatReport(report, 'md');
  assert.match(md, /## Ablation deltas vs optimized/);
  assert.match(md, /## Ablation deltas vs slim/);
});

test('no ablation variants -> ablationDeltas is null', () => {
  const aggregates = aggregate([row({ variantId: 'full' }), row({ variantId: 'optimized' })]);
  assert.equal(computeAblationDeltas(aggregates), null);
});

test('served dated model ID for a requested alias is not flagged as substitution', () => {
  const issues = findIssues([
    row({
      variantId: 'full',
      model: 'claude-haiku-4-5',
      servedModels: ['claude-haiku-4-5-20251001'],
    }),
    row({ variantId: 'full', trial: 2, model: 'haiku', servedModels: ['claude-haiku-4-5-20251001'] }),
  ]);
  assert.deepEqual(issues.substitutedCells, []);
  assert.deepEqual(issues.unknownServedCells, []);
});

test('true model substitution is still flagged; missing modelUsage is reported as unknown, not substituted', () => {
  const issues = findIssues([
    row({
      variantId: 'full',
      model: 'claude-sonnet-4-6',
      servedModels: ['claude-haiku-4-5-20251001'],
    }),
    row({ variantId: 'full', trial: 2, model: 'claude-sonnet-4-6', servedModels: [] }),
  ]);
  assert.equal(issues.substitutedCells.length, 1);
  assert.match(issues.substitutedCells[0] ?? '', /requested claude-sonnet-4-6, served \[claude-haiku-4-5-20251001\]/);
  assert.equal(issues.unknownServedCells.length, 1);
  assert.match(issues.unknownServedCells[0] ?? '', /no modelUsage/);

  const report = buildRunReport('bench-test', null, [
    row({ variantId: 'full', model: 'claude-sonnet-4-6', servedModels: [] }),
  ]);
  assert.match(formatReport(report, 'table'), /SERVED MODEL UNKNOWN/);
});

test('cells with permission denials are flagged — denial retries inflate usage', () => {
  const issues = findIssues([
    row({ variantId: 'full', permissionDenials: 3 }),
    row({ variantId: 'full', trial: 2 }),
  ]);
  assert.equal(issues.deniedCells.length, 1);
  assert.match(issues.deniedCells[0] ?? '', /3 permission denial/);

  const report = buildRunReport('bench-test', null, [
    row({ variantId: 'full', permissionDenials: 1 }),
  ]);
  assert.match(formatReport(report, 'table'), /PERMISSION DENIALS/);
});

test('budget-skipped cells are a distinct category, not lumped under infra errors', () => {
  const results: CellResult[] = [
    row({ variantId: 'full' }),
    row({
      variantId: 'full',
      trial: 2,
      success: null,
      costUsd: null,
      error: 'skipped: budget ceiling 5 USD reached',
    }),
    row({
      variantId: 'full',
      trial: 3,
      success: null,
      costUsd: null,
      error: 'claude exploded',
    }),
  ];
  const issues = findIssues(results);
  assert.equal(issues.skippedCells.length, 1);
  assert.match(issues.skippedCells[0] ?? '', /skipped: budget ceiling/);
  assert.equal(issues.errorCells.length, 1);
  assert.match(issues.errorCells[0] ?? '', /claude exploded/);

  const table = formatReport(buildRunReport('bench-test', null, results), 'table');
  assert.match(table, /SKIPPED \(1 cells, never scheduled\)/);
  assert.match(table, /INFRA ERRORS \(1 cells/);
});

test('table and md formats render output IQR and per-variant tool-call totals', () => {
  const results: CellResult[] = [10, 20, 30, 40].map((output, i) =>
    row({
      variantId: 'optimized',
      trial: i + 1,
      usage: { input: 0, output, cacheCreation: 0, cacheRead: 0 },
      toolCalls: { Read: 2, Bash: 1 },
    }),
  );
  const report = buildRunReport('bench-test', null, results);

  const table = formatReport(report, 'table');
  assert.match(table, /out IQR/);
  // quantile([10,20,30,40]) -> p25 17.5, p75 32.5; fmtInt rounds
  assert.match(table, /18–33/);
  assert.match(table, /tool calls by tool:/);
  assert.match(table, /optimized: Bash 4, Read 8/);

  const md = formatReport(report, 'md');
  assert.match(md, /\| out IQR \|/);
  assert.match(md, /## Tool calls by tool/);
  assert.match(md, /- optimized: Bash 4, Read 8/);
});
