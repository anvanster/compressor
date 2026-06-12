import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  applyRecoveryBudgetArg,
  DEFAULT_RECOVERY_BUDGET,
  noteRecoveryRead,
  noteTruncation,
  recoveryBudget,
  recoveryBudgetExceeded,
  recoveryDisabled,
  settleRecovery,
} from '../../src/hook/recovery.ts';
import { handlePostToolUse } from '../../src/hook/post-tool-use.ts';
import { handleCopilotPostToolUse } from '../../src/hook/copilot.ts';

// Recovery-read budget — the structural fix for the measured pagination
// bimodality (bench-20260610-114234/-181302): after the hook truncates a big
// read, unbudgeted targeted (offset/limit) recovery reads re-acquire
// everything. Unit tests cover the state module; protocol tests simulate the
// measured pagination pattern end-to-end through both hook layers.
//
// Hermetic: ledger off, recovery state pointed at fresh temp dirs per test
// (COMPRESSOR_RECOVERY_DIR is the documented test override for the default
// os.tmpdir()/compressor-recovery).
process.env['COMPRESSOR_NO_LEDGER'] = '1';
delete process.env['COMPRESSOR_NO_RECOVERY_BUDGET'];
delete process.env['COMPRESSOR_RECOVERY_BUDGET'];

interface DirScope {
  after: (fn: () => Promise<void>) => void;
}

