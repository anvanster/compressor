import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { compress, policyFor } from '../../src/engine/index.ts';
import type { CompressMeta } from '../../src/engine/index.ts';
import { compressCall, isCompressorRetrieve } from '../../src/hook/core.ts';
import type { CompressibleCall } from '../../src/hook/core.ts';
import { handlePostToolUse } from '../../src/hook/post-tool-use.ts';
import { handleToolExecuteAfter } from '../../src/hook/opencode.ts';
import { readChunk, settleCcr } from '../../src/hook/ccr.ts';

// CCR Phase-2 WIRING: the engine's opt-in omission collection + the hook's
// stash + placeholder→handle swap (internal/CCR-PLAN.md §2/§3/§4). The two
// load-bearing invariants:
//   A — DEFAULT OUTPUT UNCHANGED: compress() with CCR off (every existing
//       caller) emits today's markers, no placeholders, no omissions.
//   B — A PLACEHOLDER NEVER LEAKS: a worthwhile compressCall result never
//       carries a raw ⟦ccr:N⟧; it is swapped for a retrieve handle, or (stash
//       disabled/failed) the descriptive fallback.
// HERMETIC: COMPRESSOR_CCR_DIR → a fresh temp dir per test; ledger/recovery off
// so worthwhile compressions never touch the real state dirs.

process.env['COMPRESSOR_NO_LEDGER'] = '1';
process.env['COMPRESSOR_NO_RECOVERY_BUDGET'] = '1';
// CCR is default-OFF opt-in: SET it so the wiring tests actually exercise the
// stash/swap path (otherwise they go vacuous). The default-off test below
// locally deletes it to assert the fallback.
process.env['COMPRESSOR_CCR'] = '1';

const estimate = (s: string): number => Math.ceil(s.length / 4);
const PLACEHOLDER_RE = /⟦ccr:\d+⟧/;
const HANDLE_CLAUSE_RE = /— retrieve: compressor retrieve ([A-Za-z0-9_-]{16})\]/;

interface DirScope {
  after: (fn: () => void | Promise<void>) => void;
}

/** Point the CCR stash at a fresh temp dir for the test; restored + removed after. */
async function freshCcrDir(t: DirScope): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'compressor-ccr-wiring-'));
  const saved = process.env['COMPRESSOR_CCR_DIR'];
  process.env['COMPRESSOR_CCR_DIR'] = dir;
  t.after(async () => {
    await settleCcr();
    if (saved === undefined) delete process.env['COMPRESSOR_CCR_DIR'];
    else process.env['COMPRESSOR_CCR_DIR'] = saved;
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function distinctBash(lines: number): string {
  return Array.from(
    { length: lines },
    (_, i) => `row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur adipiscing`,
  ).join('\n');
}

function numberedReadFile(lines: number): string {
  return Array.from(
    { length: lines },
    (_, i) =>
      `${String(i + 1).padStart(6)}→content of file line ${i + 1} with padding text for budget`,
  ).join('\n');
}

// ---------------------------------------------------------------------------
// Engine: opt-in omission collection (INVARIANT A boundary)
// ---------------------------------------------------------------------------

test('engine OFF path: no omissions, no placeholder, today’s descriptive marker', () => {
  const meta: CompressMeta = { tool: 'bash', mode: 'slim' };
  const result = compress(distinctBash(600), meta, policyFor('slim'), estimate);
  assert.equal(result.omissions, undefined, 'no omissions key on the OFF path');
  assert.ok(!PLACEHOLDER_RE.test(result.content), 'no placeholder on the OFF path');
  assert.match(
    result.content,
    /— re-run with a narrower filter \(grep, --quiet, head\) to retrieve\]/,
  );
});

test('engine ON path: non-file cut collects an omission and embeds its placeholder', () => {
  const meta: CompressMeta = { tool: 'bash', mode: 'slim' };
  const result = compress(distinctBash(600), meta, policyFor('slim'), estimate, {
    collectOmissions: true,
  });
  assert.ok(result.omissions && result.omissions.length === 1, 'one omission collected');
  const omission = result.omissions[0];
  assert.ok(omission);
  assert.match(omission.placeholder, /^⟦ccr:0⟧$/);
  // the placeholder is in the marker; the omitted text is the exact cut bytes
  assert.ok(result.content.includes(omission.placeholder), 'placeholder embedded in marker');
  assert.ok(omission.text.includes('row 00199'), 'omitted text is the exact cut region');
});

test('engine ON path: a FILE read collects NO omission and keeps the offset/limit marker', () => {
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: '/tmp/big.txt' };
  const result = compress(numberedReadFile(900), meta, policyFor('slim'), estimate, {
    collectOmissions: true,
  });
  assert.equal(result.omissions, undefined, 'file reads are not CCR-eligible (§7/B)');
  assert.ok(!PLACEHOLDER_RE.test(result.content), 'no placeholder in a file-read marker');
  assert.match(result.content, /Read \/tmp\/big\.txt with offset=\d+ and limit=\d+ to retrieve\]/);
});

