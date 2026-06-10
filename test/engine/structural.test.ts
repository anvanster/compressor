import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collapseBlankRuns,
  dedupeLines,
  stripAnsi,
  truncateHeadTail,
} from '../../src/engine/tiers/structural.ts';
import type { CompressMeta, Policy } from '../../src/engine/types.ts';
import { policyFor } from '../../src/engine/policy.ts';

const estimate = (s: string): number => Math.ceil(s.length / 4);

test('stripAnsi removes color codes and controls but keeps newline and tab', () => {
  const input = '\u001b[31mred\u001b[0m text\n\tkeep\u0007 me\r';
  const result = stripAnsi(input);
  assert.equal(result.content, 'red text\n\tkeep me');
  assert.equal(result.transform?.id, 'strip-ansi');
  assert.equal(result.transform?.charsSaved, input.length - result.content.length);
});

test('stripAnsi leaves clean content untouched with no transform', () => {
  const result = stripAnsi('plain text\nline two');
  assert.equal(result.content, 'plain text\nline two');
  assert.equal(result.transform, undefined);
});

test('collapseBlankRuns collapses 3+ blank lines to 1', () => {
  const result = collapseBlankRuns('a\n\n\n\n\nb');
  assert.equal(result.content, 'a\n\nb');
  assert.equal(result.transform?.id, 'collapse-blank');
});

test('collapseBlankRuns leaves runs of 2 alone', () => {
  const result = collapseBlankRuns('a\n\n\nb');
  assert.equal(result.content, 'a\n\n\nb');
  assert.equal(result.transform, undefined);
});

test('dedupeLines collapses runs of 3+ identical lines with marker', () => {
  const input = ['warn: retry', 'warn: retry', 'warn: retry', 'warn: retry', 'done'].join('\n');
  const result = dedupeLines(input);
  assert.equal(
    result.content,
    'warn: retry\n[compressor: previous line repeated 3 more times]\ndone',
  );
  assert.equal(result.transform?.id, 'dedupe-lines');
});

test('dedupeLines leaves runs of 2 alone', () => {
  const input = 'x\nx\ny';
  assert.equal(dedupeLines(input).content, input);
});

const MARKER_READ_RE =
  /^\[compressor: lines (\d+)-(\d+) omitted \(~(\d+) est tokens\) — Read (.+) with offset=(\d+) and limit=(\d+) to retrieve\]$/m;
const MARKER_GENERIC_RE =
  /^\[compressor: lines (\d+)-(\d+) omitted \(~(\d+) est tokens\) — re-run with a narrower filter \(grep, --quiet, head\) to retrieve\]$/m;

function tightBudgetPolicy(): Policy {
  return { ...policyFor('slim'), truncateBudget: 200 };
}

test('truncateHeadTail read marker maps A/B to the omitted region', () => {
  const totalLines = 120;
  const lines = Array.from({ length: totalLines }, (_, i) => `line ${String(i + 1).padStart(4, '0')} some padding text here`);
  const input = lines.join('\n');
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: '/tmp/big.txt' };
  const result = truncateHeadTail(input, meta, tightBudgetPolicy(), estimate);

  const match = MARKER_READ_RE.exec(result.content);
  assert.ok(match, 'read marker present');
  const a = Number(match[1]);
  const b = Number(match[2]);
  const offset = Number(match[5]);
  const limit = Number(match[6]);
  assert.equal(match[4], '/tmp/big.txt');
  assert.equal(offset, a);
  assert.equal(limit, b - a + 1);

  const outLines = result.content.split('\n');
  const markerIdx = outLines.findIndex((l) => MARKER_READ_RE.test(l));
  const headCount = markerIdx;
  const tailCount = outLines.length - markerIdx - 1;
  assert.equal(a, headCount + 1);
  assert.equal(b, totalLines - tailCount);
  assert.equal(headCount + (b - a + 1) + tailCount, totalLines);

  // head and tail lines are verbatim originals
  assert.equal(outLines[0], lines[0]);
  assert.equal(outLines[outLines.length - 1], lines[lines.length - 1]);
  assert.equal(result.transform?.id, 'truncate');
});

