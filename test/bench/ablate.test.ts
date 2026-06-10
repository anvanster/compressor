import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVariants, sanitizeAtomId } from '../../src/bench/ablate.ts';
import { getAtom } from '../../src/packs/atoms.ts';
import { renderOutputStyle, renderOutputStyleFromAtoms } from '../../src/packs/render.ts';
import { atomsForMode } from '../../src/packs/modes.ts';

const NO_ABLATION = { ablate: [], ablateAdd: [], ablateGroups: [] };

test('modes map 1:1 to variants; full carries no artifacts and never hooks', () => {
  const variants = buildVariants({
    modes: ['full', 'optimized', 'slim'],
    ...NO_ABLATION,
    hook: true,
  });
  assert.deepEqual(
    variants.map((v) => v.id),
    ['full', 'optimized', 'slim'],
  );

  const [full, optimized, slim] = variants;
  assert.deepEqual(full, {
    id: 'full',
    baseMode: 'full',
    styleBody: null,
    styleName: null,
    hook: false,
  });
  assert.ok(optimized);
  assert.equal(optimized.baseMode, 'optimized');
  assert.equal(optimized.styleName, 'compressor-optimized');
  assert.equal(optimized.styleBody, renderOutputStyle('optimized').body);
  assert.equal(optimized.hook, true);
  assert.ok(slim);
  assert.equal(slim.styleName, 'compressor-slim');
  assert.equal(slim.styleBody, renderOutputStyle('slim').body);
  assert.equal(slim.hook, true);
});

test('hook=false propagates to pack-mode variants', () => {
  const variants = buildVariants({ modes: ['optimized'], ...NO_ABLATION, hook: false });
  assert.equal(variants[0]?.hook, false);
});

test('--ablate renders optimized minus the named atom, sanitized id in names', () => {
  const variants = buildVariants({
    modes: ['optimized'],
    ablate: ['out.no-preamble'],
    ablateAdd: [],
    ablateGroups: [],
    hook: false,
  });
  assert.equal(variants.length, 2);
  const minus = variants[1];
  assert.ok(minus);
  assert.equal(minus.id, 'optimized-minus-out-no-preamble');
  assert.equal(minus.styleName, 'compressor-optimized-minus-out-no-preamble');
  assert.equal(minus.baseMode, 'optimized');
  assert.ok(minus.styleBody !== null);
  // the description names the ablated atom; the manifest and bullets must not
  const manifest = /<!-- atoms: ([^>]*) -->/.exec(minus.styleBody)?.[1] ?? '';
  assert.ok(!manifest.includes('out.no-preamble'));
  assert.ok(!minus.styleBody.includes('Start every response with the answer'));
  // every other optimized atom survives
  for (const atom of atomsForMode('optimized', 'claude-code')) {
    if (atom.id !== 'out.no-preamble') {
      assert.ok(minus.styleBody.includes(atom.text), `missing ${atom.id}`);
    }
  }
});

test('--ablate-add appends a rejected atom to the optimized baseline', () => {
  const variants = buildVariants({
    modes: ['optimized'],
    ablate: [],
    ablateAdd: ['tokens.drop-articles'],
    ablateGroups: [],
    hook: true,
  });
  assert.equal(variants.length, 2);
  const plus = variants[1];
  assert.ok(plus);
  assert.equal(plus.id, 'optimized-plus-tokens-drop-articles');
  assert.equal(plus.styleName, 'compressor-optimized-plus-tokens-drop-articles');
  assert.equal(plus.hook, true);
  assert.ok(plus.styleBody !== null);
  const rejected = getAtom('tokens.drop-articles');
  assert.ok(rejected);
  assert.ok(plus.styleBody.includes(rejected.text));
  assert.ok(plus.styleBody.includes('tokens.drop-articles'));
});

test('--ablate validation: unknown id, atom outside the baseline, missing optimized mode', () => {
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized'],
        ablate: ['nope.missing'],
        ablateAdd: [],
        ablateGroups: [],
        hook: false,
      }),
    /unknown atom id 'nope\.missing'/,
  );
  // slim-only atom: removing it from optimized changes nothing
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized'],
        ablate: ['out.code-only-default'],
        ablateAdd: [],
        ablateGroups: [],
        hook: false,
      }),
    /not in the optimized baseline/,
  );
  assert.throws(
    () =>
      buildVariants({
        modes: ['full', 'slim'],
        ablate: ['out.no-preamble'],
        ablateAdd: [],
        ablateGroups: [],
        hook: false,
      }),
    /optimized baseline/,
  );
});