test('engine ON path: a test-log filter collects the dropped passing lines', () => {
  const passes = Array.from({ length: 300 }, (_, i) => `  ✓ case ${i} ok (2 ms)`);
  const content = ['PASS src/a.test.ts', ...passes, 'Tests: 300 passed, 300 total'].join('\n');
  const meta: CompressMeta = { tool: 'bash', mode: 'slim' };
  const result = compress(content, meta, policyFor('slim'), estimate, { collectOmissions: true });
  assert.ok(result.omissions && result.omissions.length >= 1, 'log filter collected an omission');
  const omission = result.omissions[0];
  assert.ok(omission);
  assert.ok(result.content.includes(omission.placeholder), 'placeholder embedded in log marker');
  assert.ok(omission.text.includes('✓ case 0 ok'), 'omitted text is the dropped passing lines');
});

test('engine ON path: a FILE read of a log-shaped file collects NO omission (#3=B / §7)', () => {
  // A `Read build.log` is log-SHAPED but still a FILE read: CCR must NOT engage
  // (the file owns freshness — a stashed handle would go stale). The engine
  // withholds the sink for any tool==='read' with a filePath, so the log filter
  // renders today's descriptive marker, stashes nothing, mints no placeholder.
  const noise = Array.from(
    { length: 600 },
    (_, i) => `  compiling module ${String(i).padStart(4, '0')} ... ok, all good no problems here`,
  );
  const content = ['Build started', ...noise, 'error: boom at end', 'Build FAILED'].join('\n');
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: '/tmp/build.log' };
  const result = compress(content, meta, policyFor('slim'), estimate, { collectOmissions: true });
  assert.ok(
    result.stats.transforms.some((t) => t.id === 'log-filter'),
    'the log filter fired on the log-shaped file read',
  );
  assert.equal(result.omissions, undefined, 'a file-read log collects no CCR omission');
  assert.ok(!PLACEHOLDER_RE.test(result.content), 'no placeholder in a file-read log marker');
});

// ---------------------------------------------------------------------------
// Hook: stash + swap + retrieve round-trip (INVARIANT B)
// ---------------------------------------------------------------------------

test('compressCall over a large bash output stashes the omission and emits a retrieve handle', async (t) => {
  await freshCcrDir(t);
  const call: CompressibleCall = { toolKind: 'bash', targeted: false, text: distinctBash(600) };
  const compressed = compressCall(call, 'slim', undefined, 'sess-roundtrip');
  assert.ok(compressed.worthwhile, 'a 600-row bash output is worthwhile to compress');

  // INVARIANT B: no raw placeholder leaked
  assert.ok(!PLACEHOLDER_RE.test(compressed.text), 'no raw ⟦ccr:N⟧ reached the model');
  const match = HANDLE_CLAUSE_RE.exec(compressed.text);
  assert.ok(match, `expected a retrieve handle in: ${compressed.text.slice(0, 300)}`);
  const handle = match[1];
  assert.ok(handle);

  // readChunk(handle) returns the exact omitted bytes
  await settleCcr();
  const back = await readChunk(handle);
  assert.ok(back !== null, 'the stashed chunk is retrievable');
  assert.ok(back.includes('row 00199'), 'retrieved bytes are the omitted region');
  // the retrieved chunk + the kept head/tail reconstruct the omitted middle
  assert.ok(!compressed.text.includes('row 00199'), 'the omitted region is gone from the wire');
});

