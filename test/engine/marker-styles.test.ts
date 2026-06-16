import test from 'node:test';
import assert from 'node:assert/strict';
import { compress, policyFor, OMISSION_MARKER } from '../../src/engine/index.ts';
import type { CompressMeta, MarkerStyle, Policy } from '../../src/engine/index.ts';
import { truncateHeadTail } from '../../src/engine/tiers/structural.ts';
import { skeleton, stripComments } from '../../src/engine/tiers/code.ts';
import { filterBuildLog, filterTestLog } from '../../src/engine/tiers/logs.ts';

const estimate = (s: string): number => Math.ceil(s.length / 4);

const STYLES: readonly MarkerStyle[] = ['plain', 'deterrent', 'informative'];

function numbered(lines: string[]): string {
  return lines.map((text, i) => `${String(i + 1).padStart(6)}→${text}`).join('\n');
}

function styledPolicy(style: MarkerStyle, overrides: Partial<Policy> = {}): Policy {
  return { ...policyFor('slim'), ...overrides, markerStyle: style };
}

/** The experiment-validity view: everything except compressor marker lines. */
function stripMarkerLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.includes(OMISSION_MARKER))
    .join('\n');
}

test('policyFor defaults markerStyle to plain in every mode', () => {
  assert.equal(policyFor('full').markerStyle, 'plain');
  assert.equal(policyFor('optimized').markerStyle, 'plain');
  assert.equal(policyFor('slim').markerStyle, 'plain');
});

// ---------- truncateHeadTail: read with filePath ----------

function paddedLines(total: number): string[] {
  return Array.from(
    { length: total },
    (_, i) => `line ${String(i + 1).padStart(4, '0')} some padding text here`,
  );
}

const READ_META: CompressMeta = { tool: 'read', mode: 'slim', filePath: '/tmp/big.txt' };

test('deterrent read marker: conditional retrieval with consistent offset/limit', () => {
  const result = truncateHeadTail(
    paddedLines(120).join('\n'),
    READ_META,
    styledPolicy('deterrent', { truncateBudget: 200 }),
    estimate,
  );
  const re =
    /^\[compressor: lines (\d+)-(\d+) omitted \(~\d+ est tokens\) — likely irrelevant; Read \/tmp\/big\.txt offset=(\d+) limit=(\d+) ONLY if the problem you are chasing points into this range\]$/m;
  const match = re.exec(result.content);
  assert.ok(match, 'deterrent read marker present');
  const a = Number(match[1]);
  const b = Number(match[2]);
  assert.equal(Number(match[3]), a);
  assert.equal(Number(match[4]), b - a + 1);
});

test('informative read marker, zero matches: safe-to-skip phrasing', () => {
  const result = truncateHeadTail(
    paddedLines(120).join('\n'),
    READ_META,
    styledPolicy('informative', { truncateBudget: 200 }),
    estimate,
  );
  const re =
    /^\[compressor: lines (\d+)-(\d+) omitted \(~\d+ est tokens\) — no error\/failure\/warning lines in the omitted range; safe to skip\. Read \/tmp\/big\.txt offset=(\d+) limit=(\d+) only if needed\]$/m;
  const match = re.exec(result.content);
  assert.ok(match, 'informative zero-match marker present');
  const a = Number(match[1]);
  const b = Number(match[2]);
  assert.equal(Number(match[3]), a);
  assert.equal(Number(match[4]), b - a + 1);
});

