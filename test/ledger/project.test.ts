import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { PROJECT_LABEL_MAX } from '../../src/ledger/write.ts';
import {
  HASHED_PREFIX,
  currentProjectLabel,
  ensureProjectSalt,
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

test('a missing key costs this run its label, not the event', async () => {
  await withSaltFile(async (file) => {
    // nothing created yet: the label is skipped and the key is made in the
    // background so the next hook run is labelled
    assert.equal(readProjectSaltSync(), undefined);
    assert.doesNotThrow(() => currentProjectLabel('/w/widget'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(readProjectSaltSync() !== undefined, `key created at ${file}`);
  });
});