test('compressCall handle is deterministic: identical input → identical output (cache-stable)', async (t) => {
  await freshCcrDir(t);
  const call: CompressibleCall = { toolKind: 'bash', targeted: false, text: distinctBash(600) };
  const a = compressCall(call, 'slim', undefined, 'sess-det');
  const b = compressCall(call, 'slim', undefined, 'sess-det');
  assert.ok(a.worthwhile && b.worthwhile);
  assert.equal(a.text, b.text, 'hash(content) handle is deterministic → byte-stable marker');
  await settleCcr();
});

test('compressCall on a FILE read writes NO stash and keeps the offset/limit marker', async (t) => {
  const dir = await freshCcrDir(t);
  const call: CompressibleCall = {
    toolKind: 'read',
    targeted: false,
    filePath: '/tmp/big.txt',
    text: numberedReadFile(900),
  };
  const compressed = compressCall(call, 'slim', undefined, 'sess-file');
  assert.ok(compressed.worthwhile, 'a 900-line read is worthwhile to compress');
  assert.ok(!PLACEHOLDER_RE.test(compressed.text), 'no placeholder for a file read');
  assert.match(compressed.text, /Read \/tmp\/big\.txt with offset=\d+ and limit=\d+ to retrieve\]/);
  await settleCcr();
  // the stash root holds no session dir for this call — nothing was written
  const entries = await readdir(dir).catch(() => [] as string[]);
  const sessionDirs = entries.filter((e) => !e.startsWith('.'));
  assert.deepEqual(sessionDirs, [], 'a file read writes no chunk into the stash');
});

// ---------------------------------------------------------------------------
// INVARIANT B fallback: CCR off (default) / no stash → descriptive clause, no token
// ---------------------------------------------------------------------------

test('CCR off by default (COMPRESSOR_CCR unset): no placeholder leaks, no retrieve handle, descriptive fallback appears', async (t) => {
  await freshCcrDir(t);
  // the module-top SETS the opt-in var, so locally delete it (save/restore) to
  // assert the default-off fallback without tainting later tests
  const saved = process.env['COMPRESSOR_CCR'];
  delete process.env['COMPRESSOR_CCR'];
  t.after(() => {
    if (saved === undefined) delete process.env['COMPRESSOR_CCR'];
    else process.env['COMPRESSOR_CCR'] = saved;
  });
  const call: CompressibleCall = { toolKind: 'bash', targeted: false, text: distinctBash(600) };
  const compressed = compressCall(call, 'slim', undefined, 'sess-default');
  assert.ok(compressed.worthwhile, 'compression still happens with the stash off');
  assert.ok(!PLACEHOLDER_RE.test(compressed.text), 'no raw placeholder when CCR is off');
  assert.ok(!compressed.text.includes('compressor retrieve'), 'no retrieve handle when off');
  assert.match(
    compressed.text,
    /— re-run with a narrower filter \(grep, --quiet, head\) to retrieve\]/,
    'falls back to today’s descriptive re-run hint',
  );
  await settleCcr();
  // nothing written while off
  const dir = process.env['COMPRESSOR_CCR_DIR'];
  assert.ok(dir);
  const entries = await readdir(dir).catch(() => [] as string[]);
  assert.deepEqual(
    entries.filter((e) => !e.startsWith('.')),
    [],
    'default-off writes no chunk',
  );
});

