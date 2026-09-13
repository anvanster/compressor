import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import type { LedgerEvent } from '../../src/ledger/write.ts';
import { PROJECT_LABEL_MAX, appendLedger, settleLedger } from '../../src/ledger/write.ts';
import { readLedger } from '../../src/ledger/read.ts';
import { existsSync } from 'node:fs';
import {
  projectLabel,
  readProjectSaltSync,
  resolveProjectSaltPath,
} from '../../src/ledger/project.ts';
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

// the VS Code extension records with agent 'vscode' — the writer accepts it
// and the reader's validation set round-trips it
test("agent 'vscode' round-trips through write and read", async () => {
  await withLedgerDir(async (dir) => {
    await appendLedger(event({ agent: 'vscode', tool: 'read' }));
    await settleLedger();
    const events = await readLedger({ dir });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.agent, 'vscode');
    assert.equal(events[0]?.tool, 'read');
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

/** A tool output big and repetitive enough that compression is worthwhile. */
function compressiblePayload(toolUseId: string): string {
  const stdout = Array.from(
    { length: 400 },
    () => 'warning: unused variable `x` found while linting src/lib.rs:42',
  ).join('\n');
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'cargo build 2>&1' },
    tool_use_id: toolUseId,
    tool_response: { stdout, stderr: '', interrupted: false, isImage: false },
  });
}

/** Point the key at a fresh temp location: never the developer's real one. */
async function withSaltPath<T>(file: string | undefined, fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-hook-salt-'));
  const prev = process.env['COMPRESSOR_PROJECT_SALT'];
  process.env['COMPRESSOR_PROJECT_SALT'] = file ?? path.join(dir, 'nested', 'project-salt');
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env['COMPRESSOR_PROJECT_SALT'];
    else process.env['COMPRESSOR_PROJECT_SALT'] = prev;
  }
}

test('the hook attributes its event to the working directory, so `--by project` has a writer', async () => {
  await withLedgerDir(async (dir) => {
    await withSaltPath(undefined, async () => {
      assert.ok(handlePostToolUse(compressiblePayload('toolu_project'), 'slim').output !== null);
      await settleLedger();

      const events = await readLedger({ dir });
      const recorded = events[0];
      assert.ok(recorded !== undefined);
      // the label the extension would compute for the same folder, from the
      // key the hook had to create inline for its single tool call
      const salt = readProjectSaltSync();
      assert.ok(salt !== undefined, 'the key was created by the hook run itself');
      assert.equal(recorded.project, projectLabel(process.cwd(), 'hashed', salt));
      assert.match(recorded.project!, /^#[0-9a-f]{12}$/, 'a keyed digest, not a path');
      assert.ok(
        !JSON.stringify(recorded).includes(process.cwd()),
        'the working directory never reaches the ledger',
      );
    });
  });
});

test('a key location that cannot be created costs the label, never the event', async () => {
  await withLedgerDir(async (dir) => {
    // a file where a directory would have to go: the same shape as the
    // read-only home this has to survive (container, CI, sandboxed agent)
    const blocker = path.join(dir, 'blocker');
    await writeFile(blocker, 'occupied', 'utf8');
    await withSaltPath(path.join(blocker, 'project-salt'), async () => {
      assert.ok(handlePostToolUse(compressiblePayload('toolu_nokey'), 'slim').output !== null);
      await settleLedger();

      const events = await readLedger({ dir });
      const recorded = events[0];
      assert.ok(recorded !== undefined, 'the compression is still recorded');
      // an unsalted digest is the one thing worse than no label at all
      assert.equal(recorded.project, undefined);
      assert.ok(recorded.charsOut < recorded.charsIn, 'the savings data is intact');
    });
  });
});

test('COMPRESSOR_NO_LEDGER=1 stops the key too, not just the append', async () => {
  await withLedgerDir(async (dir) => {
    await withSaltPath(undefined, async () => {
      const prev = process.env['COMPRESSOR_NO_LEDGER'];
      process.env['COMPRESSOR_NO_LEDGER'] = '1';
      try {
        assert.ok(
          handlePostToolUse(compressiblePayload('toolu_killswitch'), 'slim').output !== null,
          'compression itself is unaffected by the kill switch',
        );
        await settleLedger();

        assert.deepEqual(await readdir(dir), [], 'nothing appended');
        // labelling is the first step of recording, and it writes: an opt-out
        // that still plants a key in the user's home is not an opt-out
        assert.ok(!existsSync(resolveProjectSaltPath()), 'no key created');
      } finally {
        if (prev === undefined) delete process.env['COMPRESSOR_NO_LEDGER'];
        else process.env['COMPRESSOR_NO_LEDGER'] = prev;
      }
    });
  });
});

test('project label round-trips, and a bad one drops the label but keeps the event', async () => {
  await withLedgerDir(async (dir) => {
    await appendLedger(event({ ts: '2026-06-10T12:00:00.000Z', project: '#a3f9c2e10b44' }));
    // an unusable label must never cost us the savings data on that line
    await appendLedger({ ...event({ ts: '2026-06-10T13:00:00.000Z' }), project: 'x'.repeat(PROJECT_LABEL_MAX + 1) });
    await appendLedger({ ...event({ ts: '2026-06-10T14:00:00.000Z' }), project: 'has\nnewline' });
    await appendLedger({ ...event({ ts: '2026-06-10T15:00:00.000Z' }), project: '' });
    await appendLedger({ ...event({ ts: '2026-06-10T16:00:00.000Z' }), project: 42 as unknown as string });
    await settleLedger();

    const events = await readLedger({ dir });
    assert.equal(events.length, 5, 'every event survives');
    assert.equal(events[0]?.project, '#a3f9c2e10b44');
    for (const bad of events.slice(1)) {
      assert.equal(bad.project, undefined);
      assert.equal(bad.charsIn, 1000, 'savings data is intact');
    }
  });
});

test('a label exactly at the limit is kept; events without one stay undefined', async () => {
  await withLedgerDir(async (dir) => {
    const exact = 'p'.repeat(PROJECT_LABEL_MAX);
    await appendLedger(event({ ts: '2026-06-10T12:00:00.000Z', project: exact }));
    await appendLedger(event({ ts: '2026-06-10T13:00:00.000Z' }));
    await settleLedger();

    const events = await readLedger({ dir });
    assert.equal(events[0]?.project, exact);
    assert.equal(events[1]?.project, undefined);
    assert.ok(!('project' in events[1]!), 'absent, not an undefined key');
  });
});

test('unknown fields are still discarded: the rebuild is a whitelist', async () => {
  await withLedgerDir(async (dir) => {
    const line = JSON.stringify({ ...event(), project: '#ok', injected: '<script>', nested: { a: 1 } });
    await writeFile(path.join(dir, '2026-06.jsonl'), `${line}\n`, 'utf8');

    const events = await readLedger({ dir });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.project, '#ok');
    assert.ok(!('injected' in events[0]!), 'unknown keys never reach consumers');
    assert.ok(!('nested' in events[0]!));
  });
});
