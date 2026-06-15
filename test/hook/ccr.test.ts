import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import process from 'node:process';
import {
  ccrDisabled,
  ccrTtlMs,
  handleFor,
  readChunk,
  resolveCcrDir,
  settleCcr,
  stashChunk,
  _clearAllForTest,
  _readFileNoFollowForTest,
  _resetSweepThrottleForTest,
} from '../../src/hook/ccr.ts';

// CCR stash store — the durable half of "lossy on the wire, lossless on demand"
// (internal/CCR-PLAN.md §1/§6). This suite is HERMETIC: COMPRESSOR_CCR_DIR is
// pointed at a fresh mkdtemp dir per test and restored after, so the real stash
// (os.tmpdir()/compressor-ccr) is never touched. The adversarial block is
// first-class: it pins the §6 "can't read or delete the wrong thing" property
// (traversal handles, symlinked dirs/files, foreign dirs lacking the sentinel,
// sensitive roots, realpath confinement, keepSession, concurrent dedup).
//
// Env hygiene: clear the kill switch and TTL override at module load so a dirty
// ambient env can't taint the suite; each test that sets them restores after.
delete process.env['COMPRESSOR_NO_CCR'];
delete process.env['COMPRESSOR_CCR_TTL'];

const SENTINEL = '.compressor-ccr';
const HOUR_MS = 60 * 60 * 1000;

interface DirScope {
  after: (fn: () => void | Promise<void>) => void;
}

/** Fresh owned root wired into the env; removed (after settle) when the test ends. */
async function freshDir(t: DirScope): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'compressor-ccr-test-'));
  const savedDir = process.env['COMPRESSOR_CCR_DIR'];
  process.env['COMPRESSOR_CCR_DIR'] = dir;
  t.after(async () => {
    await settleCcr();
    if (savedDir === undefined) {
      delete process.env['COMPRESSOR_CCR_DIR'];
    } else {
      process.env['COMPRESSOR_CCR_DIR'] = savedDir;
    }
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Functional
// ---------------------------------------------------------------------------

test('resolveCcrDir / ccrTtlMs / ccrDisabled honor the env at call time', (t) => {
  const savedDir = process.env['COMPRESSOR_CCR_DIR'];
  const savedTtl = process.env['COMPRESSOR_CCR_TTL'];
  const savedKill = process.env['COMPRESSOR_NO_CCR'];
  t.after(() => {
    if (savedDir === undefined) delete process.env['COMPRESSOR_CCR_DIR'];
    else process.env['COMPRESSOR_CCR_DIR'] = savedDir;
    if (savedTtl === undefined) delete process.env['COMPRESSOR_CCR_TTL'];
    else process.env['COMPRESSOR_CCR_TTL'] = savedTtl;
    if (savedKill === undefined) delete process.env['COMPRESSOR_NO_CCR'];
    else process.env['COMPRESSOR_NO_CCR'] = savedKill;
  });

  delete process.env['COMPRESSOR_CCR_DIR'];
  assert.equal(resolveCcrDir(), join(tmpdir(), 'compressor-ccr'));
  process.env['COMPRESSOR_CCR_DIR'] = '/somewhere/else';
  assert.equal(resolveCcrDir(), '/somewhere/else');

  const DEFAULT = 6 * HOUR_MS;
  delete process.env['COMPRESSOR_CCR_TTL'];
  assert.equal(ccrTtlMs(), DEFAULT, 'default 6h');
  const cases: Array<[string, number]> = [
    ['1000', 1000],
    [' 42 ', 42],
    ['0', DEFAULT], // zero is not a valid positive TTL → default
    ['-5', DEFAULT],
    ['2.5', DEFAULT],
    ['abc', DEFAULT],
    ['', DEFAULT],
  ];
  for (const [raw, expected] of cases) {
    process.env['COMPRESSOR_CCR_TTL'] = raw;
    assert.equal(ccrTtlMs(), expected, `ttl parse ${JSON.stringify(raw)}`);
  }

  delete process.env['COMPRESSOR_NO_CCR'];
  assert.equal(ccrDisabled(), false);
  process.env['COMPRESSOR_NO_CCR'] = '1';
  assert.equal(ccrDisabled(), true);
  process.env['COMPRESSOR_NO_CCR'] = '0';
  assert.equal(ccrDisabled(), false, 'only "1" disables');
});

test('handleFor: sha256/base64url prefix, 16 chars in the handle alphabet, deterministic', () => {
  const h = handleFor('hello world');
  assert.match(h, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(h, handleFor('hello world'), 'deterministic');
  assert.notEqual(h, handleFor('hello worle'), 'distinct content → distinct handle');
});

test('stash → read roundtrip; chunk file lands under <root>/<session>/<handle>', async (t) => {
  const dir = await freshDir(t);
  const text = 'line one\nline two\nline three\n';
  const handle = stashChunk('sess-a', text);
  assert.match(handle, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(handle, handleFor(text));
  await settleCcr();

  // physical layout
  assert.ok(await exists(join(dir, SENTINEL)), 'sentinel written at root');
  assert.ok(await exists(join(dir, 'sess-a', handle)), 'chunk under session dir');

  // permission modes (POSIX only — win32 does not enforce mode bits)
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(dir, 'sess-a'))).mode & 0o777, 0o700, 'session dir 0700');
    assert.equal((await stat(join(dir, 'sess-a', handle))).mode & 0o777, 0o600, 'chunk 0600');
    assert.equal((await stat(join(dir, SENTINEL))).mode & 0o777, 0o600, 'sentinel 0600');
  }

  const got = await readChunk(handle);
  assert.equal(got, text, 'exact bytes recovered (session-less read)');
});