test('informative read marker reports ORIGINAL coordinates from embedded line numbers', () => {
  // only odd file lines remain (an earlier tier removed lines), so array
  // positions !== file lines — same reconstruction as the coordinate test
  const lines = Array.from(
    { length: 120 },
    (_, i) => `${String(2 * i + 1).padStart(6)}→content of file line ${2 * i + 1} with padding`,
  );
  // plant a failure deep inside the omitted region: array idx 60 = file line 121
  lines[60] = `${String(121).padStart(6)}→Error: x`;
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: '/tmp/big.ts' };
  const result = truncateHeadTail(
    lines.join('\n'),
    meta,
    styledPolicy('informative', { truncateBudget: 200 }),
    estimate,
    false,
  );
  const re =
    /^\[compressor: lines (\d+)-(\d+) omitted \(~\d+ est tokens\) — 1 lines matching error\/fail\/warn at lines (\d+) — Read \/tmp\/big\.ts offset=(\d+) limit=20 for the nearest match; full range offset=(\d+) limit=(\d+)\]$/m;
  const match = re.exec(result.content);
  assert.ok(match, `informative match marker present in: ${result.content}`);
  const a = Number(match[1]);
  const b = Number(match[2]);
  assert.equal(Number(match[3]), 121, 'match reported at the original file line');
  assert.equal(Number(match[4]), 121, 'nearest-match offset is the original file line');
  assert.equal(Number(match[5]), a, 'full-range offset equals the omitted range start');
  assert.equal(Number(match[6]), b - a + 1, 'full-range limit covers the omitted range');
  assert.ok(a <= 121 && 121 <= b, 'planted line is inside the reported range');
  // reconstruct the range from the output like the existing coordinate test
  const outLines = result.content.split('\n');
  const markerIdx = outLines.findIndex((l) => re.test(l));
  const tailCount = outLines.length - markerIdx - 1;
  assert.equal(a, 2 * markerIdx + 1);
  assert.equal(b, 2 * (119 - tailCount) + 1);
  assert.ok(!result.content.includes('(first 3)'), 'no truncation qualifier for one match');
});

test('informative read marker lists the first 3 of 4 matches with the (first 3) qualifier', () => {
  const lines = Array.from(
    { length: 120 },
    (_, i) => `${String(2 * i + 1).padStart(6)}→content of file line ${2 * i + 1} with padding`,
  );
  for (const idx of [30, 40, 50, 55]) {
    lines[idx] = `${String(2 * idx + 1).padStart(6)}→warning: disk almost full`;
  }
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: '/tmp/big.ts' };
  const result = truncateHeadTail(
    lines.join('\n'),
    meta,
    styledPolicy('informative', { truncateBudget: 200 }),
    estimate,
    false,
  );
  assert.ok(
    result.content.includes('4 lines matching error/fail/warn at lines 61, 81, 101 (first 3)'),
    `expected first-3 list in: ${result.content}`,
  );
  assert.ok(result.content.includes('offset=61 limit=20 for the nearest match'));
});

// ---------- truncateHeadTail: bash / no-file variant ----------

const BASH_META: CompressMeta = { tool: 'bash', mode: 'slim' };

function bashRows(total: number): string[] {
  return Array.from({ length: total }, (_, i) => `bash output row ${i} with padding text`);
}

test('deterrent bash marker keeps the narrower-filter hint, conditionally', () => {
  const result = truncateHeadTail(
    bashRows(120).join('\n'),
    BASH_META,
    styledPolicy('deterrent', { truncateBudget: 200 }),
    estimate,
  );
  assert.match(
    result.content,
    /^\[compressor: lines \d+-\d+ omitted \(~\d+ est tokens\) — likely irrelevant; re-run with a narrower filter \(grep, --quiet, head\) ONLY if the problem you are chasing points into this range\]$/m,
  );
});

test('informative bash marker, zero matches', () => {
  const result = truncateHeadTail(
    bashRows(120).join('\n'),
    BASH_META,
    styledPolicy('informative', { truncateBudget: 200 }),
    estimate,
  );
  assert.match(
    result.content,
    /^\[compressor: lines \d+-\d+ omitted \(~\d+ est tokens\) — no error\/failure\/warning lines in the omitted range; safe to skip\. Re-run with a narrower filter \(grep, --quiet, head\) only if needed\]$/m,
  );
});

test('informative bash marker maps positional matches to 1-based line numbers', () => {
  const rows = bashRows(120);
  rows[60] = 'Error: kaboom while processing row 60'; // 1-based line 61
  const result = truncateHeadTail(
    rows.join('\n'),
    BASH_META,
    styledPolicy('informative', { truncateBudget: 200 }),
    estimate,
  );
  assert.match(
    result.content,
    /^\[compressor: lines \d+-\d+ omitted \(~\d+ est tokens\) — 1 lines matching error\/fail\/warn at lines 61 — re-run with a narrower filter \(grep, --quiet, head\) to retrieve\]$/m,
  );
});

// ---------- count markers (range unknown / char fallback) ----------

