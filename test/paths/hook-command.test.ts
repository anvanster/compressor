import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describeHookCommand, isCompressorRoot, resolveHookCommand } from '../../src/paths.ts';

// Regression for the scope rename: packageRoot() identifies our package by the
// `compressor` bin, so '@astudioplus/compressor' (and any future scope) is found.
// Before this, isCompressorRoot hard-coded name === 'compressor' and every CLI
// command threw "could not locate the compressor package root" once published.
test('isCompressorRoot matches the package by bin and scoped/unscoped name', async () => {
  const make = async (pkg: unknown): Promise<string> => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-root-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify(pkg), 'utf8');
    return root;
  };
  assert.equal(isCompressorRoot(await make({ name: '@astudioplus/compressor', bin: { compressor: 'dist/cli/index.js' } })), true);
  assert.equal(isCompressorRoot(await make({ name: 'compressor' })), true);
  assert.equal(isCompressorRoot(await make({ name: 'something-else', bin: { compressor: 'x.js' } })), true);
  assert.equal(isCompressorRoot(await make({ name: 'a-consumer-project', dependencies: { '@astudioplus/compressor': '^0.1.0' } })), false);
  const empty = await mkdtemp(path.join(os.tmpdir(), 'compressor-root-'));
  assert.equal(isCompressorRoot(empty), false);
});

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