test('dedup: same text → same handle, exactly one file even across sessions', async (t) => {
  const dir = await freshDir(t);
  const text = 'dup payload\n';
  const h1 = stashChunk('sess-x', text);
  const h2 = stashChunk('sess-x', text);
  assert.equal(h1, h2, 'same content → same handle');
  await settleCcr();

  const files = await readdir(join(dir, 'sess-x'));
  assert.deepEqual(files, [h1], 'one file, write-once dedup');
});

test('sub-range read: chunk-relative 1-based inclusive', async (t) => {
  await freshDir(t);
  const text = 'a\nb\nc\nd\ne';
  const handle = stashChunk('sess-r', text);
  await settleCcr();

  assert.equal(await readChunk(handle, { start: 2, end: 4 }), 'b\nc\nd');
  assert.equal(await readChunk(handle, { start: 1, end: 1 }), 'a');
  assert.equal(await readChunk(handle, { start: 4, end: 99 }), 'd\ne', 'end past EOF clamps');
  assert.equal(await readChunk(handle, { start: 5, end: 2 }), '', 'inverted range → empty');
});

test('sub-range read: original coordinates via embedded "N→" Read prefixes', async (t) => {
  await freshDir(t);
  const text = '  400→const a = 1\n  401→const b = 2\n  402→const c = 3\n  403→const d = 4';
  const handle = stashChunk('sess-coord', text);
  await settleCcr();

  // request original lines 401-402 — must map through the N→ prefixes
  assert.equal(
    await readChunk(handle, { start: 401, end: 402 }),
    '  401→const b = 2\n  402→const c = 3',
  );
  // a range below the original coordinates selects nothing
  assert.equal(await readChunk(handle, { start: 1, end: 10 }), '');
});