test('count marker styles for unnumbered untrusted positions (read)', () => {
  const plain = Array.from({ length: 120 }, (_, i) => `plain row ${i} with some padding text here`);
  const deterrent = truncateHeadTail(
    plain.join('\n'),
    READ_META,
    styledPolicy('deterrent', { truncateBudget: 200 }),
    estimate,
    false,
  );
  assert.match(
    deterrent.content,
    /\[compressor: \d+ lines omitted \(~\d+ est tokens\) — likely irrelevant; Read \/tmp\/big\.txt ONLY if the problem you are chasing points into the omitted content\]/,
  );
  assert.ok(!deterrent.content.includes('offset='), 'no offset/limit claim without coordinates');

  const informativeZero = truncateHeadTail(
    plain.join('\n'),
    READ_META,
    styledPolicy('informative', { truncateBudget: 200 }),
    estimate,
    false,
  );
  assert.match(
    informativeZero.content,
    /\[compressor: \d+ lines omitted \(~\d+ est tokens\) — no error\/failure\/warning lines in the omitted content; safe to skip\. Read \/tmp\/big\.txt only if needed\]/,
  );

  const withError = [...plain];
  withError[60] = 'Error: kaboom in the middle of the file';
  const informativeMatch = truncateHeadTail(
    withError.join('\n'),
    READ_META,
    styledPolicy('informative', { truncateBudget: 200 }),
    estimate,
    false,
  );
  assert.match(
    informativeMatch.content,
    /\[compressor: \d+ lines omitted \(~\d+ est tokens\) — 1 lines matching error\/fail\/warn in the omitted content — Read \/tmp\/big\.txt to retrieve\]/,
  );
  assert.ok(!informativeMatch.content.includes('at lines'), 'no line claims without coordinates');
});

test('char-fallback marker styles for a single-line blob', () => {
  const blob = `{"data":"${'ab'.repeat(30_000)}"}`;
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: '/tmp/blob.json' };
  const deterrent = truncateHeadTail(blob, meta, styledPolicy('deterrent'), estimate);
  assert.match(
    deterrent.content,
    /\[compressor: \d+ chars omitted \(~\d+ est tokens\) — likely irrelevant; Read \/tmp\/blob\.json ONLY if the problem you are chasing points into the omitted content\]/,
  );
  const informative = truncateHeadTail(blob, meta, styledPolicy('informative'), estimate);
  assert.match(
    informative.content,
    /\[compressor: \d+ chars omitted \(~\d+ est tokens\) — no error\/failure\/warning lines in the omitted content; safe to skip\. Read \/tmp\/blob\.json only if needed\]/,
  );
});

// ---------- code tier ----------

test('stripComments marker styles', () => {
  const mk = (comment: string): string =>
    numbered([
      "import { a } from './a.ts';",
      comment,
      '',
      'const x = a + 1;',
      'export { x };',
    ]);
  const deterrent = stripComments(mk('// explains the constant'), 'ts-js', 'deterrent');
  assert.ok(
    deterrent.content.includes(
      '[compressor: 2 comment/blank lines stripped — line numbers preserved; comments are likely irrelevant to the problem you are chasing]',
    ),
    deterrent.content,
  );

  const informativeZero = stripComments(mk('// explains the constant'), 'ts-js', 'informative');
  assert.ok(
    informativeZero.content.includes(
      '[compressor: 2 comment/blank lines stripped — line numbers preserved; no error/failure/warning text among them; safe to skip]',
    ),
    informativeZero.content,
  );

  // stripped comment mentioning a failure: original file line 2 reported
  const informativeMatch = stripComments(
    mk('// TODO: handle error case here'),
    'ts-js',
    'informative',
  );
  assert.ok(
    informativeMatch.content.includes(
      '[compressor: 2 comment/blank lines stripped — line numbers preserved; 1 stripped lines matching error/fail/warn at lines 2]',
    ),
    informativeMatch.content,
  );
});

