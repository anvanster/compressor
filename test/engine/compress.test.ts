import test from 'node:test';
import assert from 'node:assert/strict';
import { compress, policyFor, OMISSION_MARKER } from '../../src/engine/index.ts';
import type { CompressMeta } from '../../src/engine/index.ts';

const estimate = (s: string): number => Math.ceil(s.length / 4);

function numbered(lines: string[]): string {
  return lines.map((text, i) => `${String(i + 1).padStart(6)}→${text}`).join('\n');
}

function bigNumberedTsFile(helpers: number): string {
  const src: string[] = ["import { thing } from './thing.ts';"];
  for (let i = 0; i < helpers; i += 1) {
    src.push(`// helper ${i} explains the function below in some detail`);
    src.push('');
    src.push(`export function helper${i}(value: number): number {`);
    src.push(`  return value * ${i};`);
    src.push('}');
  }
  return numbered(src);
}

test('policyFor full disables everything', () => {
  const p = policyFor('full');
  assert.equal(p.structural, false);
  assert.equal(p.codeAware, false);
  assert.equal(p.logAware, false);
  assert.equal(p.touch, Infinity);
  assert.equal(p.truncateBudget, Infinity);
  assert.equal(p.commentStrip, Infinity);
  assert.equal(p.skeleton, Infinity);
  assert.equal(p.logFilter, Infinity);
});

test('policyFor optimized and slim thresholds', () => {
  // PLAN.md reserves lossy tier-3 log filtering for slim
  const opt = policyFor('optimized');
  assert.deepEqual(
    [opt.structural, opt.codeAware, opt.logAware],
    [true, true, false],
  );
  assert.equal(opt.touch, 600);
  assert.equal(opt.truncateBudget, 5000);
  assert.equal(opt.commentStrip, 2000);
  assert.equal(opt.skeleton, Infinity);
  assert.equal(opt.logFilter, Infinity);

  const slim = policyFor('slim');
  assert.equal(slim.touch, 300);
  assert.equal(slim.truncateBudget, 2500);
  assert.equal(slim.commentStrip, 1000);
  assert.equal(slim.skeleton, 6000);
  assert.equal(slim.logFilter, 800);
});

test('full mode passes through untouched', () => {
  const content = bigNumberedTsFile(200);
  const meta: CompressMeta = { tool: 'read', mode: 'full', filePath: 'src/big.ts' };
  const result = compress(content, meta, policyFor('full'), estimate);
  assert.equal(result.content, content);
  assert.deepEqual(result.stats.transforms, []);
  assert.equal(result.stats.bytesIn, result.stats.bytesOut);
  assert.equal(result.stats.estTokensIn, result.stats.estTokensOut);
});

test('meta.mode full passes through even with an aggressive policy', () => {
  const content = bigNumberedTsFile(200);
  const meta: CompressMeta = { tool: 'read', mode: 'full', filePath: 'src/big.ts' };
  const result = compress(content, meta, policyFor('slim'), estimate);
  assert.equal(result.content, content);
  assert.deepEqual(result.stats.transforms, []);
});

test('targeted reads pass through untouched', () => {
  const content = bigNumberedTsFile(200);
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: 'src/big.ts', targeted: true };
  const result = compress(content, meta, policyFor('slim'), estimate);
  assert.equal(result.content, content);
  assert.deepEqual(result.stats.transforms, []);
});

test('content under the touch threshold passes through', () => {
  const content = 'const x = 1;\nexport { x };';
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: 'a.ts' };
  const result = compress(content, meta, policyFor('slim'), estimate);
  assert.equal(result.content, content);
  assert.deepEqual(result.stats.transforms, []);
});

test('content already containing the omission marker passes through', () => {
  const padding = Array.from({ length: 200 }, (_, i) => `noise line ${i} with some words in it`);
  const content = [
    ...padding.slice(0, 100),
    '[compressor: lines 5-90 omitted (~500 est tokens) — re-run with a narrower filter (grep, --quiet, head) to retrieve]',
    ...padding.slice(100),
  ].join('\n');
  assert.ok(content.includes(OMISSION_MARKER));
  const meta: CompressMeta = { tool: 'bash', mode: 'slim' };
  const result = compress(content, meta, policyFor('slim'), estimate);
  assert.equal(result.content, content);
  assert.deepEqual(result.stats.transforms, []);
});