test('missing handle → null (well-formed but never stashed)', async (t) => {
  await freshDir(t);
  const ghost = handleFor('was never stashed');
  assert.match(ghost, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(await readChunk(ghost), null);
});

test('settleCcr resolves after fire-and-forget writes (and on an idle store)', async (t) => {
  const dir = await freshDir(t);
  const handle = stashChunk('sess-s', 'settle me\n');
  // before settle the write may still be in flight; after, the file is durable
  await settleCcr();
  assert.ok(await exists(join(dir, 'sess-s', handle)), 'write flushed by settle');
  await settleCcr(); // idempotent / never rejects on an idle store
});

test('TTL prune: stale session dir removed, fresh kept; keepSession never removed', async (t) => {
  const dir = await freshDir(t);
  process.env['COMPRESSOR_CCR_TTL'] = String(HOUR_MS); // 1h TTL for the test
  const savedTtl = HOUR_MS;
  t.after(() => {
    delete process.env['COMPRESSOR_CCR_TTL'];
  });
  // sentinel so sweep recognizes the root as ours
  writeFileSync(join(dir, SENTINEL), '');

  const stale = join(dir, 'stale-sess');
  const fresh = join(dir, 'fresh-sess');
  const live = join(dir, 'live-sess');
  for (const d of [stale, fresh, live]) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, handleFor(d)), 'x');
  }
  const old = new Date(Date.now() - 3 * savedTtl);
  await utimes(stale, old, old);
  // live-sess is ALSO stale by mtime, to prove keepSession excludes it from TTL
  await utimes(live, old, old);

  const { sweep } = await import('../../src/hook/ccr.ts');
  await sweep('live-sess');

  assert.equal(await exists(stale), false, 'stale session swept');
  assert.equal(await exists(fresh), true, 'fresh session kept');
  assert.equal(await exists(live), true, 'keepSession kept despite being stale');
});

test('byte-cap eviction: oldest chunk files evicted until under the cap', async (t) => {
  const dir = await freshDir(t);
  writeFileSync(join(dir, SENTINEL), '');
  const sess = join(dir, 'cap-sess');
  mkdirSync(sess, { recursive: true });

  // 6 chunks of ~2 MiB each = ~12 MiB, over the 8 MiB per-session cap.
  // distinct content → distinct (valid) handles; mtimes ascending so the
  // oldest are deterministic.
  const chunkBytes = 2 * 1024 * 1024;
  const handles: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const text = String(i).repeat(chunkBytes);
    const h = handleFor(text);
    handles.push(h);
    writeFileSync(join(sess, h), text);
    const when = new Date(Date.now() - (6 - i) * 60_000); // i=0 oldest
    await utimes(join(sess, h), when, when);
  }

  const { sweep } = await import('../../src/hook/ccr.ts');
  await sweep(); // no keepSession → cap applies to this dir

  const remaining = await readdir(sess);
  const remainingBytes = remaining.length * chunkBytes;
  assert.ok(remainingBytes <= 8 * 1024 * 1024, `under cap: ${remainingBytes} bytes`);
  // the OLDEST (i=0,1,...) go first; the newest must survive
  assert.ok(remaining.includes(handles[5] as string), 'newest chunk kept');
  assert.ok(!remaining.includes(handles[0] as string), 'oldest chunk evicted');
});

test('entry-cap eviction: >512 small chunks trimmed to <=512, oldest evicted, newest kept', async (t) => {
  const dir = await freshDir(t);
  writeFileSync(join(dir, SENTINEL), '');
  const sess = join(dir, 'entry-sess');
  mkdirSync(sess, { recursive: true });

  // 520 tiny distinct chunks (a few bytes each) — well under the 8 MiB byte cap
  // but over the 512-entry cap, so ONLY the entry cap can do the eviction.
  const total = 520;
  const handles: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const text = `chunk-${i}\n`; // distinct content → distinct valid handle
    const h = handleFor(text);
    handles.push(h);
    writeFileSync(join(sess, h), text);
    const when = new Date(Date.now() - (total - i) * 1000); // i=0 oldest
    await utimes(join(sess, h), when, when);
  }
  // sanity: distinct handles, so the file count really is `total`
  assert.equal(new Set(handles).size, total, 'all handles distinct');
  assert.equal((await readdir(sess)).length, total, 'all chunks written');

  const { sweep } = await import('../../src/hook/ccr.ts');
  await sweep(); // no keepSession → cap applies to this dir

  const remaining = await readdir(sess);
  assert.ok(remaining.length <= 512, `trimmed to entry cap: ${remaining.length}`);
  // the oldest go first; the newest must survive
  assert.ok(remaining.includes(handles[total - 1] as string), 'newest chunk kept');
  assert.ok(!remaining.includes(handles[0] as string), 'oldest chunk evicted');
});