test('skeleton gap markers carry the style (original coordinates preserved)', () => {
  const input = numbered([
    "import { a } from './a.ts';",
    '',
    'export function one(x: number): number {',
    "  throw new Error('boom');",
    '}',
    '',
    'export class Box {',
    '  value = 1;',
    '}',
  ]);
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: 'src/big.ts' };

  const deterrent = skeleton(input, 'ts-js', meta, estimate, 'deterrent');
  assert.match(
    deterrent.content,
    /\[compressor: lines 4-6 omitted \(~\d+ est tokens\) — likely irrelevant; Read src\/big\.ts offset=4 limit=3 ONLY if the problem you are chasing points into this range\]/,
  );

  const informative = skeleton(input, 'ts-js', meta, estimate, 'informative');
  // line 4 throws: reported at its original number, nearest-match offset=4
  assert.match(
    informative.content,
    /\[compressor: lines 4-6 omitted \(~\d+ est tokens\) — 1 lines matching error\/fail\/warn at lines 4 — Read src\/big\.ts offset=4 limit=20 for the nearest match; full range offset=4 limit=3\]/,
  );
  // the 8-9 gap has no failure text
  assert.match(
    informative.content,
    /\[compressor: lines 8-9 omitted \(~\d+ est tokens\) — no error\/failure\/warning lines in the omitted range; safe to skip\. Read src\/big\.ts offset=8 limit=2 only if needed\]/,
  );
});

// ---------- log tier ----------

const TEST_LOG = [
  'PASS src/math.test.ts',
  '  ✓ adds numbers (2 ms)',
  '  ✓ subtracts numbers (1 ms)',
  'FAIL src/string.test.ts',
  '  ✗ trims whitespace',
  'Tests:       1 failed, 2 passed, 3 total',
].join('\n');

test('filterTestLog marker styles', () => {
  const deterrent = filterTestLog(TEST_LOG, 'deterrent');
  assert.ok(
    deterrent.content.includes(
      '[compressor: 3 passing-test lines omitted — likely irrelevant; re-run with a narrower filter ONLY if the problem you are chasing points into the omitted output]',
    ),
    deterrent.content,
  );

  const informativeZero = filterTestLog(TEST_LOG, 'informative');
  assert.ok(
    informativeZero.content.includes(
      '[compressor: 3 passing-test lines omitted — no error/failure/warning lines in the omitted output; safe to skip. Re-run with a narrower filter only if needed]',
    ),
    informativeZero.content,
  );

  const withErrorWord = TEST_LOG.replace(
    '  ✓ adds numbers (2 ms)',
    '  ✓ recovers from error state (2 ms)',
  );
  const informativeMatch = filterTestLog(withErrorWord, 'informative');
  assert.ok(
    informativeMatch.content.includes(
      '[compressor: 3 passing-test lines omitted — 1 omitted lines matching error/fail/warn — re-run with a narrower filter to retrieve]',
    ),
    informativeMatch.content,
  );
});

test('filterBuildLog marker styles', () => {
  const log = [
    '   Compiling quote v1.0.36',
    'plain progress noise',
    'error[E0308]: mismatched types',
    'error: could not compile `compressor` due to 1 previous error',
  ].join('\n');
  const deterrent = filterBuildLog(log, 'deterrent');
  assert.match(
    deterrent.content,
    /\[compressor: \d+ build-log lines omitted — likely irrelevant; re-run with a narrower filter ONLY if the problem you are chasing points into the omitted output\]/,
  );
  // 'Compiling' noise is dropped and contains no failure words
  const informative = filterBuildLog(log, 'informative');
  assert.match(
    informative.content,
    /\[compressor: \d+ build-log lines omitted — no error\/failure\/warning lines in the omitted output; safe to skip\. Re-run with a narrower filter only if needed\]/,
  );
});

// ---------- experiment-validity invariant + idempotency ----------

interface Arm {
  name: string;
  content: string;
  meta: CompressMeta;
  overrides: Partial<Policy>;
  /** transform that must fire so the styled marker is actually exercised */
  expectTransform: string;
}

function annotatedTsFile(helpers: number): string {
  const src: string[] = ["import { thing } from './thing.ts';"];
  for (let i = 0; i < helpers; i += 1) {
    src.push(`// helper ${i} explains the error path in detail`);
    src.push('');
    src.push(`export function helper${i}(value: number): number {`);
    src.push(`  return value * ${i};`);
    src.push('}');
  }
  return numbered(src);
}