/** Fresh state dir wired into the env; removed (after settle) when the test ends. */
async function freshDir(t: DirScope): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'compressor-recovery-test-'));
  process.env['COMPRESSOR_RECOVERY_DIR'] = dir;
  t.after(async () => {
    await settleRecovery();
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

interface StateShape {
  files: Record<string, { truncatedAt: number; recoveryReads: number } | undefined>;
  updatedAt: number;
}

async function readState(dir: string, sessionId: string): Promise<StateShape> {
  return JSON.parse(await readFile(join(dir, `${sessionId}.json`), 'utf8')) as StateShape;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Unit: state module
// ---------------------------------------------------------------------------

test('state round-trip: truncation note lands and drives the budget check', async (t) => {
  const dir = await freshDir(t);
  noteTruncation('s1', '/proj/a.ts');
  await settleRecovery();

  const state = await readState(dir, 's1');
  const entry = state.files['/proj/a.ts'];
  assert.ok(entry, 'truncation record exists');
  assert.equal(entry.recoveryReads, 0);
  assert.ok(entry.truncatedAt > 0);

  // budget 0 = compress ALL targeted reads of truncated files
  assert.equal(recoveryBudgetExceeded('s1', '/proj/a.ts', 0), true);
  assert.equal(recoveryBudgetExceeded('s1', '/proj/a.ts', 1), false);
  // unrelated file/session: no record → never exceeded
  assert.equal(recoveryBudgetExceeded('s1', '/proj/b.ts', 0), false);
  assert.equal(recoveryBudgetExceeded('s2', '/proj/a.ts', 0), false);
});

test('budget counting: exceeded only once recoveryReads reaches the budget', async (t) => {
  await freshDir(t);
  noteTruncation('s1', '/proj/a.ts');
  await settleRecovery();

  noteRecoveryRead('s1', '/proj/a.ts');
  noteRecoveryRead('s1', '/proj/a.ts');
  await settleRecovery();
  assert.equal(recoveryBudgetExceeded('s1', '/proj/a.ts', 3), false, '2 reads < budget 3');

  noteRecoveryRead('s1', '/proj/a.ts');
  await settleRecovery();
  assert.equal(recoveryBudgetExceeded('s1', '/proj/a.ts', 3), true, '3 reads >= budget 3');
});

test('reads of never-truncated files are not counted and create no state', async (t) => {
  const dir = await freshDir(t);
  noteRecoveryRead('s2', '/proj/never.ts');
  await settleRecovery();
  assert.equal(await exists(join(dir, 's2.json')), false, 'no state file created');
  assert.equal(recoveryBudgetExceeded('s2', '/proj/never.ts', 0), false);
});

test('re-truncation keeps the recovery counter (budget must not restart)', async (t) => {
  await freshDir(t);
  noteTruncation('s1', '/proj/a.ts');
  await settleRecovery();
  noteRecoveryRead('s1', '/proj/a.ts');
  noteRecoveryRead('s1', '/proj/a.ts');
  noteRecoveryRead('s1', '/proj/a.ts');
  await settleRecovery();
  assert.equal(recoveryBudgetExceeded('s1', '/proj/a.ts', 3), true);

  // the budget-exceeded targeted read got compressed with truncate → noted again
  noteTruncation('s1', '/proj/a.ts');
  await settleRecovery();
  assert.equal(
    recoveryBudgetExceeded('s1', '/proj/a.ts', 3),
    true,
    're-noting truncation must not re-open the pagination loop',
  );
});

test('kill switch COMPRESSOR_NO_RECOVERY_BUDGET=1: no writes, never exceeded', async (t) => {
  const dir = await freshDir(t);
  process.env['COMPRESSOR_NO_RECOVERY_BUDGET'] = '1';
  t.after(() => {
    delete process.env['COMPRESSOR_NO_RECOVERY_BUDGET'];
  });

  noteTruncation('s1', '/proj/a.ts');
  await settleRecovery();
  assert.equal(await exists(join(dir, 's1.json')), false, 'kill switch blocks writes');

  // even pre-existing exceeded state is ignored while the switch is on
  await writeFile(
    join(dir, 's9.json'),
    JSON.stringify({
      files: { '/proj/a.ts': { truncatedAt: Date.now(), recoveryReads: 100 } },
      updatedAt: Date.now(),
    }),
    'utf8',
  );
  assert.equal(recoveryBudgetExceeded('s9', '/proj/a.ts', 0), false);
});

test('COMPRESSOR_RECOVERY_BUDGET parsing: non-negative integer or default', (t) => {
  t.after(() => {
    delete process.env['COMPRESSOR_RECOVERY_BUDGET'];
  });
  delete process.env['COMPRESSOR_RECOVERY_BUDGET'];
  assert.equal(recoveryBudget(), DEFAULT_RECOVERY_BUDGET);
  assert.equal(DEFAULT_RECOVERY_BUDGET, 3);

  const cases: Array<[string, number]> = [
    ['5', 5],
    ['0', 0],
    [' 7 ', 7],
    ['abc', DEFAULT_RECOVERY_BUDGET],
    ['', DEFAULT_RECOVERY_BUDGET],
    ['-1', DEFAULT_RECOVERY_BUDGET],
    ['2.5', DEFAULT_RECOVERY_BUDGET],
    ['1e3', DEFAULT_RECOVERY_BUDGET],
  ];
  for (const [raw, expected] of cases) {
    process.env['COMPRESSOR_RECOVERY_BUDGET'] = raw;
    assert.equal(recoveryBudget(), expected, `parse ${JSON.stringify(raw)}`);
  }
});

test('corrupted state file: false and no throw; next truncation note heals it', async (t) => {
  const dir = await freshDir(t);
  await writeFile(join(dir, 's3.json'), 'not json {{{', 'utf8');

  assert.equal(recoveryBudgetExceeded('s3', '/proj/a.ts', 0), false);
  noteRecoveryRead('s3', '/proj/a.ts'); // must not throw
  await settleRecovery();

  noteTruncation('s3', '/proj/a.ts');
  await settleRecovery();
  assert.equal(recoveryBudgetExceeded('s3', '/proj/a.ts', 0), true, 'rewritten clean');
});

test('hygiene: entries older than 6h are dead on read and dropped on write', async (t) => {
  const dir = await freshDir(t);
  const now = Date.now();
  await writeFile(
    join(dir, 's4.json'),
    JSON.stringify({
      files: {
        '/proj/old.ts': { truncatedAt: now - 7 * HOUR_MS, recoveryReads: 9 },
        '/proj/fresh.ts': { truncatedAt: now - 1000, recoveryReads: 0 },
      },
      updatedAt: now - 7 * HOUR_MS,
    }),
    'utf8',
  );

  // read side: expired record no longer constrains
  assert.equal(recoveryBudgetExceeded('s4', '/proj/old.ts', 1), false);
  assert.equal(recoveryBudgetExceeded('s4', '/proj/fresh.ts', 0), true);

  // write side: next write prunes the expired entry
  noteTruncation('s4', '/proj/new.ts');
  await settleRecovery();
  const state = await readState(dir, 's4');
  assert.equal(state.files['/proj/old.ts'], undefined, 'expired entry dropped');
  assert.ok(state.files['/proj/fresh.ts'], 'fresh entry kept');
  assert.ok(state.files['/proj/new.ts'], 'new entry added');
});

test('hygiene: per-session record is capped at 200 files, oldest dropped', async (t) => {
  const dir = await freshDir(t);
  const now = Date.now();
  const files: Record<string, { truncatedAt: number; recoveryReads: number }> = {};
  for (let i = 0; i <= 200; i += 1) {
    files[`/proj/file-${i}.ts`] = { truncatedAt: now - i * 1000, recoveryReads: 0 };
  }
  await writeFile(join(dir, 's5.json'), JSON.stringify({ files, updatedAt: now }), 'utf8');

  noteTruncation('s5', '/proj/newest.ts'); // 202nd entry triggers the cap
  await settleRecovery();
  const state = await readState(dir, 's5');
  const kept = Object.keys(state.files);
  assert.equal(kept.length, 200, 'capped at 200');
  assert.ok(state.files['/proj/newest.ts'], 'newest kept');
  assert.ok(state.files['/proj/file-0.ts'], 'recent survivor kept');
  assert.equal(state.files['/proj/file-200.ts'], undefined, 'oldest dropped');
  assert.equal(state.files['/proj/file-199.ts'], undefined, 'second-oldest dropped');
});

test('hygiene: session files untouched for 24h are swept on write', async (t) => {
  const dir = await freshDir(t);
  const staleFile = join(dir, 'stale-sess.json');
  await writeFile(
    staleFile,
    JSON.stringify({ files: {}, updatedAt: Date.now() - 25 * HOUR_MS }),
    'utf8',
  );
  const old = new Date(Date.now() - 25 * HOUR_MS);
  await utimes(staleFile, old, old);
  const recentFile = join(dir, 'recent-sess.json');
  await writeFile(recentFile, JSON.stringify({ files: {}, updatedAt: Date.now() }), 'utf8');

  noteTruncation('active-sess', '/proj/x.ts');
  await settleRecovery();
  assert.equal(await exists(staleFile), false, 'stale session swept');
  assert.equal(await exists(recentFile), true, 'recent session kept');
  assert.equal(await exists(join(dir, 'active-sess.json')), true);
});

// ---------------------------------------------------------------------------
// Protocol: the measured pagination pattern (Claude Code layer)
// ---------------------------------------------------------------------------

const BIG_FILE = '/tmp/fixtures/big-output.txt';
const OTHER_FILE = '/tmp/fixtures/other.txt';

// distinct rows: dedupe/collapse no-op, kind generic → the only transform that
// fires for an untargeted slim read this size is 'truncate' (content was cut)
function rows(lines: number): string {
  return Array.from(
    { length: lines },
    (_, i) => `row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur adipiscing`,
  ).join('\n');
}

function ccReadPayload(
  sessionId: string | undefined,
  filePath: string,
  range?: { offset: number; limit: number },
): string {
  const content = rows(600);
  return JSON.stringify({
    ...(sessionId === undefined ? {} : { session_id: sessionId }),
    tool_name: 'Read',
    tool_input: { file_path: filePath, ...(range ?? {}) },
    tool_use_id: 'toolu_rb',
    tool_response: {
      type: 'text',
      file: { filePath, content, numLines: 600 },
    },
  });
}

test('pagination pattern: 3 recovery reads pass, the 4th is compressed', async (t) => {
  const dir = await freshDir(t);

  // payload 1: untargeted read of the big file → truncated, truncation noted
  const first = handlePostToolUse(ccReadPayload('sess-page', BIG_FILE), 'slim');
  assert.ok(first.output !== null, 'big untargeted read is compressed');
  assert.ok(first.output.includes('[compressor:'), 'omission marker present');
  await settleRecovery();
  const noted = await readState(dir, 'sess-page');
  assert.ok(noted.files[BIG_FILE], 'truncation recorded');
  assert.equal(noted.files[BIG_FILE]?.recoveryReads, 0);

  // payloads 2-4: targeted recovery reads within the default budget (3) pass
  for (let i = 1; i <= 3; i += 1) {
    const result = handlePostToolUse(
      ccReadPayload('sess-page', BIG_FILE, { offset: i * 100, limit: 100 }),
      'slim',
    );
    assert.equal(result.output, null, `recovery read ${i} passes through untouched`);
    await settleRecovery();
  }
  const counted = await readState(dir, 'sess-page');
  assert.equal(counted.files[BIG_FILE]?.recoveryReads, 3);

  // payload 5: budget exhausted → demoted to untargeted and compressed
  const fifth = handlePostToolUse(
    ccReadPayload('sess-page', BIG_FILE, { offset: 400, limit: 100 }),
    'slim',
  );
  assert.ok(fifth.output !== null, '4th recovery read is compressed');
  assert.ok(fifth.output.includes('[compressor:'), 'marker still says what was omitted');

  // a different, never-truncated file: targeted reads always pass through
  const other = handlePostToolUse(
    ccReadPayload('sess-page', OTHER_FILE, { offset: 0, limit: 100 }),
    'slim',
  );
  assert.equal(other.output, null, 'never-truncated file unaffected by the budget');
});

test('no session id in the payload: budget inactive, targeted reads always pass', async (t) => {
  await freshDir(t);
  const first = handlePostToolUse(ccReadPayload(undefined, BIG_FILE), 'slim');
  assert.ok(first.output !== null, 'untargeted compression itself still works');
  await settleRecovery();

  for (let i = 1; i <= 5; i += 1) {
    const result = handlePostToolUse(
      ccReadPayload(undefined, BIG_FILE, { offset: i * 100, limit: 100 }),
      'slim',
    );
    assert.equal(result.output, null, `targeted read ${i} passes through`);
    await settleRecovery();
  }
});

test('kill switch: budget never engages even with exceeded state on disk', async (t) => {
  const dir = await freshDir(t);
  await writeFile(
    join(dir, 'sess-kill.json'),
    JSON.stringify({
      files: { [BIG_FILE]: { truncatedAt: Date.now(), recoveryReads: 100 } },
      updatedAt: Date.now(),
    }),
    'utf8',
  );

  process.env['COMPRESSOR_NO_RECOVERY_BUDGET'] = '1';
  t.after(() => {
    delete process.env['COMPRESSOR_NO_RECOVERY_BUDGET'];
  });
  const off = handlePostToolUse(
    ccReadPayload('sess-kill', BIG_FILE, { offset: 0, limit: 100 }),
    'slim',
  );
  assert.equal(off.output, null, 'kill switch → targeted read passes through');

  delete process.env['COMPRESSOR_NO_RECOVERY_BUDGET'];
  const on = handlePostToolUse(
    ccReadPayload('sess-kill', BIG_FILE, { offset: 0, limit: 100 }),
    'slim',
  );
  assert.ok(on.output !== null, 'sanity: same state without the switch compresses');
});

test('COMPRESSOR_RECOVERY_BUDGET=0 compresses every targeted read of a truncated file', async (t) => {
  await freshDir(t);
  process.env['COMPRESSOR_RECOVERY_BUDGET'] = '0';
  t.after(() => {
    delete process.env['COMPRESSOR_RECOVERY_BUDGET'];
  });

  const first = handlePostToolUse(ccReadPayload('sess-zero', BIG_FILE), 'slim');
  assert.ok(first.output !== null);
  await settleRecovery();

  const result = handlePostToolUse(
    ccReadPayload('sess-zero', BIG_FILE, { offset: 0, limit: 100 }),
    'slim',
  );
  assert.ok(result.output !== null, 'budget 0 → first targeted read already compressed');
  assert.ok(result.output.includes('[compressor:'));
});

// ---------------------------------------------------------------------------
// Protocol: copilot layer mirror
// ---------------------------------------------------------------------------

function cpViewPayload(
  sessionId: string,
  filePath: string,
  range?: { offset: number; limit: number },
): string {
  return JSON.stringify({
    sessionId,
    timestamp: 1765432100000,
    cwd: '/tmp/project',
    toolName: 'view',
    toolArgs: { path: filePath, ...(range ?? {}) },
    toolResult: { resultType: 'success', textResultForLlm: rows(600) },
  });
}

test('copilot mirror: pagination pattern budgets recovery reads the same way', async (t) => {
  const dir = await freshDir(t);

  const first = handleCopilotPostToolUse(cpViewPayload('cp-sess', BIG_FILE), 'slim');
  assert.ok(first.output !== null, 'big untargeted view is compressed');
  assert.ok(first.output.includes('[compressor:'));
  await settleRecovery();
  assert.ok((await readState(dir, 'cp-sess')).files[BIG_FILE], 'truncation recorded');

  for (let i = 1; i <= 3; i += 1) {
    const result = handleCopilotPostToolUse(
      cpViewPayload('cp-sess', BIG_FILE, { offset: i * 100, limit: 100 }),
      'slim',
    );
    assert.equal(result.output, null, `recovery read ${i} passes through`);
    await settleRecovery();
  }

  const fourth = handleCopilotPostToolUse(
    cpViewPayload('cp-sess', BIG_FILE, { offset: 400, limit: 100 }),
    'slim',
  );
  assert.ok(fourth.output !== null, '4th recovery read is compressed');
  assert.ok(fourth.output.includes('[compressor:'));
});

// ---------------------------------------------------------------------------
// Entry-level: state write lands within the settle cap, clean exit
// ---------------------------------------------------------------------------

const HOOK_ENTRY = fileURLToPath(new URL('../../src/hook-entry.ts', import.meta.url));
const EXIT_BOUND_MS = 10_000;

interface RunResult {
  stdout: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

function runNode(args: string[], env: NodeJS.ProcessEnv, input: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const guard = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ stdout, code: null, signal: null, timedOut: true });
    }, EXIT_BOUND_MS);
    child.on('exit', (code, signal) => {
      clearTimeout(guard);
      if (code !== 0 && stderr !== '') {
        console.error('child stderr:', stderr.slice(0, 500));
      }
      resolve({ stdout, code, signal, timedOut: false });
    });
    child.stdin.end(input);
  });
}