test('--ablate-add validation: unknown id, active atom, missing optimized mode', () => {
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized'],
        ablate: [],
        ablateAdd: ['nope.missing'],
        ablateGroups: [],
        hook: false,
      }),
    /unknown atom id 'nope\.missing'/,
  );
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized'],
        ablate: [],
        ablateAdd: ['out.no-preamble'],
        ablateGroups: [],
        hook: false,
      }),
    /not rejected/,
  );
  assert.throws(
    () =>
      buildVariants({
        modes: ['slim'],
        ablate: [],
        ablateAdd: ['tokens.drop-articles'],
        ablateGroups: [],
        hook: false,
      }),
    /optimized baseline/,
  );
});

test('slim-only atoms ablate against the slim baseline as slim-minus-<id>', () => {
  const variants = buildVariants({
    modes: ['optimized', 'slim'],
    ablate: ['out.code-only-default'],
    ablateAdd: [],
    ablateGroups: [],
    hook: false,
  });
  assert.equal(variants.length, 3);
  const minus = variants[2];
  assert.ok(minus);
  assert.equal(minus.id, 'slim-minus-out-code-only-default');
  assert.equal(minus.styleName, 'compressor-slim-minus-out-code-only-default');
  assert.equal(minus.baseMode, 'slim');
  assert.ok(minus.styleBody !== null);
  const removed = getAtom('out.code-only-default');
  assert.ok(removed);
  assert.ok(!minus.styleBody.includes(removed.text));
  for (const atom of atomsForMode('slim', 'claude-code')) {
    if (atom.id !== 'out.code-only-default') {
      assert.ok(minus.styleBody.includes(atom.text), `missing ${atom.id}`);
    }
  }
});

test('every active atom has an ablation data path: --ablate <all 13> builds without error', () => {
  const active = new Map(
    [...atomsForMode('optimized', 'claude-code'), ...atomsForMode('slim', 'claude-code')].map(
      (atom) => [atom.id, atom],
    ),
  );
  assert.equal(active.size, 13);
  const variants = buildVariants({
    modes: ['optimized', 'slim'],
    ablate: [...active.keys()],
    ablateAdd: [],
    ablateGroups: [],
    hook: false,
  });
  // 2 mode variants + 13 ablation variants
  assert.equal(variants.length, 15);
  const optimizedMinus = variants.filter((v) => v.id.startsWith('optimized-minus-'));
  const slimMinus = variants.filter((v) => v.id.startsWith('slim-minus-'));
  assert.equal(optimizedMinus.length, atomsForMode('optimized', 'claude-code').length);
  assert.equal(slimMinus.length, 13 - optimizedMinus.length);
  assert.deepEqual(
    slimMinus.map((v) => v.id).sort(),
    ['slim-minus-out-code-only-default', 'slim-minus-out-explanation-budget'],
  );
});

test('slim-only ablation still requires slim in --modes', () => {
  assert.throws(
    () =>
      buildVariants({
        modes: ['full', 'optimized'],
        ablate: ['out.explanation-budget'],
        ablateAdd: [],
        ablateGroups: [],
        hook: false,
      }),
    /slim-only; include 'slim' in --modes/,
  );
});

test('duplicate ablation ids and duplicate modes are rejected (unique variant ids/styleNames)', () => {
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized'],
        ablate: ['out.no-preamble', 'out.no-preamble'],
        ablateAdd: [],
        ablateGroups: [],
        hook: false,
      }),
    /duplicate variant/,
  );
  assert.throws(
    () => buildVariants({ modes: ['optimized', 'optimized'], ...NO_ABLATION, hook: false }),
    /duplicate variant/,
  );
});

test('sanitizeAtomId maps dots to dashes', () => {
  assert.equal(sanitizeAtomId('out.no-preamble'), 'out-no-preamble');
});