function bigTestLog(): string {
  const passes = Array.from(
    { length: 200 },
    (_, i) => `  ✓ case ${i} behaves correctly under condition ${i} (2 ms)`,
  );
  passes[50] = '  ✓ recovers from error state cleanly (3 ms)';
  return [
    'PASS src/many.test.ts',
    ...passes,
    'FAIL src/one.test.ts',
    '  ✗ breaks badly',
    'Tests:       1 failed, 200 passed, 201 total',
  ].join('\n');
}

function bigBashOutput(): string {
  const rows = Array.from(
    { length: 600 },
    (_, i) => `row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur adipiscing`,
  );
  rows[300] = 'Error: kaboom while processing row 00300';
  return rows.join('\n');
}

const ARMS: readonly Arm[] = [
  {
    name: 'comment-strip then truncate (read, numbered TS)',
    content: annotatedTsFile(120),
    meta: { tool: 'read', mode: 'slim', filePath: 'src/big.ts' },
    overrides: { truncateBudget: 2500 },
    expectTransform: 'truncate',
  },
  {
    name: 'test-log filter (bash)',
    content: bigTestLog(),
    meta: { tool: 'bash', mode: 'slim' },
    overrides: {},
    expectTransform: 'log-filter',
  },
  {
    name: 'truncate only (bash, distinct rows)',
    content: bigBashOutput(),
    meta: { tool: 'bash', mode: 'slim' },
    overrides: {},
    expectTransform: 'truncate',
  },
  {
    name: 'skeleton (read, large numbered TS)',
    content: annotatedTsFile(200),
    meta: { tool: 'read', mode: 'slim', filePath: 'src/big.ts' },
    overrides: {},
    expectTransform: 'skeleton',
  },
];

test('experiment validity: the three styles differ ONLY in marker lines', () => {
  for (const arm of ARMS) {
    const results = STYLES.map((style) =>
      compress(arm.content, arm.meta, styledPolicy(style, arm.overrides), estimate),
    );
    const [plain, deterrent, informative] = results;
    assert.ok(plain && deterrent && informative);
    assert.ok(
      plain.stats.transforms.some((t) => t.id === arm.expectTransform),
      `${arm.name}: expected ${arm.expectTransform} to fire, got ${plain.stats.transforms.map((t) => t.id).join(',')}`,
    );
    // styles actually changed the marker text...
    assert.notEqual(plain.content, deterrent.content, `${arm.name}: deterrent differs`);
    assert.notEqual(plain.content, informative.content, `${arm.name}: informative differs`);
    // ...and NOTHING else: byte-identical after stripping marker lines
    const stripped = results.map((r) => stripMarkerLines(r.content));
    assert.equal(stripped[1], stripped[0], `${arm.name}: deterrent arm identical sans markers`);
    assert.equal(stripped[2], stripped[0], `${arm.name}: informative arm identical sans markers`);
    // same transform pipeline in every arm
    const ids = results.map((r) => r.stats.transforms.map((t) => t.id).join(','));
    assert.equal(ids[1], ids[0], `${arm.name}: same transforms (deterrent)`);
    assert.equal(ids[2], ids[0], `${arm.name}: same transforms (informative)`);
  }
});

test('idempotency holds for every marker style', () => {
  for (const arm of ARMS) {
    for (const style of STYLES) {
      const policy = styledPolicy(style, arm.overrides);
      const first = compress(arm.content, arm.meta, policy, estimate);
      assert.ok(first.content.includes(OMISSION_MARKER), `${arm.name}/${style}: marker present`);
      const second = compress(first.content, arm.meta, policy, estimate);
      assert.equal(second.content, first.content, `${arm.name}/${style}: second pass no-op`);
      assert.deepEqual(second.stats.transforms, [], `${arm.name}/${style}: no transforms`);
    }
  }
});

test('compress takes the style from policy.markerStyle (plain default unchanged)', () => {
  const result = compress(
    bigBashOutput(),
    { tool: 'bash', mode: 'slim' },
    policyFor('slim'),
    estimate,
  );
  assert.match(
    result.content,
    /— re-run with a narrower filter \(grep, --quiet, head\) to retrieve\]/,
  );
  assert.ok(!result.content.includes('likely irrelevant'));

  const deterrent = compress(
    bigBashOutput(),
    { tool: 'bash', mode: 'slim' },
    { ...policyFor('slim'), markerStyle: 'deterrent' },
    estimate,
  );
  assert.ok(deterrent.content.includes('likely irrelevant'));
});