test('cap still applies to the kept (live) session: TTL-excluded but oldest chunks evicted', async (t) => {
  const dir = await freshDir(t);
  process.env['COMPRESSOR_CCR_TTL'] = String(HOUR_MS); // 1h TTL
  t.after(() => {
    delete process.env['COMPRESSOR_CCR_TTL'];
  });
  writeFileSync(join(dir, SENTINEL), '');
  const live = join(dir, 'live-cap-sess');
  mkdirSync(live, { recursive: true });

  // over the byte cap (6 x ~2 MiB = ~12 MiB) AND stale by mtime
  const chunkBytes = 2 * 1024 * 1024;
  const handles: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const text = String(i).repeat(chunkBytes);
    const h = handleFor(text);
    handles.push(h);
    writeFileSync(join(live, h), text);
    const when = new Date(Date.now() - (6 - i) * 60_000); // i=0 oldest
    await utimes(join(live, h), when, when);
  }
  // make the dir itself stale so TTL WOULD remove it if not for keepSession
  const stale = new Date(Date.now() - 3 * HOUR_MS);
  await utimes(live, stale, stale);

  const { sweep } = await import('../../src/hook/ccr.ts');
  await sweep('live-cap-sess'); // keepSession excludes it from TTL removal

  assert.equal(await exists(live), true, 'live session kept despite being stale (TTL excluded)');
  const remaining = await readdir(live);
  const remainingBytes = remaining.length * chunkBytes;
  assert.ok(remainingBytes <= 8 * 1024 * 1024, `cap still applied to live: ${remainingBytes} bytes`);
  assert.ok(remaining.includes(handles[5] as string), 'newest chunk kept');
  assert.ok(!remaining.includes(handles[0] as string), 'oldest chunk evicted on the live session');
});

test('kill switch COMPRESSOR_NO_CCR=1: no writes, reads return null', async (t) => {
  const dir = await freshDir(t);
  // stash one chunk WITH the feature on, so a file exists on disk
  const handle = stashChunk('sess-kill', 'present on disk\n');
  await settleCcr();
  assert.ok(await exists(join(dir, 'sess-kill', handle)), 'baseline write landed');

  process.env['COMPRESSOR_NO_CCR'] = '1';
  t.after(() => {
    delete process.env['COMPRESSOR_NO_CCR'];
  });

  // reads are blocked even though the file exists
  assert.equal(await readChunk(handle), null, 'kill switch blocks reads');
  // new writes are blocked (still returns the handle — fail-open contract)
  const h2 = stashChunk('sess-kill2', 'should not be written\n');
  assert.equal(h2, handleFor('should not be written\n'), 'handle still returned');
  await settleCcr();
  assert.equal(await exists(join(dir, 'sess-kill2')), false, 'kill switch blocks writes');
});

test('hostile session ids: handle still returned, nothing escapes <root>/<sanitized>/', async (t) => {
  const dir = await freshDir(t);
  const text = 'hostile-id payload\n';
  const expected = handleFor(text);

  const hostile = ['..', '.', '', '/abs', '../../etc', 'a'.repeat(129)];
  for (const id of hostile) {
    // fail-open contract: the handle is ALWAYS returned regardless of the id
    assert.equal(stashChunk(id, text), expected, `handle returned for ${JSON.stringify(id)}`);
  }
  await settleCcr();

  // No escaping/traversal path may have been created. Enumerate the root: every
  // entry is either the sentinel or a single-segment name within the allowlist
  // alphabet (never '..', '.', '', an absolute fragment, or a > 128-char name);
  // and no chunk file may exist outside a <root>/<sanitized>/ session dir.
  for (const entry of await readdir(dir)) {
    if (entry === SENTINEL) {
      continue;
    }
    // a hostile id must never materialize as a literal traversal/absolute name
    assert.ok(entry !== '..' && entry !== '.' && entry !== '', `no dot-name entry: ${entry}`);
    assert.match(entry, /^[A-Za-z0-9._-]{1,128}$/, `entry within session alphabet: ${entry}`);
    // and it must be a directory (a session dir), not a stray chunk at the root
    assert.equal(lstatSync(join(dir, entry)).isDirectory(), true, `root entry is a dir: ${entry}`);
  }
  // the parent of the root must NOT have gained a sibling from '/abs' or '../..'
  assert.equal(await exists(join(dir, '..', 'abs')), false, 'no /abs escape into parent');
  assert.equal(await exists('/abs'), false, 'no write to filesystem-root /abs');
});