test('truncateHeadTail keeps roughly 60/40 head/tail by lines', () => {
  const lines = Array.from({ length: 100 }, (_, i) => `row ${i} abcdefghijklmnopqrstuvwxyz`);
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: 'f.txt' };
  const result = truncateHeadTail(lines.join('\n'), meta, tightBudgetPolicy(), estimate);
  const outLines = result.content.split('\n');
  const markerIdx = outLines.findIndex((l) => MARKER_READ_RE.test(l));
  const headCount = markerIdx;
  const tailCount = outLines.length - markerIdx - 1;
  const ratio = headCount / (headCount + tailCount);
  assert.ok(ratio > 0.5 && ratio < 0.7, `head ratio ${ratio} near 0.6`);
});

test('truncateHeadTail uses generic marker for non-read tools', () => {
  const lines = Array.from({ length: 120 }, (_, i) => `bash output row ${i} with padding text`);
  const meta: CompressMeta = { tool: 'bash', mode: 'slim' };
  const result = truncateHeadTail(lines.join('\n'), meta, tightBudgetPolicy(), estimate);
  assert.ok(MARKER_GENERIC_RE.test(result.content));
});

test('truncateHeadTail under budget is a no-op', () => {
  const input = 'short\ncontent';
  const result = truncateHeadTail(input, { tool: 'bash', mode: 'slim' }, policyFor('slim'), estimate);
  assert.equal(result.content, input);
  assert.equal(result.transform, undefined);
});

test('truncateHeadTail prefers embedded Read line numbers over array positions', () => {
  // simulate output of an earlier tier that removed lines: only odd file
  // lines remain, so array positions !== file lines
  const lines = Array.from(
    { length: 120 },
    (_, i) => `${String(2 * i + 1).padStart(6)}→content of file line ${2 * i + 1} with padding`,
  );
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: '/tmp/big.ts' };
  const result = truncateHeadTail(lines.join('\n'), meta, tightBudgetPolicy(), estimate, false);

  const match = MARKER_READ_RE.exec(result.content);
  assert.ok(match, 'read marker present');
  const a = Number(match[1]);
  const b = Number(match[2]);
  const outLines = result.content.split('\n');
  const markerIdx = outLines.findIndex((l) => MARKER_READ_RE.test(l));
  const tailCount = outLines.length - markerIdx - 1;
  // first omitted entry is array index markerIdx -> file line 2*markerIdx+1
  assert.equal(a, 2 * markerIdx + 1);
  // last omitted entry is array index 119-tailCount -> file line 2*(119-tailCount)+1
  assert.equal(b, 2 * (119 - tailCount) + 1);
  assert.equal(Number(match[5]), a);
  assert.equal(Number(match[6]), b - a + 1);
});

test('untrusted positions without line numbers yield a count marker, no offset/limit', () => {
  const lines = Array.from({ length: 120 }, (_, i) => `plain row ${i} with some padding text here`);
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: '/tmp/big.txt' };
  const result = truncateHeadTail(lines.join('\n'), meta, tightBudgetPolicy(), estimate, false);
  assert.equal(result.transform?.id, 'truncate');
  assert.match(
    result.content,
    /\[compressor: \d+ lines omitted \(~\d+ est tokens\) — Read \/tmp\/big\.txt to retrieve\]/,
  );
  assert.ok(!result.content.includes('offset='));
  assert.ok(!MARKER_READ_RE.test(result.content));
});

test('huge single-line content falls back to char-based truncation', () => {
  const blob = 'const x={'.repeat(12_000); // ~108k chars, 1 line
  const meta: CompressMeta = { tool: 'bash', mode: 'slim' };
  const policy = policyFor('slim');
  const result = truncateHeadTail(blob, meta, policy, estimate);
  assert.equal(result.transform?.id, 'truncate');
  assert.ok(result.content.length < blob.length, 'blob actually shrank');
  assert.match(
    result.content,
    /\[compressor: \d+ chars omitted \(~\d+ est tokens\) — re-run with a narrower filter/,
  );
  assert.ok(estimate(result.content) <= policy.truncateBudget * 1.1, 'budget enforced');
});

test('char-based truncation of a read names the file without offset/limit claims', () => {
  const blob = `{"data":"${'ab'.repeat(30_000)}"}`;
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: '/tmp/blob.json' };
  const result = truncateHeadTail(blob, meta, policyFor('slim'), estimate);
  assert.equal(result.transform?.id, 'truncate');
  assert.match(
    result.content,
    /\[compressor: \d+ chars omitted \(~\d+ est tokens\) — Read \/tmp\/blob\.json to retrieve\]/,
  );
  assert.ok(!result.content.includes('offset='));
});
