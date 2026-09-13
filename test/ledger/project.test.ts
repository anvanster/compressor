import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { PROJECT_LABEL_MAX } from '../../src/ledger/write.ts';
import {
  HASHED_PREFIX,
  currentProjectLabel,
  ensureProjectSalt,
  ensureProjectSaltSync,
  normalizeProjectLabelMode,
  projectLabel,
  readProjectSalt,
  readProjectSaltSync,
  resolveProjectSaltPath,
} from '../../src/ledger/project.ts';

async function withSaltFile<T>(fn: (file: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-salt-'));
  const file = path.join(dir, 'nested', 'project-salt');
  const prev = process.env['COMPRESSOR_PROJECT_SALT'];
  process.env['COMPRESSOR_PROJECT_SALT'] = file;
  try {
    return await fn(file);
  } finally {
    if (prev === undefined) delete process.env['COMPRESSOR_PROJECT_SALT'];
    else process.env['COMPRESSOR_PROJECT_SALT'] = prev;
  }
}

test('the key lives outside the ledger directory, whatever the ledger dir is', () => {
  const prevLedger = process.env['COMPRESSOR_LEDGER_DIR'];
  const prevSalt = process.env['COMPRESSOR_PROJECT_SALT'];
  delete process.env['COMPRESSOR_PROJECT_SALT'];
  process.env['COMPRESSOR_LEDGER_DIR'] = '/tmp/somewhere/else/ledger';
  try {
    const file = resolveProjectSaltPath();
    assert.equal(file, path.join(os.homedir(), '.compressor', 'project-salt'));
    // the ledger dir is the shareable unit; the key must never sit inside it
    assert.ok(!file.startsWith('/tmp/somewhere/else/ledger'));
  } finally {
    if (prevLedger === undefined) delete process.env['COMPRESSOR_LEDGER_DIR'];
    else process.env['COMPRESSOR_LEDGER_DIR'] = prevLedger;
    if (prevSalt !== undefined) process.env['COMPRESSOR_PROJECT_SALT'] = prevSalt;
  }
});

test('the key is created once, owner-only, and reused', async () => {
  await withSaltFile(async (file) => {
    assert.equal(await readProjectSalt(), undefined);
    const salt = await ensureProjectSalt();
    assert.ok(salt !== undefined);
    assert.match(salt, /^[0-9a-f]{64}$/);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(await ensureProjectSalt(), salt, 'stable across calls');
    assert.equal(await readProjectSalt(), salt);
  });
});

test('concurrent writers converge on one key, never two', async () => {
  await withSaltFile(async () => {
    // a hook process and the extension can reach this at the same moment; two
    // keys would split one project into two rows forever
    const salts = await Promise.all(Array.from({ length: 8 }, () => ensureProjectSalt()));
    assert.equal(new Set(salts).size, 1, `converged: ${JSON.stringify([...new Set(salts)])}`);
    assert.equal(salts[0], await readProjectSalt());
  });
});

test('a corrupt key file is replaced rather than disabling labels forever', async () => {
  await withSaltFile(async (file) => {
    const first = await ensureProjectSalt();
    await writeFile(file, 'not-a-key\n', 'utf8');
    assert.equal(await readProjectSalt(), undefined, 'rejected as malformed');

    const recovered = await ensureProjectSalt();
    assert.ok(recovered !== undefined, 'recovers instead of returning undefined');
    assert.notEqual(recovered, first);
    assert.equal((await readFile(file, 'utf8')).trim(), recovered);
  });
});

test('hashed labels hide the project and cannot be reproduced without the key', async () => {
  const secret = '/Users/someone/clients/acme-secret-merger';
  const a = projectLabel(secret, 'hashed', 'a'.repeat(64));
  const b = projectLabel(secret, 'hashed', 'b'.repeat(64));
  assert.match(a, /^#[0-9a-f]{12}$/);
  assert.ok(!a.includes('acme') && !a.includes('someone'));
  assert.notEqual(a, b, 'a different key gives a different label');
  assert.equal(a, projectLabel(secret, 'hashed', 'a'.repeat(64)), 'stable for one key');
});

test('same basename in different locations stays distinct', () => {
  const salt = 'c'.repeat(64);
  assert.notEqual(projectLabel('/w/api', 'hashed', salt), projectLabel('/other/api', 'hashed', salt));
});

test('name mode records the folder only, capped so the reader cannot drop it', () => {
  const salt = 'd'.repeat(64);
  assert.equal(projectLabel('/Users/someone/clients/acme', 'name', salt), 'acme');
  const long = `/w/${'z'.repeat(PROJECT_LABEL_MAX + 40)}`;
  const label = projectLabel(long, 'name', salt);
  assert.equal(label.length, PROJECT_LABEL_MAX, 'stays within what parseEvent accepts');
});

test('the label mode falls back to hashed for anything unexpected', () => {
  assert.equal(normalizeProjectLabelMode(undefined), 'hashed');
  assert.equal(normalizeProjectLabelMode('NAME'), 'hashed');
  assert.equal(normalizeProjectLabelMode(true), 'hashed');
  assert.equal(normalizeProjectLabelMode('name'), 'name');
});

test('SHARED VECTOR: every writer must produce this exact label', () => {
  // Pinned so the CLI and the VS Code extension cannot drift apart while the
  // extension still carries its own copy of this algorithm. Changing this value
  // re-labels every project in every existing ledger.
  assert.equal(HASHED_PREFIX, '#');
  // verified independently: python3 -c "import hashlib; print(hashlib.sha256(
  //   b'0'*64 + b'\x00' + b'/home/u/projects/widget').hexdigest()[:12])"
  assert.equal(
    projectLabel('/home/u/projects/widget', 'hashed', '0'.repeat(64)),
    '#08fb9afab53d',
  );
});

test('the CLI labels its working directory, synchronously', async () => {
  await withSaltFile(async () => {
    const salt = await ensureProjectSalt();
    const label = currentProjectLabel('/w/widget');
    // a hook process often lives for one tool call, so an async load would
    // miss the only event it will ever record
    assert.equal(label, projectLabel('/w/widget', 'hashed', salt!));
    assert.match(label!, /^#[0-9a-f]{12}$/);
  });
});

test('the CLI honours COMPRESSOR_PROJECT_LABEL=name, and nothing else', async () => {
  await withSaltFile(async () => {
    await ensureProjectSalt();
    const prev = process.env['COMPRESSOR_PROJECT_LABEL'];
    try {
      process.env['COMPRESSOR_PROJECT_LABEL'] = 'name';
      assert.equal(currentProjectLabel('/w/widget'), 'widget');
      process.env['COMPRESSOR_PROJECT_LABEL'] = 'nonsense';
      assert.match(currentProjectLabel('/w/widget')!, /^#/, 'anything unexpected stays hashed');
    } finally {
      if (prev === undefined) delete process.env['COMPRESSOR_PROJECT_LABEL'];
      else process.env['COMPRESSOR_PROJECT_LABEL'] = prev;
    }
  });
});

test('a missing key is created inline, so THIS run is already labelled', () => {
  // the hook process is killed the moment its output is delivered, so a
  // background creation can be cut between mkdir and write and the key never
  // appears — the first run has to make it itself
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compressor-salt-'));
  const file = path.join(dir, 'nested', 'project-salt');
  const prev = process.env['COMPRESSOR_PROJECT_SALT'];
  process.env['COMPRESSOR_PROJECT_SALT'] = file;
  try {
    assert.equal(readProjectSaltSync(), undefined);
    const label = currentProjectLabel('/w/widget');
    const salt = readProjectSaltSync();
    assert.ok(salt !== undefined, `key created at ${file}`);
    assert.equal(label, projectLabel('/w/widget', 'hashed', salt));
    assert.equal(currentProjectLabel('/w/widget'), label, 'stable on the next run');
  } finally {
    if (prev === undefined) delete process.env['COMPRESSOR_PROJECT_SALT'];
    else process.env['COMPRESSOR_PROJECT_SALT'] = prev;
  }
});

test('a truncated key file is replaced rather than disabling labels forever', () => {
  // SIGKILL between open(wx) and write leaves a zero-byte file behind
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compressor-salt-'));
  const file = path.join(dir, 'project-salt');
  const prev = process.env['COMPRESSOR_PROJECT_SALT'];
  process.env['COMPRESSOR_PROJECT_SALT'] = file;
  try {
    writeFileSync(file, '', 'utf8');
    const salt = ensureProjectSaltSync();
    assert.ok(salt !== undefined, 'recovers instead of labelling nothing forever');
    assert.match(salt, /^[0-9a-f]{64}$/);
  } finally {
    if (prev === undefined) delete process.env['COMPRESSOR_PROJECT_SALT'];
    else process.env['COMPRESSOR_PROJECT_SALT'] = prev;
  }
});

test('name mode needs no key: an unwritable home must not disable it', () => {
  // container / CI / sandboxed agent: ~/.compressor can be neither read nor
  // created, and name mode never touches it — labels must keep flowing
  const prevSalt = process.env['COMPRESSOR_PROJECT_SALT'];
  const prevMode = process.env['COMPRESSOR_PROJECT_LABEL'];
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compressor-salt-'));
  const blocker = path.join(dir, 'not-a-directory');
  writeFileSync(blocker, 'x', 'utf8'); // mkdir under a FILE fails with ENOTDIR
  process.env['COMPRESSOR_PROJECT_SALT'] = path.join(blocker, 'project-salt');
  process.env['COMPRESSOR_PROJECT_LABEL'] = 'name';
  try {
    assert.equal(ensureProjectSaltSync(), undefined, 'the key really is unavailable');
    assert.equal(currentProjectLabel('/w/widget'), 'widget');
    process.env['COMPRESSOR_PROJECT_LABEL'] = 'hashed';
    assert.equal(currentProjectLabel('/w/widget'), undefined, 'hashed still needs the key');
  } finally {
    if (prevSalt === undefined) delete process.env['COMPRESSOR_PROJECT_SALT'];
    else process.env['COMPRESSOR_PROJECT_SALT'] = prevSalt;
    if (prevMode === undefined) delete process.env['COMPRESSOR_PROJECT_LABEL'];
    else process.env['COMPRESSOR_PROJECT_LABEL'] = prevMode;
  }
});

test('an unavailable key is not re-created per event, but a key that appears is used', () => {
  // long-lived writers (the opencode plugin, the extension) label every tool
  // call in one process: a permanently unwritable home must not cost five
  // blocking syscalls per event forever
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compressor-salt-'));
  const blocker = path.join(dir, 'not-a-directory');
  const file = path.join(blocker, 'project-salt');
  const prev = process.env['COMPRESSOR_PROJECT_SALT'];
  process.env['COMPRESSOR_PROJECT_SALT'] = file;
  try {
    writeFileSync(blocker, 'x', 'utf8'); // mkdir under a FILE fails with ENOTDIR
    assert.equal(ensureProjectSaltSync(), undefined);

    // the location is now perfectly writable, and creation is still NOT
    // retried — that attempt is remembered per location, deliberately
    rmSync(blocker);
    mkdirSync(blocker);
    assert.equal(ensureProjectSaltSync(), undefined, 'creation is attempted once');

    // ...but the read is never cached, so a key put there by another process
    // (or by the user) labels the very next event
    const planted = 'f'.repeat(64);
    writeFileSync(file, `${planted}\n`, 'utf8');
    assert.equal(ensureProjectSaltSync(), planted);
    assert.equal(currentProjectLabel('/w/widget'), projectLabel('/w/widget', 'hashed', planted));
  } finally {
    if (prev === undefined) delete process.env['COMPRESSOR_PROJECT_SALT'];
    else process.env['COMPRESSOR_PROJECT_SALT'] = prev;
  }
});

test('one folder spelled two ways is one row, not two', () => {
  const salt = 'e'.repeat(64);
  const label = projectLabel('/w/app', 'hashed', salt);
  assert.equal(projectLabel('/w/app/', 'hashed', salt), label, 'trailing separator');
  assert.equal(projectLabel('/w/app///', 'hashed', salt), label, 'repeated separator');
  assert.equal(projectLabel('c:\\w\\app', 'hashed', salt), projectLabel('C:\\w\\app', 'hashed', salt),
    'windows drive letter case');
  assert.equal(projectLabel('C:\\w\\app\\', 'hashed', salt), projectLabel('C:\\w\\app', 'hashed', salt));
  assert.notEqual(projectLabel('/w/app', 'hashed', salt), projectLabel('/w/apps', 'hashed', salt));
  // a bare root must survive the trim rather than hashing the empty string
  assert.notEqual(projectLabel('/', 'hashed', salt), projectLabel('', 'hashed', salt));
  assert.equal(projectLabel('/w/app/', 'name', salt), 'app');
});