test('opportunistic-sweep throttle: first stash sweeps a stale dir, second within the window does not', async (t) => {
  const dir = await freshDir(t);
  process.env['COMPRESSOR_CCR_TTL'] = String(HOUR_MS); // 1h TTL
  t.after(() => {
    delete process.env['COMPRESSOR_CCR_TTL'];
  });
  writeFileSync(join(dir, SENTINEL), '');
  // reset the module-global throttle so the FIRST stash's maybeSweep can fire
  // (earlier tests advance it; SWEEP_INTERVAL_MS is 5 min so it would be closed)
  _resetSweepThrottleForTest();

  const old = new Date(Date.now() - 3 * HOUR_MS);

  // plant a stale session dir, then stash → maybeSweep should fire and remove it
  const stale1 = join(dir, 'stale-one');
  mkdirSync(stale1, { recursive: true });
  writeFileSync(join(stale1, handleFor('s1')), 'x');
  await utimes(stale1, old, old);

  stashChunk('throttle-sess', 'first\n');
  await settleCcr();
  assert.equal(await exists(stale1), false, 'first stash auto-swept the stale dir (maybeSweep fired)');

  // plant a SECOND stale dir, then stash AGAIN immediately — within the same
  // SWEEP_INTERVAL_MS window the throttle must suppress a second enumeration,
  // so this dir survives.
  const stale2 = join(dir, 'stale-two');
  mkdirSync(stale2, { recursive: true });
  writeFileSync(join(stale2, handleFor('s2')), 'x');
  await utimes(stale2, old, old);

  stashChunk('throttle-sess', 'second\n');
  await settleCcr();
  assert.equal(await exists(stale2), true, 'second stash within the window did NOT sweep (throttle held)');
});

// ---------------------------------------------------------------------------
// Adversarial (CCR-PLAN.md §6 — first-class security cases)
// ---------------------------------------------------------------------------

test('readChunk rejects traversal / malformed handles → null, no read outside root', async (t) => {
  const dir = await freshDir(t);
  // a real, readable secret OUTSIDE the root we must never be able to reach
  const secretDir = await mkdtemp(join(tmpdir(), 'compressor-ccr-secret-'));
  t.after(async () => {
    await rm(secretDir, { recursive: true, force: true });
  });
  const secret = join(secretDir, 'passwd');
  writeFileSync(secret, 'TOP SECRET\n');
  // also plant a same-named handle-shaped decoy as a sibling of the root
  writeFileSync(`${dir}-sibling`, 'sibling content\n');
  t.after(async () => {
    await rm(`${dir}-sibling`, { force: true });
  });

  const hostile: string[] = [
    '../etc/passwd',
    '../../etc/passwd',
    '/etc/passwd',
    secret, // absolute path to a real readable file
    '..',
    '.',
    '', // empty
    'a'.repeat(15), // too short
    'a'.repeat(17), // too long (overlong)
    'a'.repeat(64),
    'has/slash/inside1', // 16 chars incl '/'
    'has spaces here!', // chars outside the alphabet
    'tab\there\t1234567', // control char
    'plus+slash/eq=01', // base64 (not -url) chars
    'newline\n12345678',
  ];
  for (const h of hostile) {
    assert.equal(await readChunk(h), null, `rejected: ${JSON.stringify(h)}`);
  }
  // sanity: the secret is genuinely readable by us, so null came from the guard
  assert.equal((await stat(secret)).isFile(), true);
});