test('end-to-end slim compression of a large numbered TS file', () => {
  // 120 helpers ≈ 5000 est tokens: above commentStrip (1000), below skeleton
  // (6000), and still above truncateBudget (2500) after stripping.
  const content = bigNumberedTsFile(120);
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: 'src/big.ts' };
  const policy = policyFor('slim');
  const result = compress(content, meta, policy, estimate);

  assert.ok(result.content.length < content.length, 'result is shorter');
  assert.ok(result.content.includes(OMISSION_MARKER), 'contains a recovery marker');
  assert.match(result.content, /comment\/blank lines stripped/);

  // the truncation marker must name REAL file lines (comment-strip already
  // removed lines, so array positions are not file lines)
  const markerRe =
    /\[compressor: lines (\d+)-(\d+) omitted \(~\d+ est tokens\) — Read src\/big\.ts with offset=(\d+) and limit=(\d+) to retrieve\]/;
  const marker = markerRe.exec(result.content);
  assert.ok(marker, 'read marker with offset/limit present');
  const a = Number(marker[1]);
  const b = Number(marker[2]);
  assert.equal(Number(marker[3]), a, 'offset equals first omitted file line');
  assert.equal(Number(marker[4]), b - a + 1, 'limit covers the omitted range');
  const outLines = result.content.split('\n');
  const markerIdx = outLines.findIndex((l) => markerRe.test(l));
  const numOf = (line: string | undefined): number =>
    Number(/^ *(\d+)→/.exec(line ?? '')?.[1] ?? NaN);
  const prevNum = numOf(outLines[markerIdx - 1]);
  const nextNum = numOf(outLines[markerIdx + 1]);
  assert.ok(Number.isFinite(prevNum) && Number.isFinite(nextNum));
  assert.ok(a > prevNum, `marker start ${a} after last visible head line ${prevNum}`);
  assert.ok(b < nextNum, `marker end ${b} before first visible tail line ${nextNum}`);
  assert.ok(a <= b);

  // retained code lines keep their original line-number prefixes verbatim
  assert.ok(result.content.includes(`${String(4).padStart(6)}→export function helper0(value: number): number {`));

  const ids = result.stats.transforms.map((t) => t.id);
  assert.ok(ids.includes('comment-strip'), `transforms: ${ids.join(',')}`);
  assert.ok(ids.includes('truncate'), `transforms: ${ids.join(',')}`);

  assert.equal(result.stats.kind, 'code');
  assert.equal(result.stats.estTokensIn, estimate(content));
  assert.equal(result.stats.estTokensOut, estimate(result.content));
  assert.equal(result.stats.bytesOut, new TextEncoder().encode(result.content).length);
  assert.ok(result.stats.estTokensOut < result.stats.estTokensIn);

  // idempotency: compress(compress(x)) === compress(x)
  const second = compress(result.content, meta, policy, estimate);
  assert.equal(second.content, result.content);
  assert.deepEqual(second.stats.transforms, []);
});

test('checkmark checklist docs are generic, never filtered as test-logs', () => {
  const lines = [
    '# Feature checklist',
    ...Array.from({ length: 60 }, (_, i) => `✓ Feature ${i}: implemented and verified in production`),
    'Note: error handling for feature 12 is still pending review',
  ];
  const content = lines.join('\n');
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: 'docs/checklist.md' };
  const result = compress(content, meta, policyFor('slim'), estimate);
  assert.equal(result.stats.kind, 'generic');
  assert.ok(!result.content.includes('passing-test lines omitted'));
  assert.equal(result.content, content);
});

test('optimized mode never applies lossy log filtering', () => {
  const passes = Array.from(
    { length: 300 },
    (_, i) => `  ✓ case ${i} behaves correctly under condition ${i} (2 ms)`,
  );
  const content = [
    'PASS src/many.test.ts',
    ...passes,
    'Tests: 300 passed, 300 total',
  ].join('\n');
  const meta: CompressMeta = { tool: 'bash', mode: 'optimized' };
  const result = compress(content, meta, policyFor('optimized'), estimate);
  assert.equal(result.stats.kind, 'test-log');
  assert.ok(!result.stats.transforms.some((t) => t.id === 'log-filter'));
  assert.ok(!result.content.includes('passing-test lines omitted'));
});

test('slim compression of a noisy test log keeps failures', () => {
  const passes = Array.from({ length: 200 }, (_, i) => `  ✓ case ${i} behaves correctly under condition ${i} (2 ms)`);
  const content = [
    'PASS src/many.test.ts',
    ...passes,
    'FAIL src/one.test.ts',
    '  ✗ breaks badly',
    'Tests:       1 failed, 200 passed, 201 total',
  ].join('\n');
  const meta: CompressMeta = { tool: 'bash', mode: 'slim' };
  const result = compress(content, meta, policyFor('slim'), estimate);
  assert.equal(result.stats.kind, 'test-log');
  assert.ok(result.content.includes('FAIL src/one.test.ts'));
  assert.ok(result.content.includes('✗ breaks badly'));
  assert.ok(result.content.includes('Tests:       1 failed, 200 passed, 201 total'));
  assert.match(result.content, /\[compressor: \d+ passing-test lines omitted\]/);
  assert.ok(result.content.length < content.length);
});