test('hook entry: truncation state write lands and the process exits 0', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'compressor-recovery-entry-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COMPRESSOR_RECOVERY_DIR: dir,
    COMPRESSOR_NO_LEDGER: '1',
  };
  delete env['COMPRESSOR_NO_RECOVERY_BUDGET'];
  delete env['COMPRESSOR_RECOVERY_BUDGET'];

  const result = await runNode(
    [HOOK_ENTRY, '--mode', 'slim'],
    env,
    ccReadPayload('entry-sess', BIG_FILE),
  );
  assert.equal(result.timedOut, false, 'hook process exited');
  assert.equal(result.code, 0, 'clean exit: the state write settled within the cap');
  assert.equal(result.signal, null);
  assert.ok(result.stdout.includes('[compressor:'), 'compressed output delivered');

  const state = JSON.parse(await readFile(join(dir, 'entry-sess.json'), 'utf8')) as StateShape;
  const entry = state.files[BIG_FILE];
  assert.ok(entry, 'truncation record landed before exit');
  assert.equal(entry.recoveryReads, 0);
});

// ── --recovery-budget argv override (per-arm control for benchmarks) ────────

test('applyRecoveryBudgetArg: argv sets the env the resolvers read; invalid is a no-op', () => {
  const savedBudget = process.env['COMPRESSOR_RECOVERY_BUDGET'];
  const savedKill = process.env['COMPRESSOR_NO_RECOVERY_BUDGET'];
  try {
    delete process.env['COMPRESSOR_RECOVERY_BUDGET'];
    delete process.env['COMPRESSOR_NO_RECOVERY_BUDGET'];

    applyRecoveryBudgetArg(['--mode', 'slim', '--recovery-budget', '5']);
    assert.equal(recoveryBudget(), 5);
    assert.equal(recoveryDisabled(), false);

    applyRecoveryBudgetArg(['--recovery-budget', 'off']);
    assert.equal(recoveryDisabled(), true);

    // a numeric override re-enables after 'off' (argv wins, deterministic)
    applyRecoveryBudgetArg(['--recovery-budget', '0']);
    assert.equal(recoveryDisabled(), false);
    assert.equal(recoveryBudget(), 0);

    // fail-open: junk value and missing value change nothing
    applyRecoveryBudgetArg(['--recovery-budget', '-3']);
    assert.equal(recoveryBudget(), 0);
    applyRecoveryBudgetArg(['--recovery-budget']);
    assert.equal(recoveryBudget(), 0);
    applyRecoveryBudgetArg([]);
    assert.equal(recoveryBudget(), 0);
  } finally {
    if (savedBudget === undefined) delete process.env['COMPRESSOR_RECOVERY_BUDGET'];
    else process.env['COMPRESSOR_RECOVERY_BUDGET'] = savedBudget;
    if (savedKill === undefined) delete process.env['COMPRESSOR_NO_RECOVERY_BUDGET'];
    else process.env['COMPRESSOR_NO_RECOVERY_BUDGET'] = savedKill;
  }
});
