import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { compressCall } from '../../src/hook/core.ts';
import type { CompressibleCall } from '../../src/hook/core.ts';
import { readChunk, settleCcr, stashChunk } from '../../src/hook/ccr.ts';
import { runRetrieve } from '../../src/cli/commands/retrieve.ts';

// `compressor retrieve <handle> [--lines a-b]` — the CCR model-facing surface
// (internal/CCR-PLAN.md §3). The command is a thin shell over the FROZEN store:
// it parses --lines, calls readChunk, and maps the result to stdout/stderr + an
// exit code. All validation / path safety lives in ccr.ts and is not re-tested
// here (that is ccr.test.ts's job) — these tests pin the CLI contract:
//   - exact stdout bytes on a hit (fidelity)
//   - a 1-based inclusive --lines slice; malformed --lines ⇒ whole chunk + note
//   - a miss (expired / never stashed / traversal handle) ⇒ stderr note, exit 1,
//     NOTHING on stdout, nothing read outside the store
//   - the kill switch (COMPRESSOR_NO_CCR=1) ⇒ a miss
//   - END-TO-END: a real-hook compress→marker→retrieve loop returns the exact
//     omitted bytes
//   - the command is registered (parsing `retrieve <handle>` reaches runRetrieve)
//
// HERMETIC: COMPRESSOR_CCR_DIR → a fresh temp dir per test, restored + removed;
// the kill switch is never left set; process.stdout/stderr.write and
// process.exitCode are captured and restored around each runRetrieve.

process.env['COMPRESSOR_NO_LEDGER'] = '1';
process.env['COMPRESSOR_NO_RECOVERY_BUDGET'] = '1';
delete process.env['COMPRESSOR_NO_CCR'];

const CLI_ENTRY = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));

interface DirScope {
  after: (fn: () => void | Promise<void>) => void;
}

/** Point the CCR stash at a fresh temp dir for the test; restored + removed after. */
async function freshCcrDir(t: DirScope): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'compressor-retrieve-cli-'));
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

interface Captured {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}

/**
 * Run runRetrieve with process.stdout/stderr.write and process.exitCode
 * captured, then restored — so a failing case's exit code never leaks into the
 * test runner and the exact written bytes are observable.
 */
