import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describeHookCommand, resolveHookCommand } from '../../src/paths.ts';

test('resolveHookCommand refuses a root without dist/hook.js', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-paths-'));
  assert.throws(
    () => resolveHookCommand('optimized', root),
    /npm run build/,
  );
});

test('resolveHookCommand returns the node command when the bundle exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-paths-'));
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'hook.js'), '// bundle\n', 'utf8');
  assert.equal(
    resolveHookCommand('slim', root),
    `node "${path.join(root, 'dist', 'hook.js')}" --mode slim`,
  );
});

test('describeHookCommand never requires the bundle (uninstall/status path)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-paths-'));
  assert.equal(
    describeHookCommand('optimized', root),
    `node "${path.join(root, 'dist', 'hook.js')}" --mode optimized`,
  );
});

test('hook command quotes the bundle path (roots containing spaces)', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'compressor-paths-'));
  const root = path.join(base, 'dir with spaces');
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'hook.js'), '// bundle\n', 'utf8');
  assert.equal(
    resolveHookCommand('optimized', root),
    `node "${path.join(root, 'dist', 'hook.js')}" --mode optimized`,
  );
});