test('symlinked session dir is not followed outside the root', async (t) => {
  const dir = await freshDir(t);
  writeFileSync(join(dir, SENTINEL), '');
  // a real chunk OUTSIDE the root, with a VALID handle name
  const outside = await mkdtemp(join(tmpdir(), 'compressor-ccr-outside-'));
  t.after(async () => {
    await rm(outside, { recursive: true, force: true });
  });
  const handle = handleFor('leak via symlinked dir');
  writeFileSync(join(outside, handle), 'leak via symlinked dir');

  // a session dir that is a SYMLINK pointing at the outside dir
  try {
    symlinkSync(outside, join(dir, 'evil-sess'), 'dir');
  } catch {
    // some platforms restrict symlinks; treat as covered if unavailable
    return;
  }
  assert.equal(lstatSync(join(dir, 'evil-sess')).isSymbolicLink(), true, 'precondition');

  assert.equal(
    await readChunk(handle),
    null,
    'symlinked session dir must not be traversed to read outside the root',
  );
});

test('symlinked chunk file is not followed outside the root', async (t) => {
  const dir = await freshDir(t);
  writeFileSync(join(dir, SENTINEL), '');
  const sess = join(dir, 'sess-link');
  mkdirSync(sess, { recursive: true });

  const outside = await mkdtemp(join(tmpdir(), 'compressor-ccr-outside2-'));
  t.after(async () => {
    await rm(outside, { recursive: true, force: true });
  });
  const target = join(outside, 'secret.txt');
  writeFileSync(target, 'exfiltrated\n');

  const handle = handleFor('chunk-symlink');
  try {
    symlinkSync(target, join(sess, handle), 'file');
  } catch {
    return; // symlinks unavailable on this platform
  }
  assert.equal(lstatSync(join(sess, handle)).isSymbolicLink(), true, 'precondition');

  assert.equal(await readChunk(handle), null, 'symlinked chunk file must not be followed');
});

test('sweep does NOT delete a foreign dir when the root lacks our sentinel', async (t) => {
  const dir = await freshDir(t);
  // NO sentinel written → the root is not provably ours
  const foreign = join(dir, 'important-user-data');
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, 'do-not-delete.txt'), 'precious');
  const old = new Date(Date.now() - 999 * HOUR_MS);
  await utimes(foreign, old, old);

  const { sweep } = await import('../../src/hook/ccr.ts');
  await sweep();

  assert.equal(await exists(foreign), true, 'no sentinel → sweep refuses to delete anything');
});

test('sweep refuses a sensitive root (homedir / cwd) even with a sentinel present', async (t) => {
  const savedDir = process.env['COMPRESSOR_CCR_DIR'];
  t.after(() => {
    if (savedDir === undefined) delete process.env['COMPRESSOR_CCR_DIR'];
    else process.env['COMPRESSOR_CCR_DIR'] = savedDir;
  });

  const { sweep } = await import('../../src/hook/ccr.ts');

  // Point CCR at the real homedir, cwd, AND the filesystem root ('/'). We do
  // NOT create a sentinel at any of them (we must not write into $HOME/cwd/'/'
  // in a test); the sensitive-root refusal fires first regardless. The
  // assertion is simply that sweep() / _clearAllForTest() never throw and never
  // remove those dirs.
  const fsRoot = parse(process.cwd()).root; // '/' on POSIX, e.g. 'C:\\' on win32
  for (const sensitive of [homedir(), process.cwd(), fsRoot]) {
    process.env['COMPRESSOR_CCR_DIR'] = sensitive;
    await sweep(); // must be a fail-open no-op
    assert.equal(existsSync(sensitive), true, `sensitive root untouched by sweep: ${sensitive}`);
    await _clearAllForTest(); // must also be a fail-open no-op
    assert.equal(existsSync(sensitive), true, `sensitive root untouched by clearAll: ${sensitive}`);
  }
});

