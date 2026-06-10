import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CellResult } from '../../src/bench/types.ts';
import { aggregate } from '../../src/bench/results.ts';
import {
  buildRunReport,
  computeAblationDeltas,
  computeByTask,
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

function taskRow(
  taskId: string,
  variantId: string,
  trial: number,
  input: number,
  output: number,
  partial: Partial<CellResult> = {},
): CellResult {
  return row({
    taskId,
    variantId,
    trial,
    usage: { input, output, cacheCreation: 2000, cacheRead: 3000 },
    ...partial,
  });
}

function byTaskResults(): CellResult[] {
  return [
    // t1 × full: outputs 1500/1531/1600 → median 1,531; context 6000/7000/8000 → 7,000
    taskRow('t1', 'full', 1, 1000, 1500),
    taskRow('t1', 'full', 2, 2000, 1531),
    taskRow('t1', 'full', 3, 3000, 1600),
    // t1 × optimized: one failure → (2/3); median output 1,000
    taskRow('t1', 'optimized', 1, 1000, 900),
    taskRow('t1', 'optimized', 2, 1000, 1000, { success: false }),
    taskRow('t1', 'optimized', 3, 1000, 1100),
    // t1 × alpha: MISSING → '—'
    // t2 × full and t2 × alpha exist; t2 × optimized is all-infra-error → '—'
    taskRow('t2', 'full', 1, 500, 700),
    taskRow('t2', 'alpha', 1, 500, 650),
    taskRow('t2', 'optimized', 1, 0, 0, { success: null, costUsd: null, error: 'boom' }),
  ];
}

test('byTask matrix math: medians, success fractions, missing/errored pairs', () => {
  const byTask = computeByTask(byTaskResults());
  assert.deepEqual(byTask.taskIds, ['t1', 't2']);
  // 'full' first, the rest alphabetical
  assert.deepEqual(byTask.variantIds, ['full', 'alpha', 'optimized']);

  const cell = (t: number, v: number) => byTask.cells[t]?.[v] ?? null;

  const t1Full = cell(0, 0);
  assert.ok(t1Full);
  assert.equal(t1Full.cells, 3);
  assert.equal(t1Full.valid, 3);
  assert.equal(t1Full.judged, 3);
  assert.equal(t1Full.successes, 3);
  assert.equal(t1Full.successFraction, 1);
  assert.equal(t1Full.medianOutput, 1531);
  assert.equal(t1Full.medianContext, 7000);

  const t1Opt = cell(0, 2);
  assert.ok(t1Opt);
  assert.equal(t1Opt.successes, 2);
  assert.equal(t1Opt.judged, 3);
  assert.equal(t1Opt.successFraction, 2 / 3);
  assert.equal(t1Opt.medianOutput, 1000);
  assert.equal(t1Opt.medianContext, 6000);

  // task missing one variant → null cell
  assert.equal(cell(0, 1), null);

  // pair whose every row errored: present, but zero valid cells
  const t2Opt = cell(1, 2);
  assert.ok(t2Opt);
  assert.equal(t2Opt.cells, 1);
  assert.equal(t2Opt.valid, 0);
  assert.equal(t2Opt.judged, 0);
  assert.equal(t2Opt.successFraction, null);
});

test('byTask matrices render in table and md with — for missing cells', () => {
  const report = buildRunReport('bench-test', null, byTaskResults());

  const table = formatReport(report, 'table');
  assert.match(table, /per-task median output tokens \(success\):/);
  assert.match(table, /per-task median context volume:/);
  assert.match(table, /1,531 \(3\/3\)/);
  assert.match(table, /1,000 \(2\/3\)/);
  assert.match(table, /7,000/);
  // t1 row: missing alpha column renders an em dash
  const t1OutLine = table
    .split('\n')
    .find((line) => line.startsWith('t1') && line.includes('(3/3)'));
  assert.ok(t1OutLine);
  assert.match(t1OutLine, /^t1\s+1,531 \(3\/3\)\s+—\s+1,000 \(2\/3\)$/);
  // t2 row: all-error optimized pair renders — too
  const t2OutLine = table
    .split('\n')
    .find((line) => line.startsWith('t2') && line.includes('(1/1)'));
  assert.ok(t2OutLine);
  assert.match(t2OutLine, /^t2\s+700 \(1\/1\)\s+650 \(1\/1\)\s+—$/);

  const md = formatReport(report, 'md');
  assert.match(md, /## per-task median output tokens \(success\)/);
  assert.match(md, /## per-task median context volume/);
  assert.ok(md.includes('| task | full | alpha | optimized |'));
  assert.ok(md.includes('| t1 | 1,531 (3/3) | — | 1,000 (2/3) |'));
  assert.ok(md.includes('| t1 | 7,000 | — | 6,000 |'));
  assert.ok(md.includes('| t2 | 700 (1/1) | 650 (1/1) | — |'));
});

test('byPair keys: task/variant ids containing spaces never collide', () => {
  // ('a b' × 'c') and ('a' × 'b c') would collapse into one bucket under a
  // space-joined key; the NUL separator must keep them apart
  const byTask = computeByTask([
    taskRow('a b', 'c', 1, 100, 10),
    taskRow('a', 'b c', 1, 100, 999),
  ]);
  assert.deepEqual(byTask.taskIds, ['a', 'a b']);
  assert.deepEqual(byTask.variantIds, ['b c', 'c']);
  assert.equal(byTask.cells[0]?.[0]?.medianOutput, 999);
  assert.equal(byTask.cells[1]?.[1]?.medianOutput, 10);
  assert.equal(byTask.cells[0]?.[1], null);
  assert.equal(byTask.cells[1]?.[0], null);
});

test('no src file ships raw control bytes; the pairKey NUL is the printable escape', async () => {
  // a raw NUL once made report.ts binary to git (diff/review/blame went
  // dark) and would silently empty both per-task matrices if either of the
  // two occurrences ever got normalized — guard the whole tree
  const srcDir = fileURLToPath(new URL('../../src', import.meta.url));
  const names = (await readdir(srcDir, { recursive: true })).filter((n) =>
    n.endsWith('.ts'),
  );
  assert.ok(names.length >= 10, `suspiciously few src files: ${names.length}`);
  for (const name of names) {
    const text = await readFile(path.join(srcDir, name), 'utf8');
    const bad = [...text].find((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    });
    assert.equal(
      bad,
      undefined,
      `src/${name}: raw control byte 0x${(bad ?? '').charCodeAt(0).toString(16)} — git treats the file as binary`,
    );
  }
  const reportSrc = await readFile(
    path.join(srcDir, 'cli', 'commands', 'report.ts'),
    'utf8',
  );
  const escapedNul = String.fromCharCode(92) + 'u0000';
  assert.ok(
    reportSrc.includes('`${taskId}' + escapedNul + '${variantId}`'),
    'pairKey must join ids with the escaped (never raw) NUL separator',
  );
});

test('--format json carries byTask with the documented shape', () => {
  const report = buildRunReport('bench-test', null, byTaskResults());
  const parsed = JSON.parse(formatReport(report, 'json')) as { byTask?: unknown };
  assert.ok(parsed.byTask !== undefined);
  assert.deepEqual(parsed.byTask, JSON.parse(JSON.stringify(report.byTask)) as unknown);
  const byTask = parsed.byTask as {
    taskIds: string[];
    variantIds: string[];
    cells: ({ medianOutput: number; successes: number } | null)[][];
  };
  assert.deepEqual(byTask.taskIds, ['t1', 't2']);
  assert.deepEqual(byTask.variantIds, ['full', 'alpha', 'optimized']);
  assert.equal(byTask.cells[0]?.[0]?.medianOutput, 1531);
  assert.equal(byTask.cells[0]?.[1], null);
});