function manifestIds(styleBody: string | null): string[] {
  assert.ok(styleBody !== null);
  const raw = /<!-- atoms: ([^>]*) -->/.exec(styleBody)?.[1] ?? '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

test('--ablate-group renders optimized minus every atom of the category', () => {
  const variants = buildVariants({
    modes: ['optimized'],
    ablate: [],
    ablateAdd: [],
    ablateGroups: ['output', 'behavior'],
    hook: false,
  });
  assert.deepEqual(
    variants.map((v) => v.id),
    ['optimized', 'optimized-minus-output-atoms', 'optimized-minus-behavior-atoms'],
  );
  const [, noOutput, noBehavior] = variants;
  assert.ok(noOutput);
  assert.ok(noBehavior);
  assert.equal(noOutput.styleName, 'compressor-ablate-no-output');
  assert.equal(noBehavior.styleName, 'compressor-ablate-no-behavior');
  assert.equal(noOutput.baseMode, 'optimized');
  assert.equal(noBehavior.baseMode, 'optimized');

  const baseline = atomsForMode('optimized', 'claude-code');
  const outputIds = baseline.filter((a) => a.category === 'output').map((a) => a.id);
  const behaviorIds = baseline.filter((a) => a.category === 'behavior').map((a) => a.id);
  assert.ok(outputIds.length > 0);
  assert.ok(behaviorIds.length > 0);

  // output-group variant: no out.* atom ids in the manifest, ALL beh.* survive
  const noOutputManifest = manifestIds(noOutput.styleBody);
  assert.deepEqual([...noOutputManifest].sort(), [...behaviorIds].sort());
  for (const id of outputIds) {
    assert.ok(!noOutputManifest.includes(id), `out atom ${id} leaked into no-output manifest`);
  }
  // behavior-group variant: vice versa
  const noBehaviorManifest = manifestIds(noBehavior.styleBody);
  assert.deepEqual([...noBehaviorManifest].sort(), [...outputIds].sort());
  for (const id of behaviorIds) {
    assert.ok(!noBehaviorManifest.includes(id), `beh atom ${id} leaked into no-behavior manifest`);
  }
  // description records what was removed
  assert.ok(noOutput.styleBody?.includes('minus all output atoms'));
  assert.ok(noBehavior.styleBody?.includes('minus all behavior atoms'));
});

test('--ablate-group validation: unknown group lists valid values; requires optimized; duplicates rejected', () => {
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized'],
        ablate: [],
        ablateAdd: [],
        ablateGroups: ['colors'],
        hook: false,
      }),
    /unknown group 'colors' \(valid groups: output, behavior\)/,
  );
  assert.throws(
    () =>
      buildVariants({
        modes: ['full', 'slim'],
        ablate: [],
        ablateAdd: [],
        ablateGroups: ['output'],
        hook: false,
      }),
    /optimized baseline.*include 'optimized' in --modes/,
  );
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized'],
        ablate: [],
        ablateAdd: [],
        ablateGroups: ['output', 'output'],
        hook: false,
      }),
    /duplicate variant/,
  );
});

test('--ablate-group builds are deterministic (two builds byte-identical) and propagate hook', () => {
  const build = () =>
    buildVariants({
      modes: ['optimized'],
      ablate: ['out.no-preamble'],
      ablateAdd: [],
      ablateGroups: ['output', 'behavior'],
      hook: true,
    });
  const a = build();
  const b = build();
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const groupVariants = a.filter((v) => v.id.endsWith('-atoms'));
  assert.equal(groupVariants.length, 2);
  for (const variant of groupVariants) {
    assert.equal(variant.hook, true);
  }
});

test('renderOutputStyleFromAtoms matches renderOutputStyle structure and rejects bad names', () => {
  const atoms = atomsForMode('slim', 'claude-code');
  const fromAtoms = renderOutputStyleFromAtoms(
    atoms,
    'compressor-slim',
    'Code-first responses under a hard explanation budget',
  );
  assert.deepEqual(fromAtoms, renderOutputStyle('slim'));
  assert.ok(!/^name:/m.test(fromAtoms.body));
  assert.throws(() => renderOutputStyleFromAtoms(atoms, '', 'desc'), /invalid output-style name/);
  assert.throws(
    () => renderOutputStyleFromAtoms(atoms, 'a/b', 'desc'),
    /invalid output-style name/,
  );
});