test('clearAll refuses a sensitive root and a sentinel-less root; wipes only an owned root', async (t) => {
  // sensitive root: never wiped
  const savedDir = process.env['COMPRESSOR_CCR_DIR'];
  t.after(() => {
    if (savedDir === undefined) delete process.env['COMPRESSOR_CCR_DIR'];
    else process.env['COMPRESSOR_CCR_DIR'] = savedDir;
  });
  process.env['COMPRESSOR_CCR_DIR'] = homedir();
  await _clearAllForTest();
  assert.equal(existsSync(homedir()), true, 'clearAll refuses homedir');

  // sentinel-less root: never wiped
  const noSentinel = await mkdtemp(join(tmpdir(), 'compressor-ccr-nosent-'));
  t.after(async () => {
    await rm(noSentinel, { recursive: true, force: true });
  });
  process.env['COMPRESSOR_CCR_DIR'] = noSentinel;
  writeFileSync(join(noSentinel, 'keep.txt'), 'keep');
  await _clearAllForTest();
  assert.equal(existsSync(noSentinel), true, 'clearAll refuses a sentinel-less root');

  // owned root (mkdtemp + a stash that writes the sentinel): wiped whole
  const dir = await freshDir(t);
  stashChunk('clear-sess', 'wipe me\n');
  await settleCcr();
  assert.ok(existsSync(join(dir, SENTINEL)), 'owned: sentinel present');
  process.env['COMPRESSOR_CCR_DIR'] = dir;
  await _clearAllForTest();
  assert.equal(existsSync(dir), false, 'clearAll wipes the whole owned root');
});

test('realpath confinement: a sibling dir prefix-matching the root is not reachable', async (t) => {
  const dir = await freshDir(t);
  writeFileSync(join(dir, SENTINEL), '');
  // sibling whose path STARTS WITH the root path string (no trailing sep) —
  // confinement must reject it because resolve(root)+sep is the real boundary
  const sibling = `${dir}-evil`;
  t.after(async () => {
    await rm(sibling, { recursive: true, force: true });
  });
  mkdirSync(sibling, { recursive: true });
  const handle = handleFor('sibling-leak');
  writeFileSync(join(sibling, handle), 'sibling-leak');

  // there is no session dir inside the real root holding this handle → null,
  // and the sibling (outside the root) is never consulted
  assert.equal(await readChunk(handle), null, 'sibling prefix dir is outside confinement');
});

test('sweep skips dirs whose name fails SESSION_DIR_RE even in an owned root', async (t) => {
  const dir = await freshDir(t);
  writeFileSync(join(dir, SENTINEL), ''); // owned root
  // stale dirs whose NAMES are outside the session allowlist: a space, and a
  // 129-char (overlong) name. The name allowlist — not just the sentinel —
  // must exclude these from both enumeration and deletion.
  const spaced = join(dir, 'has space');
  const overlong = join(dir, 'a'.repeat(129));
  const old = new Date(Date.now() - 999 * HOUR_MS);
  for (const d of [spaced, overlong]) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'data.txt'), 'precious');
    await utimes(d, old, old);
  }

  const { sweep } = await import('../../src/hook/ccr.ts');
  await sweep();

  assert.equal(await exists(spaced), true, 'name with a space is not a session dir → survives');
  assert.equal(await exists(overlong), true, 'overlong name is not a session dir → survives');
});

