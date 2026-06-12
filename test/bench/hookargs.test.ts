import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVariants } from '../../src/bench/ablate.ts';
import { hookCommandForVariant } from '../../src/bench/cell.ts';
import { parseHookArgArms } from '../../src/cli/commands/benchmark.ts';
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

// ── --hook-arg-arms: generic per-arm fan-out (the recovery-budget A/B) ──────

const BUDGET_ARMS = [
  { label: 'budget-on', args: '' },
  { label: 'budget-off', args: '--recovery-budget off' },
];

test('hookArgArms fans every hook-bearing variant into labeled arms, full untouched', () => {
  const variants = buildVariants({
    modes: ['full', 'optimized'],
    ...NO_ABLATION,
    hook: true,
    hookArgArms: BUDGET_ARMS,
  });
  assert.deepEqual(
    variants.map((v) => v.id).sort(),
    ['full', 'optimized-arm-budget-off', 'optimized-arm-budget-on'],
  );
  const on = variants.find((v) => v.id === 'optimized-arm-budget-on');
  const off = variants.find((v) => v.id === 'optimized-arm-budget-off');
  assert.ok(on && off);
  // control arm: no extra args; experiment arm carries them
  assert.equal(on.hookArgs, undefined);
  assert.equal(off.hookArgs, '--recovery-budget off');
  // unique style file per arm, same body
  assert.equal(on.styleName, 'compressor-optimized-arm-budget-on');
  assert.equal(off.styleName, 'compressor-optimized-arm-budget-off');
  assert.equal(on.styleBody, off.styleBody);
});

test('hookArgArms composes with shared hookArgs (shared first, arm args appended)', () => {
  const variants = buildVariants({
    modes: ['optimized'],
    ...NO_ABLATION,
    hook: true,
    hookArgs: '--marker-style plain',
    hookArgArms: BUDGET_ARMS,
  });
  const off = variants.find((v) => v.id === 'optimized-arm-budget-off');
  const on = variants.find((v) => v.id === 'optimized-arm-budget-on');
  assert.ok(on && off);
  assert.equal(off.hookArgs, '--marker-style plain --recovery-budget off');
  assert.equal(on.hookArgs, '--marker-style plain');
});

test('hookArgArms validation: bad label, duplicate label, no hooked variants', () => {
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized'],
        ...NO_ABLATION,
        hook: true,
        hookArgArms: [{ label: 'Bad Label', args: '' }],
      }),
    /lowercase alphanumerics/,
  );
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized'],
        ...NO_ABLATION,
        hook: true,
        hookArgArms: [
          { label: 'a', args: '' },
          { label: 'a', args: '--x' },
        ],
      }),
    /duplicate label/,
  );
  assert.throws(
    () =>
      buildVariants({
        modes: ['full'],
        ...NO_ABLATION,
        hook: false,
        hookArgArms: BUDGET_ARMS,
      }),
    /no hook-bearing variants/,
  );
});

test('parseHookArgArms parses label=args entries incl. empty args; rejects missing =', () => {
  assert.deepEqual(parseHookArgArms('budget-on=,budget-off=--recovery-budget off'), [
    { label: 'budget-on', args: '' },
    { label: 'budget-off', args: '--recovery-budget off' },
  ]);
  assert.deepEqual(parseHookArgArms(undefined), []);
  assert.deepEqual(parseHookArgArms('  '), []);
  assert.throws(() => parseHookArgArms('nolabel'), /expected '<label>=<args>'/);
});

test('hookArms fans hook-bearing variants into hook-on/hook-off; full untouched', () => {
  const variants = buildVariants({
    modes: ['full', 'optimized'],
    ...NO_ABLATION,
    hook: true,
    hookArgs: '--marker-style plain',
    hookArms: true,
  });
  assert.deepEqual(
    variants.map((v) => v.id).sort(),
    ['full', 'optimized-hook-off', 'optimized-hook-on'],
  );
  const on = variants.find((v) => v.id === 'optimized-hook-on');
  const off = variants.find((v) => v.id === 'optimized-hook-off');
  assert.ok(on && off);
  assert.equal(on.hook, true);
  assert.equal(on.hookArgs, '--marker-style plain');
  assert.equal(on.styleName, 'compressor-optimized-hook-on');
  // hook-off: same instructions, no hook, no stale hookArgs
  assert.equal(off.hook, false);
  assert.equal(off.hookArgs, undefined);
  assert.equal(off.styleBody, on.styleBody);
  assert.equal(off.styleName, 'compressor-optimized-hook-off');

  assert.throws(
    () =>
      buildVariants({ modes: ['full'], ...NO_ABLATION, hook: false, hookArms: true }),
    /no hook-bearing variants/,
  );
});