test('compressCall with two distinct omissions emits two distinct handles, each round-trips', async (t) => {
  await freshCcrDir(t);
  // A test log whose passing lines the log filter cuts (omission 0) AND a long
  // block of distinct surviving lines that then force truncate to fire over the
  // kept content (omission 1) — a single compressCall driving 2 distinct cuts.
  const passes = Array.from({ length: 200 }, (_, i) => `  ✓ case ${i} ok (2 ms)`);
  const distinctTail = Array.from(
    { length: 800 },
    (_, i) =>
      `detail line ${String(i).padStart(5, '0')} kaboom processing some payload data here verbose`,
  );
  const text = [
    'PASS src/a.test.ts',
    ...passes,
    'FAIL src/b.test.ts',
    '  ✗ broke',
    ...distinctTail,
    'Tests: 1 failed, 200 passed',
  ].join('\n');
  const call: CompressibleCall = { toolKind: 'bash', targeted: false, text };
  const compressed = compressCall(call, 'slim', undefined, 'sess-multi');
  assert.ok(compressed.worthwhile, 'log-filter + truncate over distinct content is worthwhile');

  // INVARIANT B: no raw placeholder leaked anywhere in the multi-cut result
  assert.ok(!PLACEHOLDER_RE.test(compressed.text), 'no raw ⟦ccr:N⟧ across two omissions');

  // (a) two DISTINCT retrieve clauses appear (a regression mapping every
  // placeholder to one handle, or dropping one, fails here)
  const handles = [...compressed.text.matchAll(/— retrieve: compressor retrieve ([A-Za-z0-9_-]{16})\]/g)].map(
    (m) => m[1],
  );
  assert.equal(handles.length, 2, `expected two retrieve clauses in: ${compressed.text.slice(0, 400)}`);
  assert.equal(new Set(handles).size, 2, 'the two handles are distinct (one per omission)');

  // (b) each handle readChunk()s back to its OWN exact omitted bytes
  await settleCcr();
  const backs = await Promise.all(handles.map((h) => readChunk(h!)));
  assert.ok(backs.every((b) => b !== null), 'both stashed chunks are retrievable');
  const logChunk = backs.find((b) => b!.includes('✓ case 0 ok'));
  const tailChunk = backs.find((b) => b!.includes('detail line 00176'));
  assert.ok(logChunk, 'one handle returns the dropped passing-test lines');
  assert.ok(tailChunk, 'the other handle returns the truncated distinct-tail middle');
  assert.notEqual(logChunk, tailChunk, 'the two chunks are different content');

  // (c) the omitted regions are gone from the wire (only the head/tail kept)
  assert.ok(!compressed.text.includes('✓ case 0 ok'), 'dropped passing lines are off the wire');
  assert.ok(!compressed.text.includes('detail line 00176'), 'truncated middle is off the wire');
});

test('empty/undefined sessionId emits NO retrieve handle — degrades to the re-run hint, no stash', async (t) => {
  const dir = await freshCcrDir(t);
  const call: CompressibleCall = { toolKind: 'bash', targeted: false, text: distinctBash(600) };
  // sessionId undefined ⇒ compressCall passes '' to swapPlaceholders ⇒ a chunk
  // could never persist (sessionDir rejects ''), so emitting a `compressor
  // retrieve <handle>` would be a guaranteed miss. It must instead fall through
  // to the descriptive re-run fallback (mirroring CCR being off by default).
  const compressed = compressCall(call, 'slim', undefined, undefined);
  assert.ok(compressed.worthwhile, 'compression still happens without a session id');
  assert.ok(!PLACEHOLDER_RE.test(compressed.text), 'no raw placeholder with an empty session id');
  assert.ok(
    !compressed.text.includes('compressor retrieve'),
    'no retrieve handle for an unwritten chunk (guaranteed-miss avoided)',
  );
  assert.match(
    compressed.text,
    /— re-run with a narrower filter \(grep, --quiet, head\) to retrieve\]/,
    'carries the working re-run hint instead',
  );
  await settleCcr();
  // nothing was stashed (no usable session dir)
  const entries = await readdir(dir).catch(() => [] as string[]);
  assert.deepEqual(
    entries.filter((e) => !e.startsWith('.')),
    [],
    'an empty session id writes no chunk',
  );
});

