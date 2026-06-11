import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import type { LedgerEvent } from '../../src/ledger/write.ts';
import { appendLedger, settleLedger } from '../../src/ledger/write.ts';
import { readLedger } from '../../src/ledger/read.ts';
import { handlePostToolUse } from '../../src/hook/post-tool-use.ts';

function event(overrides: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    ts: '2026-06-10T12:00:00.000Z',
    agent: 'claude-code',
    tool: 'bash',
    mode: 'slim',
    charsIn: 1000,
    charsOut: 300,
    estTokensIn: 286,
    estTokensOut: 86,
    transforms: ['dedupe-lines', 'truncate'],
    ...overrides,
  };
}

async function withLedgerDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-ledger-'));
  const prev = process.env['COMPRESSOR_LEDGER_DIR'];
  process.env['COMPRESSOR_LEDGER_DIR'] = dir;
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) {
      delete process.env['COMPRESSOR_LEDGER_DIR'];
    } else {
      process.env['COMPRESSOR_LEDGER_DIR'] = prev;
    }
  }
}

test('write/read round-trip with monthly file naming', async () => {
  await withLedgerDir(async (dir) => {
    await appendLedger(event({ ts: '2026-05-20T08:00:00.000Z', charsIn: 500, charsOut: 100 }));
    await appendLedger(event({ ts: '2026-06-10T12:00:00.000Z' }));
    await settleLedger();

    const files = (await readdir(dir)).sort();
    assert.deepEqual(files, ['2026-05.jsonl', '2026-06.jsonl']);

    const events = await readLedger({ dir });
    assert.equal(events.length, 2);
    const [first, second] = events;
    assert.ok(first !== undefined && second !== undefined);
    assert.equal(first.ts, '2026-05-20T08:00:00.000Z');
    assert.equal(first.charsIn, 500);
    assert.equal(second.ts, '2026-06-10T12:00:00.000Z');
    assert.deepEqual(second.transforms, ['dedupe-lines', 'truncate']);

    const recent = await readLedger({ dir, since: new Date('2026-06-01T00:00:00Z') });
    assert.equal(recent.length, 1);
    assert.equal(recent[0]?.ts, '2026-06-10T12:00:00.000Z');
  });
});

test('readLedger tolerates garbage lines and wrong shapes', async () => {
  await withLedgerDir(async (dir) => {
    const valid = JSON.stringify(event());
    const lines = [
      'not json {{{',
      '42',
      '[1,2,3]',
      '{"ts": 3}',
      JSON.stringify({ ts: '2026-06-09T00:00:00Z', agent: 'claude-code' }), // missing fields
      JSON.stringify(event({ agent: 'not-an-agent' as LedgerEvent['agent'] })),
      '',
      valid,
    ];
    await writeFile(path.join(dir, '2026-06.jsonl'), `${lines.join('\n')}\n`, 'utf8');

    const events = await readLedger({ dir });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], event());
  });
});

test('readLedger of a missing directory is an empty ledger', async () => {
  const events = await readLedger({ dir: path.join(os.tmpdir(), 'compressor-ledger-nope') });
  assert.deepEqual(events, []);
});

test('COMPRESSOR_NO_LEDGER=1 kill switch writes nothing', async () => {
  await withLedgerDir(async (dir) => {
    const prev = process.env['COMPRESSOR_NO_LEDGER'];
    process.env['COMPRESSOR_NO_LEDGER'] = '1';
    try {
      await appendLedger(event());
      await settleLedger();
      assert.deepEqual(await readdir(dir), []);
    } finally {
      if (prev === undefined) {
        delete process.env['COMPRESSOR_NO_LEDGER'];
      } else {
        process.env['COMPRESSOR_NO_LEDGER'] = prev;
      }
    }
  });
});

test('settleLedger resolves fast when nothing is pending', async () => {
  const started = Date.now();
  await settleLedger();
  assert.ok(Date.now() - started < 200, 'idle settle should be immediate');
});

test('appendLedger never rejects even when the dir is a file (fail-open)', async () => {
  await withLedgerDir(async (dir) => {
    const bogus = path.join(dir, 'not-a-dir');
    await writeFile(bogus, 'occupied', 'utf8');
    const prev = process.env['COMPRESSOR_LEDGER_DIR'];
    process.env['COMPRESSOR_LEDGER_DIR'] = bogus;
    try {
      await appendLedger(event());
      await settleLedger();
    } finally {
      process.env['COMPRESSOR_LEDGER_DIR'] = prev;
    }
  });
});

test('worthwhile hook compression records a ledger event (claude-code)', async () => {
  await withLedgerDir(async (dir) => {
    const stdout = Array.from(
      { length: 400 },
      () => 'warning: unused variable `x` found while linting src/lib.rs:42',
    ).join('\n');
    const payload = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'cargo build 2>&1' },
      tool_use_id: 'toolu_ledger',
      tool_response: { stdout, stderr: '', interrupted: false, isImage: false },
    });

    const result = handlePostToolUse(payload, 'slim');
    assert.ok(result.output !== null, 'compression should engage');
    await settleLedger();

    const events = await readLedger({ dir });
    assert.equal(events.length, 1);
    const recorded = events[0];
    assert.ok(recorded !== undefined);
    assert.equal(recorded.agent, 'claude-code');
    assert.equal(recorded.tool, 'bash');
    assert.equal(recorded.mode, 'slim');
    assert.equal(recorded.charsIn, stdout.length);
    assert.ok(recorded.charsOut < recorded.charsIn, 'chars shrank');
    assert.ok(recorded.estTokensOut < recorded.estTokensIn, 'tokens shrank');
    assert.ok(recorded.transforms.length > 0, 'transform ids recorded');
    assert.ok(!Number.isNaN(Date.parse(recorded.ts)), 'ts is a parseable timestamp');
    // privacy: no paths, no content
    const line = JSON.stringify(recorded);
    assert.ok(!line.includes('cargo'), 'no command content in the event');
    assert.ok(!line.includes('lib.rs'), 'no file content in the event');
  });
});
