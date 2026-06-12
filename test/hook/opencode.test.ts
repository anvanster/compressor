import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import {
  createCompressorPlugin,
  handleToolExecuteAfter,
} from '../../src/hook/opencode.ts';
import { settleLedger } from '../../src/ledger/write.ts';
import { readLedger } from '../../src/ledger/read.ts';
import { settleRecovery } from '../../src/hook/recovery.ts';

// OpenCode tool.execute.after protocol layer (src/hook/opencode.ts) —
// synthetic hook invocations against the doc-verified signature
// (sst/opencode packages/plugin/src/index.ts, fetched 2026-06-12):
//   input:  { tool, sessionID, callID, args }
//   output: { title, output, metadata }   ← output.output mutated in place
//
// Hermetic by default: ledger off, recovery state pointed at fresh temp dirs
// per test (mirrors recovery.test.ts env hygiene); the ledger section swaps
// in a hermetic COMPRESSOR_LEDGER_DIR and restores afterwards.
process.env['COMPRESSOR_NO_LEDGER'] = '1';
delete process.env['COMPRESSOR_NO_RECOVERY_BUDGET'];
delete process.env['COMPRESSOR_RECOVERY_BUDGET'];

interface DirScope {
  after: (fn: () => Promise<void>) => void;
}

async function freshRecoveryDir(t: DirScope): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'compressor-opencode-recovery-'));
  process.env['COMPRESSOR_RECOVERY_DIR'] = dir;
  t.after(async () => {
    await settleRecovery();
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

// distinct rows: dedupe/collapse no-op, kind generic → an untargeted slim
// read this size is cut by 'truncate' (the recovery budget's trigger)
function rows(lines: number): string {
  return Array.from(
    { length: lines },
    (_, i) => `row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur adipiscing`,
  ).join('\n');
}

interface OcOutput {
  title: string;
  output: string;
  metadata: unknown;
}

function ocInput(
  tool: string,
  args: Record<string, unknown>,
  sessionID = 'oc-sess',
): Record<string, unknown> {
  return { tool, sessionID, callID: 'call_1', args };
}

function ocOutput(text: string): OcOutput {
  return { title: 'tool output', output: text, metadata: {} };
}

const BIG_FILE = '/tmp/fixtures/big-output.txt';

// ---------------------------------------------------------------------------
// Compression through the hook
// ---------------------------------------------------------------------------

test('big repetitive bash output: output.output mutated in place with the marker', async (t) => {
  await freshRecoveryDir(t);
  const original = rows(600);
  const output = ocOutput(original);
  handleToolExecuteAfter(ocInput('bash', { command: 'make noise' }), output, 'slim');

  assert.notEqual(output.output, original, 'output.output was replaced');
  assert.ok(output.output.length < original.length, 'compressed is smaller');
  assert.ok(output.output.includes('[compressor:'), 'omission marker present');
  assert.equal(output.title, 'tool output', 'sibling fields untouched');
});

test('small output stays untouched (worthwhile floor)', async (t) => {
  await freshRecoveryDir(t);
  const original = 'just a short line\nand another\n';
  const output = ocOutput(original);
  handleToolExecuteAfter(ocInput('bash', { command: 'true' }), output, 'slim');
  assert.equal(output.output, original, 'below the floor nothing is rewritten');
});

test('mode full: no mutation even for huge output', async (t) => {
  await freshRecoveryDir(t);
  const original = rows(600);
  const output = ocOutput(original);
  handleToolExecuteAfter(ocInput('bash', { command: 'x' }), output, 'full');
  assert.equal(output.output, original);
});

test('grep/glob map to search and compress like the engine search policy', async (t) => {
  await freshRecoveryDir(t);
  for (const tool of ['grep', 'glob']) {
    const original = rows(600);
    const output = ocOutput(original);
    handleToolExecuteAfter(ocInput(tool, { pattern: 'row' }), output, 'slim');
    assert.ok(output.output.includes('[compressor:'), `${tool} output compressed`);
  }
});

// ---------------------------------------------------------------------------
// Targeted reads + recovery budget (doc-verified read args: filePath/offset/limit)
// ---------------------------------------------------------------------------

test('read with offset/limit passes through (targeted by design)', async (t) => {
  await freshRecoveryDir(t);
  const original = rows(600);
  const output = ocOutput(original);
  handleToolExecuteAfter(
    ocInput('read', { filePath: '/tmp/fixtures/other.txt', offset: 100, limit: 600 }),
    output,
    'slim',
  );
  assert.equal(output.output, original, 'targeted read never compressed');
});

test('pagination pattern: truncation noted, 3 recovery reads pass, the 4th compresses', async (t) => {
  const dir = await freshRecoveryDir(t);

  // untargeted read of the big file → truncated, truncation noted
  const first = ocOutput(rows(600));
  handleToolExecuteAfter(ocInput('read', { filePath: BIG_FILE }), first, 'slim');
  assert.ok(first.output.includes('[compressor:'), 'big untargeted read compressed');
  await settleRecovery();
  const state = JSON.parse(await readFile(join(dir, 'oc-sess.json'), 'utf8')) as {
    files: Record<string, { recoveryReads: number } | undefined>;
  };
  assert.ok(state.files[BIG_FILE], 'truncation recorded under input.sessionID');
  assert.equal(state.files[BIG_FILE]?.recoveryReads, 0);

  // targeted recovery reads within the default budget (3) pass through
  for (let i = 1; i <= 3; i += 1) {
    const output = ocOutput(rows(600));
    const before = output.output;
    handleToolExecuteAfter(
      ocInput('read', { filePath: BIG_FILE, offset: i * 100, limit: 100 }),
      output,
      'slim',
    );
    assert.equal(output.output, before, `recovery read ${i} passes through`);
    await settleRecovery();
  }

  // budget exhausted → demoted to untargeted and compressed
  const fourth = ocOutput(rows(600));
  handleToolExecuteAfter(
    ocInput('read', { filePath: BIG_FILE, offset: 400, limit: 100 }),
    fourth,
    'slim',
  );
  assert.ok(fourth.output.includes('[compressor:'), '4th recovery read is compressed');

  // a different, never-truncated file: targeted reads still pass
  const other = ocOutput(rows(600));
  const otherBefore = other.output;
  handleToolExecuteAfter(
    ocInput('read', { filePath: '/tmp/fixtures/never.txt', offset: 0, limit: 100 }),
    other,
    'slim',
  );
  assert.equal(other.output, otherBefore, 'never-truncated file unaffected');
});

// ---------------------------------------------------------------------------
// Fail-open on garbage
// ---------------------------------------------------------------------------

test('garbage/missing fields: no throw, no mutation', async (t) => {
  await freshRecoveryDir(t);
  const big = rows(600);

  // non-record input/output
  assert.doesNotThrow(() => handleToolExecuteAfter(null, null, 'slim'));
  assert.doesNotThrow(() => handleToolExecuteAfter('x', 42, 'slim'));
  assert.doesNotThrow(() => handleToolExecuteAfter(undefined, [], 'slim'));

  // output.output not a string → untouched
  const numeric = { title: 't', output: 12345, metadata: null };
  handleToolExecuteAfter(ocInput('bash', {}), numeric, 'slim');
  assert.equal(numeric.output, 12345);

  // missing tool / sessionID / args still compresses the string fail-open
  const bare = ocOutput(big);
  handleToolExecuteAfter({}, bare, 'slim');
  assert.ok(bare.output.includes('[compressor:'), 'unknown tool degrades to other, still compresses');

  // hostile args shapes never throw
  for (const args of [null, 'string-args', 17, ['array']]) {
    const output = ocOutput(big);
    assert.doesNotThrow(() =>
      handleToolExecuteAfter({ tool: 'read', sessionID: 's', callID: 'c', args }, output, 'slim'),
    );
  }
});

// ---------------------------------------------------------------------------
// Ledger (hermetic COMPRESSOR_LEDGER_DIR)
// ---------------------------------------------------------------------------

test('worthwhile compression writes a ledger event with agent opencode', async (t) => {
  await freshRecoveryDir(t);
  const ledgerDir = await mkdtemp(join(tmpdir(), 'compressor-opencode-ledger-'));
  const savedNoLedger = process.env['COMPRESSOR_NO_LEDGER'];
  process.env['COMPRESSOR_LEDGER_DIR'] = ledgerDir;
  delete process.env['COMPRESSOR_NO_LEDGER'];
  t.after(async () => {
    process.env['COMPRESSOR_NO_LEDGER'] = savedNoLedger ?? '1';
    delete process.env['COMPRESSOR_LEDGER_DIR'];
    await settleLedger();
    await rm(ledgerDir, { recursive: true, force: true });
  });

  const original = rows(600);
  const output = ocOutput(original);
  handleToolExecuteAfter(ocInput('bash', { command: 'make noise' }), output, 'optimized');
  assert.ok(output.output.includes('[compressor:'), 'precondition: compression happened');
  await settleLedger();

  const events = await readLedger({ dir: ledgerDir });
  assert.equal(events.length, 1, 'exactly one event');
  const event = events[0];
  assert.ok(event);
  assert.equal(event.agent, 'opencode');
  assert.equal(event.tool, 'bash');
  assert.equal(event.mode, 'optimized');
  assert.equal(event.charsIn, original.length);
  assert.equal(event.charsOut, output.output.length);
  assert.ok(event.charsOut < event.charsIn);
});

test('COMPRESSOR_NO_LEDGER=1: compression still works, nothing written', async (t) => {
  await freshRecoveryDir(t);
  const ledgerDir = await mkdtemp(join(tmpdir(), 'compressor-opencode-noledger-'));
  process.env['COMPRESSOR_LEDGER_DIR'] = ledgerDir;
  process.env['COMPRESSOR_NO_LEDGER'] = '1'; // explicit: the module default above
  t.after(async () => {
    delete process.env['COMPRESSOR_LEDGER_DIR'];
    await settleLedger();
    await rm(ledgerDir, { recursive: true, force: true });
  });

  const output = ocOutput(rows(600));
  handleToolExecuteAfter(ocInput('bash', { command: 'x' }), output, 'slim');
  assert.ok(output.output.includes('[compressor:'), 'kill switch never blocks compression');
  await settleLedger();
  assert.deepEqual(await readdir(ledgerDir), [], 'no ledger file written');
});

// ---------------------------------------------------------------------------
// Plugin factory (documented plugin shape)
// ---------------------------------------------------------------------------

test('createCompressorPlugin: documented shape — async plugin returning the hooks object', async (t) => {
  await freshRecoveryDir(t);
  const plugin = createCompressorPlugin('slim');
  // per https://opencode.ai/docs/plugins/ the plugin receives a context object
  const hooks = await plugin({ project: {}, directory: '/tmp', worktree: '/tmp' });
  const hook = hooks['tool.execute.after'];
  assert.equal(typeof hook, 'function');

  const original = rows(600);
  const output = ocOutput(original);
  await hook(ocInput('bash', { command: 'noise' }), output);
  assert.ok(output.output.includes('[compressor:'), 'hook compresses through the factory');
});

test('createCompressorPlugin: junk mode falls back to optimized and stays harmless', async (t) => {
  await freshRecoveryDir(t);
  // the loader calls every export as a plugin — a PluginInput object as
  // "mode" must produce a working default-mode plugin, never a throw
  const plugin = createCompressorPlugin({ project: {}, client: {} });
  const hooks = await plugin();
  const output = ocOutput(rows(600));
  await hooks['tool.execute.after'](ocInput('bash', { command: 'x' }), output);
  assert.ok(output.output.includes('[compressor:'), 'defaulted mode compresses');

  // ledger/recovery state files for this test settle before dir removal
  await settleLedger();
});