test('model-supplied ⟦ccr:N⟧ literal in KEPT content is preserved (no over-broad sweep)', async (t) => {
  await freshCcrDir(t);
  // The model itself printed a token shaped like an engine placeholder on the
  // first row (always kept in the truncation head). The swap/sweep is scoped to
  // tokens the engine minted THIS result (⟦ccr:0⟧ for the truncated middle), so
  // the model's literal ⟦ccr:5⟧ must survive verbatim — rewriting it would be
  // content corruption.
  const rows = Array.from(
    { length: 600 },
    (_, i) => `row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur adipiscing`,
  );
  rows[0] = 'row 00000 the model literally printed ⟦ccr:5⟧ here in kept output';
  const call: CompressibleCall = { toolKind: 'bash', targeted: false, text: rows.join('\n') };
  const compressed = compressCall(call, 'slim', undefined, 'sess-literal');
  assert.ok(compressed.worthwhile);
  assert.ok(
    compressed.text.includes('⟦ccr:5⟧'),
    'the model-emitted literal in kept content is untouched',
  );
  // the engine's own token IS swapped to a real handle (and is gone)
  assert.ok(!compressed.text.includes('⟦ccr:0⟧'), 'the engine-minted ⟦ccr:0⟧ was swapped');
  assert.match(compressed.text, HANDLE_CLAUSE_RE, 'the engine cut became a real retrieve handle');
  await settleCcr();
});

// ---------------------------------------------------------------------------
// Passthrough guard (§3): never re-compress `compressor retrieve` output
// ---------------------------------------------------------------------------

test('isCompressorRetrieve detects the command robustly (and only it)', () => {
  assert.equal(isCompressorRetrieve('compressor retrieve AbCdEf0123456789'), true);
  assert.equal(isCompressorRetrieve('compressor   retrieve  X --range 1-5'), true);
  assert.equal(isCompressorRetrieve('npx compressor retrieve X'), true);
  assert.equal(isCompressorRetrieve('COMPRESSOR RETRIEVE x'), true);
  assert.equal(isCompressorRetrieve('cargo build 2>&1'), false);
  assert.equal(isCompressorRetrieve('compressor status'), false);
  assert.equal(isCompressorRetrieve(undefined), false);
  assert.equal(isCompressorRetrieve(42), false);
});

test('post-tool-use guard: a `compressor retrieve` bash output passes through uncompressed', (t) => {
  // a large output that WOULD compress if it were any other command
  const payload = JSON.stringify({
    session_id: 'sess-guard',
    tool_name: 'Bash',
    tool_input: { command: 'compressor retrieve AbCdEf0123456789' },
    tool_use_id: 'toolu_guard',
    tool_response: { stdout: distinctBash(600), stderr: '', interrupted: false, isImage: false },
  });
  const result = handlePostToolUse(payload, 'slim');
  assert.equal(result.output, null, 'retrieved output is passed through (no compression)');
  // sanity: the SAME output under a non-retrieve command DOES compress
  const compressing = JSON.stringify({
    session_id: 'sess-guard',
    tool_name: 'Bash',
    tool_input: { command: 'cat huge.log' },
    tool_use_id: 'toolu_guard2',
    tool_response: { stdout: distinctBash(600), stderr: '', interrupted: false, isImage: false },
  });
  assert.ok(handlePostToolUse(compressing, 'slim').output !== null, 'control output compresses');
});

test('opencode guard: a `compressor retrieve` bash output is left untouched', () => {
  const original = distinctBash(600);
  const output: { output: string } = { output: original };
  handleToolExecuteAfter(
    { tool: 'bash', sessionID: 'sess-oc', args: { command: 'compressor retrieve AbCdEf0123456789' } },
    output,
    'slim',
  );
  assert.equal(output.output, original, 'retrieved output is not rewritten');
});