async function capture(handle: string, opts: { lines?: string }): Promise<Captured> {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  const savedExit = process.exitCode;
  let stdout = '';
  let stderr = '';
  process.exitCode = undefined;
  // mirror a real stream's write(chunk, cb): the hit path now delivers stdout via
  // writeHookOutput, which AWAITS the write callback — a stub that drops it would
  // hang runRetrieve forever. Invoke the callback so the await resolves.
  const collect =
    (sink: (s: string) => void) =>
    (chunk: string | Uint8Array, cb?: (error?: Error | null) => void): boolean => {
      sink(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      cb?.();
      return true;
    };
  process.stdout.write = collect((s) => {
    stdout += s;
  }) as typeof process.stdout.write;
  process.stderr.write = collect((s) => {
    stderr += s;
  }) as typeof process.stderr.write;
  try {
    await runRetrieve(handle, opts);
    return { stdout, stderr, exitCode: process.exitCode };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.exitCode = savedExit;
  }
}

function distinctBash(lines: number): string {
  return Array.from(
    { length: lines },
    (_, i) => `row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur adipiscing`,
  ).join('\n');
}

// ---------------------------------------------------------------------------
// Hit: exact bytes, line range, malformed range degradation
// ---------------------------------------------------------------------------

test('runRetrieve prints the EXACT stashed bytes for a valid handle', async (t) => {
  await freshCcrDir(t);
  // exotic bytes the CLI must not mangle: trailing newline, tabs, unicode, no
  // final newline added/stripped.
  const original = 'alpha\n\tbeta — gamma ✓\nδ line\n';
  const handle = stashChunk('sess-cli-exact', original);
  await settleCcr();

  const got = await capture(handle, {});
  assert.equal(got.stdout, original, 'stdout is byte-identical to the stashed chunk');
  assert.equal(got.stderr, '', 'no stderr on a hit');
  assert.equal(got.exitCode, undefined, 'a hit leaves the exit code unset (success)');
});

test('runRetrieve --lines A-B returns the 1-based inclusive slice', async (t) => {
  await freshCcrDir(t);
  const original = ['L1', 'L2', 'L3', 'L4', 'L5'].join('\n'); // chunk-relative (no Read prefixes)
  const handle = stashChunk('sess-cli-range', original);
  await settleCcr();

  const got = await capture(handle, { lines: '2-4' });
  assert.equal(got.stdout, 'L2\nL3\nL4', '1-based inclusive slice [2..4]');
  assert.equal(got.stderr, '', 'a well-formed range is not noted');
  assert.equal(got.exitCode, undefined, 'a sliced hit is still success');
});

test('runRetrieve with a malformed --lines retrieves the WHOLE chunk and notes it', async (t) => {
  await freshCcrDir(t);
  const original = ['one', 'two', 'three'].join('\n');
  const handle = stashChunk('sess-cli-bad-range', original);
  await settleCcr();

  for (const bad of ['abc', '3', '2-', '-5', '0-2', '1.5-3']) {
    const got = await capture(handle, { lines: bad });
    assert.equal(got.stdout, original, `malformed --lines '${bad}' falls back to the whole chunk`);
    assert.match(got.stderr, /malformed --lines/, `a note is written for '${bad}'`);
    assert.equal(got.exitCode, undefined, `'${bad}' is a degraded HIT, not a miss`);
  }
});

// ---------------------------------------------------------------------------
// Miss: expired/never-stashed, traversal/malformed handle, kill switch
// ---------------------------------------------------------------------------

test('a never-stashed handle ⇒ stderr re-run note, exit 1, nothing on stdout', async (t) => {
  await freshCcrDir(t);
  // a syntactically VALID handle (16 of [A-Za-z0-9_-]) that was never stashed
  const got = await capture('AbCdEf0123456789', {});
  assert.equal(got.stdout, '', 'nothing printed on a miss');
  assert.match(got.stderr, /not found .*re-run the original command/, 'the re-run note is printed');
  assert.equal(got.exitCode, 1, 'a miss sets a non-zero exit code so the model sees it');
});

test('a malformed/traversal handle ⇒ miss (readChunk rejects), nothing read outside the store', async (t) => {
  await freshCcrDir(t);
  for (const bad of ['../etc/passwd', '../../secret', '/etc/passwd', 'short', 'has space', '']) {
    const got = await capture(bad, {});
    assert.equal(got.stdout, '', `traversal/malformed handle '${bad}' prints nothing`);
    assert.match(got.stderr, /not found/, `'${bad}' yields the miss note`);
    assert.equal(got.exitCode, 1, `'${bad}' sets exit 1`);
  }
  // sanity: readChunk itself rejects the traversal handle (the CLI never reaches
  // a real file outside the store)
  assert.equal(await readChunk('../etc/passwd'), null, 'readChunk rejects the traversal handle');
});

test('kill switch COMPRESSOR_NO_CCR=1 ⇒ a valid, present handle still misses', async (t) => {
  await freshCcrDir(t);
  const original = distinctBash(50);
  const handle = stashChunk('sess-cli-kill', original); // stash BEFORE disabling
  await settleCcr();
  const saved = process.env['COMPRESSOR_NO_CCR'];
  process.env['COMPRESSOR_NO_CCR'] = '1';
  t.after(() => {
    if (saved === undefined) delete process.env['COMPRESSOR_NO_CCR'];
    else process.env['COMPRESSOR_NO_CCR'] = saved;
  });

  const got = await capture(handle, {});
  assert.equal(got.stdout, '', 'the kill switch makes even a present chunk unreadable');
  assert.match(got.stderr, /not found/, 'a disabled store reports the miss');
  assert.equal(got.exitCode, 1, 'the kill-switch miss sets exit 1');
});

// ---------------------------------------------------------------------------
// END-TO-END: real hook compress → marker → retrieve loop
// ---------------------------------------------------------------------------

test('END-TO-END: a real-hook CCR marker handle retrieves the exact omitted bytes', async (t) => {
  await freshCcrDir(t);
  // drive the REAL hook path over a large NON-FILE (bash) output with a session
  // id — exactly what produces a `compressor retrieve <handle>` marker.
  const call: CompressibleCall = { toolKind: 'bash', targeted: false, text: distinctBash(600) };
  const compressed = compressCall(call, 'slim', undefined, 'sess-e2e');
  assert.ok(compressed.worthwhile, 'a 600-row bash output compresses');
  await settleCcr();

  // extract the handle from the emitted marker — the same surface the model sees
  const match = /compressor retrieve ([A-Za-z0-9_-]{16})/.exec(compressed.text);
  assert.ok(match, `expected a retrieve marker in: ${compressed.text.slice(0, 300)}`);
  const handle = match[1];
  assert.ok(handle);

  // the OMITTED region is gone from the wire but recoverable via the CLI
  assert.ok(!compressed.text.includes('row 00199'), 'the omitted middle is off the wire');
  const got = await capture(handle, {});
  assert.equal(got.exitCode, undefined, 'the real handle is a hit');
  assert.equal(got.stderr, '', 'no miss note for the real handle');
  // runRetrieve(handle) === the exact omitted bytes (proves the full loop)
  const expected = await readChunk(handle);
  assert.ok(expected !== null, 'the chunk is present');
  assert.equal(got.stdout, expected, 'retrieved stdout equals the exact stashed omitted bytes');
  assert.ok(got.stdout.includes('row 00199'), 'the recovered bytes are the omitted region');
});

// ---------------------------------------------------------------------------
// Registration: parsing `retrieve <handle>` reaches runRetrieve
// ---------------------------------------------------------------------------

interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Spawn `node src/cli/index.ts <args>` with a custom env; no stdin. */
function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('exit', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

test('the command is registered: `compressor retrieve <handle>` reaches runRetrieve', async (t) => {
  const dir = await freshCcrDir(t);
  // stash a chunk in THIS dir, then spawn the real CLI pointed at the same dir —
  // a hit through the registered command proves parsing reaches runRetrieve.
  const original = 'registered-path round-trip ✓\n';
  const handle = stashChunk('sess-cli-reg', original);
  await settleCcr();

  const env: NodeJS.ProcessEnv = { ...process.env, COMPRESSOR_CCR_DIR: dir };
  delete env['COMPRESSOR_NO_CCR'];

  const hit = await runCli(['retrieve', handle], env);
  assert.equal(hit.code, 0, 'a registered hit exits 0');
  assert.equal(hit.stdout, original, 'the registered command prints the exact bytes');

  // a miss through the registered command exits non-zero with the note
  const miss = await runCli(['retrieve', 'ZzZzZzZzZzZzZzZz'], env);
  assert.equal(miss.code, 1, 'a registered miss exits non-zero');
  assert.match(miss.stderr, /not found/, 'the registered miss prints the re-run note');
});

// ---------------------------------------------------------------------------
// EPIPE: a hit piped to an early-closing reader must not crash (regression)
// ---------------------------------------------------------------------------
//
// The model runs `compressor retrieve <handle> | head`/`grep -q`/`less`; the
// reader can close the pipe before all bytes are consumed. The write then fails
// with EPIPE — surfaced as an async 'error' EVENT on stdout, NOT a write() throw
// — so the try/catch inside runRetrieve cannot cover it. Without a no-op 'error'
// listener Node turns that event into ERR_UNHANDLED_ERROR: a Node stack trace
// dumped into the model's shell and an abnormal exit. The hit path delivers via
// writeHookOutput, which attaches the listener and awaits the write callback.

/**
 * Stand-in for a stdout whose pipe the reader closed early (async EPIPE).
 * Injected into runRetrieve so the EPIPE path is exercised WITHOUT swapping the
 * global process.stdout (which would break the test reporter's own output).
 */
class BrokenPipeStdout extends EventEmitter {
  write(_chunk: string, callback?: (error?: Error | null) => void): boolean {
    queueMicrotask(() => {
      const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
      // without the no-op 'error' listener writeHookOutput attaches, this emit
      // throws ERR_UNHANDLED_ERROR — exactly the crash under regression test
      this.emit('error', error);
      callback?.(error);
    });
    return false;
  }
}

test('a hit into an early-closing reader (EPIPE) does NOT crash and stays a success', async (t) => {
  await freshCcrDir(t);
  const original = distinctBash(50);
  const handle = stashChunk('sess-cli-epipe', original);
  await settleCcr();

  // inject a broken-pipe stand-in for the hit-case delivery: its write returns
  // false and emits an async 'error' (EPIPE) — the same shape as a closed pipe.
  const broken = new BrokenPipeStdout();
  const savedExit = process.exitCode;
  process.exitCode = undefined;
  try {
    // must resolve (never reject): the async EPIPE event is absorbed
    await runRetrieve(handle, {}, broken);
    assert.equal(
      broken.listenerCount('error'),
      1,
      'a no-op error listener must be attached before the write',
    );
    assert.equal(process.exitCode, undefined, 'an absorbed EPIPE on a hit is still a success');
  } finally {
    process.exitCode = savedExit;
  }
});

test(
  'END-TO-END: real CLI `retrieve | head -c1` (reader closes early) emits no Node stack trace',
  { skip: process.platform === 'win32' ? 'POSIX pipe/head semantics' : false },
  async (t) => {
    const dir = await freshCcrDir(t);
    // big enough that the OS pipe buffer cannot swallow it whole — the producer
    // is mid-write when `head -c1` reads one byte and exits, slamming the pipe
    // shut so the next write fails with EPIPE (the async 'error' event).
    const original = distinctBash(5000);
    const handle = stashChunk('sess-cli-epipe-e2e', original);
    await settleCcr();

    const stderrFile = join(dir, 'producer.stderr');
    // run the REAL pipeline `node CLI retrieve <handle> | head -c1` in a shell so
    // an actual early-closing reader (head) delivers EPIPE to the producer. The
    // producer's stderr is redirected to a file so the pipeline doesn't drop it;
    // a Node uncaught-EPIPE crash would write ERR_UNHANDLED_ERROR / a stack there.
    const cmd =
      `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI_ENTRY)} retrieve ${handle} ` +
      `2> ${JSON.stringify(stderrFile)} | head -c1`;
    const env: NodeJS.ProcessEnv = { ...process.env, COMPRESSOR_CCR_DIR: dir };
    delete env['COMPRESSOR_NO_CCR'];

    const result = await new Promise<{ stdout: string; code: number | null }>((resolve, reject) => {
      const child = spawn('sh', ['-c', cmd], { env, stdio: ['ignore', 'pipe', 'inherit'] });
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      // a hang here means the producer blocked on a broken pipe instead of
      // taking the absorbed-EPIPE exit — fail loudly rather than stall the suite
      const guard = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('retrieve | head pipeline hung (producer blocked on EPIPE)'));
      }, 15_000);
      child.on('exit', (code) => {
        clearTimeout(guard);
        resolve({ stdout, code });
      });
    });

    assert.equal(result.stdout, 'r', '`head -c1` saw the first byte of the chunk before closing');
    const producerStderr = await readFile(stderrFile, 'utf8').catch(() => '');
    assert.doesNotMatch(
      producerStderr,
      /ERR_UNHANDLED_ERROR|Unhandled 'error'|EPIPE|node:internal/,
      `a broken pipe must not dump a Node stack trace; got: ${producerStderr.slice(0, 400)}`,
    );
  },
);
