import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVariants } from '../../src/bench/ablate.ts';
import { hookCommandForVariant } from '../../src/bench/cell.ts';
import type { Variant } from '../../src/bench/types.ts';

const NO_ABLATION = { ablate: [], ablateAdd: [], ablateGroups: [] };
const ARGS = '--marker-style informative';

test('buildVariants applies hookArgs to every hook-bearing variant, never to full', () => {
  const variants = buildVariants({
    modes: ['full', 'optimized', 'slim'],
    ablate: ['out.no-preamble'],
    ablateAdd: [],
    ablateGroups: ['behavior'],
    hook: true,
    hookArgs: ARGS,
  });
  const full = variants.find((v) => v.id === 'full');
  assert.ok(full);
  assert.equal(full.hook, false);
  assert.equal(full.hookArgs, undefined);
  const hooked = variants.filter((v) => v.hook);
  // mode variants AND ablation variants all carry the args
  assert.deepEqual(
    hooked.map((v) => v.id).sort(),
    ['optimized', 'optimized-minus-behavior-atoms', 'optimized-minus-out-no-preamble', 'slim'],
  );
  for (const variant of hooked) {
    assert.equal(variant.hookArgs, ARGS, `${variant.id} missing hookArgs`);
  }
});

test('buildVariants without hookArgs leaves variants unchanged; whitespace-only is ignored', () => {
  const plain = buildVariants({ modes: ['optimized'], ...NO_ABLATION, hook: true });
  assert.equal(plain[0]?.hookArgs, undefined);
  const blank = buildVariants({
    modes: ['optimized'],
    ...NO_ABLATION,
    hook: true,
    hookArgs: '   ',
  });
  assert.equal(blank[0]?.hookArgs, undefined);
});

test('buildVariants rejects hookArgs when no variant carries the hook', () => {
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized', 'slim'],
        ...NO_ABLATION,
        hook: false,
        hookArgs: ARGS,
      }),
    /--hook-args: no hook-bearing variants/,
  );
  assert.throws(
    () => buildVariants({ modes: ['full'], ...NO_ABLATION, hook: true, hookArgs: ARGS }),
    /--hook-args: no hook-bearing variants/,
  );
});

test('hookCommandForVariant appends hookArgs to the resolved hook command', async (t) => {
  // hermetic package root: resolveHookCommand only needs package.json + dist/hook.js
  const root = await mkdtemp(join(tmpdir(), 'compressor-fake-root-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'compressor' }), 'utf8');
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist', 'hook.js'), '// stub bundle\n', 'utf8');

  const base: Variant = {
    id: 'slim',
    baseMode: 'slim',
    styleBody: 'x',
    styleName: 'compressor-slim',
    hook: true,
  };
  const expectedBase = `node "${join(root, 'dist', 'hook.js')}" --mode slim`;
  assert.equal(hookCommandForVariant(base, root), expectedBase);
  assert.equal(
    hookCommandForVariant({ ...base, hookArgs: ARGS }, root),
    `${expectedBase} ${ARGS}`,
  );
  // whitespace-only args leave the command untouched
  assert.equal(hookCommandForVariant({ ...base, hookArgs: '  ' }, root), expectedBase);
  // hook command is mode-bearing only for optimized/slim
  assert.throws(
    () =>
      hookCommandForVariant(
        { id: 'full', baseMode: 'full', styleBody: null, styleName: null, hook: false },
        root,
      ),
    /hook requires baseMode optimized\|slim/,
  );
});