test('symlinked COMPRESSOR_CCR_DIR: sweep refuses the symlinked root, real children survive', async (t) => {
  // target the symlink points at: an owned root (sentinel) carrying a stale,
  // conforming SESSION_DIR_RE child that WOULD be swept if reached.
  const target = await mkdtemp(join(tmpdir(), 'compressor-ccr-symtarget-'));
  const link = await mkdtemp(join(tmpdir(), 'compressor-ccr-symlink-'));
  // mkdtemp made `link` a real dir; replace it with a symlink to `target`
  await rm(link, { recursive: true, force: true });
  t.after(async () => {
    await rm(target, { recursive: true, force: true });
    await rm(link, { recursive: true, force: true });
  });
  try {
    symlinkSync(target, link, 'dir');
  } catch {
    return; // symlinks unavailable on this platform
  }
  assert.equal(lstatSync(link).isSymbolicLink(), true, 'precondition: link is a symlink');

  writeFileSync(join(target, SENTINEL), '');
  const child = join(target, 'real-child');
  mkdirSync(child, { recursive: true });
  writeFileSync(join(child, handleFor('child-data')), 'child-data');
  const old = new Date(Date.now() - 999 * HOUR_MS);
  await utimes(child, old, old);

  const savedDir = process.env['COMPRESSOR_CCR_DIR'];
  const savedTtl = process.env['COMPRESSOR_CCR_TTL'];
  process.env['COMPRESSOR_CCR_DIR'] = link; // point CCR at the SYMLINK
  process.env['COMPRESSOR_CCR_TTL'] = String(HOUR_MS);
  t.after(() => {
    if (savedDir === undefined) delete process.env['COMPRESSOR_CCR_DIR'];
    else process.env['COMPRESSOR_CCR_DIR'] = savedDir;
    if (savedTtl === undefined) delete process.env['COMPRESSOR_CCR_TTL'];
    else process.env['COMPRESSOR_CCR_TTL'] = savedTtl;
  });

  const { sweep } = await import('../../src/hook/ccr.ts');
  await sweep(); // symlinked root must be refused outright

  // the stale child inside the symlink's TARGET must survive untouched
  assert.equal(await exists(child), true, 'symlinked root refused → real child survives sweep');
});

test('concurrent stash of the same chunk → one file, no crash', async (t) => {
  const dir = await freshDir(t);
  const text = 'racing payload\n';
  const handles = Array.from({ length: 32 }, () => stashChunk('race-sess', text));
  assert.equal(new Set(handles).size, 1, 'all calls return the one deterministic handle');
  await settleCcr();

  const files = await readdir(join(dir, 'race-sess'));
  assert.deepEqual(files, [handles[0]], 'exactly one chunk file after the race');
  assert.equal(await readChunk(handles[0] as string), text, 'content intact');
});

test('readFileNoFollow reads a regular file but refuses a symlinked final component (TOCTOU hardening)', async (t) => {
  const dir = await freshDir(t);
  const real = join(dir, 'chunk');
  writeFileSync(real, 'CHUNK-BYTES');
  // baseline: a real file reads; a directory and a missing path are non-files
  assert.equal(await _readFileNoFollowForTest(real), 'CHUNK-BYTES', 'regular file reads');
  assert.equal(await _readFileNoFollowForTest(dir), null, 'directory → null (fstat !isFile)');
  assert.equal(await _readFileNoFollowForTest(join(dir, 'nope')), null, 'missing → null');

  // The hardening: a symlink swapped into the final component must NOT be
  // followed (O_NOFOLLOW). This is the check→read TOCTOU the medium finding
  // raised — locateChunk lstat-rejects a symlink it SEES, but a swap landing
  // after that check would be re-resolved by a name-based read; the fd-based
  // O_NOFOLLOW open closes it. POSIX-only (O_NOFOLLOW is undefined on win32).
  if (process.platform === 'win32') {
    return;
  }
  const secret = join(dir, 'secret');
  writeFileSync(secret, 'TOP-SECRET');
  const swapped = join(dir, 'swapped');
  try {
    symlinkSync(secret, swapped);
  } catch {
    return; // symlinks unavailable on this platform
  }
  assert.equal(lstatSync(swapped).isSymbolicLink(), true, 'precondition: swapped is a symlink');
  const got = await _readFileNoFollowForTest(swapped);
  assert.equal(got, null, 'O_NOFOLLOW refuses the symlinked final component');
  assert.notEqual(got, 'TOP-SECRET', 'the symlink target is never leaked');
});
