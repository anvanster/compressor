import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import {
  applyWithBackup,
  listBackups,
  planRestore,
  readManifest,
  writeBackup,
} from '../../src/adapters/backup.ts';
import type { FileChange } from '../../src/adapters/types.ts';

async function tmp(): Promise<{ dir: string; backups: string; file: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-backup-'));
  return { dir, backups: path.join(dir, 'backups'), file: path.join(dir, 'config.json') };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test('writeBackup + readManifest: records each change\'s before state', async () => {
  const { backups, file } = await tmp();
  const changes: FileChange[] = [
    { path: file, before: 'old', after: 'new' },
    { path: `${file}.2`, before: null, after: 'created' },
  ];
  const manifestPath = await writeBackup(changes, { dir: backups, command: 'init --mode slim' });
  const m = await readManifest(manifestPath);
  assert.equal(m.version, 1);
  assert.equal(m.command, 'init --mode slim');
  assert.deepEqual(m.entries, [
    { path: file, before: 'old' },
    { path: `${file}.2`, before: null },
  ]);
});

test('applyWithBackup: writes a backup then applies; --no-backup skips it', async () => {
  const { backups, file } = await tmp();
  await writeFile(file, 'original', 'utf8');

  const withBackup = await applyWithBackup([{ path: file, before: 'original', after: 'changed' }], {
    backupDir: backups,
    command: 'init',
  });
  assert.equal(await readFile(file, 'utf8'), 'changed');
  assert.ok(withBackup.backupPath !== undefined, 'backup manifest written');
  assert.equal((await listBackups(backups)).length, 1);

  const noBackup = await applyWithBackup([{ path: file, before: 'changed', after: 'again' }], {
    backupDir: backups,
    backup: false,
  });
  assert.equal(await readFile(file, 'utf8'), 'again');
  assert.equal(noBackup.backupPath, undefined, 'no manifest when --no-backup');
  assert.equal((await listBackups(backups)).length, 1, 'still just the first backup');
});

test('restore round-trip: undo a modify and a create', async () => {
  const { backups, file } = await tmp();
  const created = `${file}.new`;
  await writeFile(file, 'ORIGINAL', 'utf8');

  // an init-like change set: modify an existing file, create a new one
  const install: FileChange[] = [
    { path: file, before: 'ORIGINAL', after: 'INSTALLED' },
    { path: created, before: null, after: 'NEW FILE' },
  ];
  const { backupPath } = await applyWithBackup(install, { backupDir: backups, command: 'init' });
  assert.equal(await readFile(file, 'utf8'), 'INSTALLED');
  assert.equal(await readFile(created, 'utf8'), 'NEW FILE');

  // restore from that backup
  const manifest = await readManifest(backupPath as string);
  const restore = await planRestore(manifest);
  await applyWithBackup(restore, { backupDir: backups, command: 'restore' });

  assert.equal(await readFile(file, 'utf8'), 'ORIGINAL', 'modify undone');
  assert.equal(await exists(created), false, 'created file removed on restore');
});

test('planRestore skips files already at the recorded state', async () => {
  const { backups, file } = await tmp();
  await writeFile(file, 'SAME', 'utf8');
  const manifestPath = await writeBackup([{ path: file, before: 'SAME', after: 'x' }], {
    dir: backups,
  });
  const changes = await planRestore(await readManifest(manifestPath));
  assert.deepEqual(changes, [], 'no change needed when disk already matches the backup');
});

test('applyWithBackup aborts without modifying when the backup cannot be written', async () => {
  const { backups, file } = await tmp();
  await writeFile(file, 'SAFE', 'utf8');
  // point the backup dir at an existing FILE so mkdir fails
  const blocker = path.join(backups, '..', 'not-a-dir');
  await writeFile(blocker, 'x', 'utf8');

  await assert.rejects(
    applyWithBackup([{ path: file, before: 'SAFE', after: 'DANGER' }], { backupDir: blocker }),
    /backup failed/,
  );
  assert.equal(await readFile(file, 'utf8'), 'SAFE', 'target file untouched after backup failure');
});

test('the backup API is exported from the PACKAGE ROOT (not just the adapters barrel)', async () => {
  // 0.3.2 shipped backup.js but never re-exported it from src/index.ts, so
  // consumers importing from '@astudioplus/compressor' (the VS Code extension)
  // could not reach applyWithBackup. Guard the package-root surface here.
  const root = await import('../../src/index.ts');
  for (const name of [
    'applyWithBackup',
    'writeBackup',
    'listBackups',
    'readManifest',
    'planRestore',
    'resolveBackupDir',
  ]) {
    assert.equal(typeof (root as Record<string, unknown>)[name], 'function', `root exports ${name}`);
  }
});

test('listBackups: newest first', async () => {
  const { backups, file } = await tmp();
  await writeBackup([{ path: file, before: 'a', after: 'b' }], {
    dir: backups,
    now: new Date('2026-06-10T00:00:00.000Z'),
  });
  await writeBackup([{ path: file, before: 'b', after: 'c' }], {
    dir: backups,
    now: new Date('2026-06-13T00:00:00.000Z'),
  });
  const list = await listBackups(backups);
  assert.equal(list.length, 2);
  assert.equal(list[0]?.createdAt, '2026-06-13T00:00:00.000Z', 'newest first');
  assert.equal(list[1]?.createdAt, '2026-06-10T00:00:00.000Z');
});
