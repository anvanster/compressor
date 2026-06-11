import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVariants } from '../../src/bench/ablate.ts';

// Regression: 'plain vs deterrent vs informative' must be expressible as
// variants of ONE run. --hook-args applies one value to every hook-bearing
// variant, forcing three separate runs with independent --max-budget-usd
// ceilings — a more expensive arm hits its ceiling earlier and loses later
// trials/tasks, unbalancing the comparison. --marker-styles fans each
// hook-bearing variant out per style inside the same run, sharing one
// ceiling and the runner's group-atomic, variants-innermost scheduling.

const NO_ABLATION = { ablate: [], ablateAdd: [], ablateGroups: [] };
const ALL_STYLES = ['plain', 'deterrent', 'informative'];

test('markerStyles fans every hook-bearing variant out per style in one run', () => {
  const variants = buildVariants({
    modes: ['full', 'optimized', 'slim'],
    ...NO_ABLATION,
    hook: true,
    markerStyles: ALL_STYLES,
  });

  // full carries no hook and must NOT fan out
  const full = variants.find((v) => v.id === 'full');
  assert.ok(full);
  assert.equal(full.hook, false);
  assert.equal(full.hookArgs, undefined);

  const hooked = variants.filter((v) => v.hook);
  assert.deepEqual(
    hooked.map((v) => v.id).sort(),
    [
      'optimized-marker-deterrent',
      'optimized-marker-informative',
      'optimized-marker-plain',
      'slim-marker-deterrent',
      'slim-marker-informative',
      'slim-marker-plain',
    ],
  );
  for (const variant of hooked) {
    const style = variant.id.split('-marker-')[1];
    assert.equal(variant.hookArgs, `--marker-style ${style}`, `${variant.id} hookArgs`);
    assert.equal(
      variant.styleName,
      `compressor-${variant.id}`,
      `${variant.id} needs a unique style file name`,
    );
    assert.ok(variant.styleBody !== null && variant.styleBody.length > 0);
  }
  // 1 full + 2 modes × 3 styles
  assert.equal(variants.length, 7);
});

test('markerStyles composes with general hookArgs (style flag appended last)', () => {
  const variants = buildVariants({
    modes: ['optimized'],
    ...NO_ABLATION,
    hook: true,
    hookArgs: '--verbose',
    markerStyles: ['plain', 'deterrent'],
  });
  assert.deepEqual(
    variants.map((v) => v.hookArgs),
    ['--verbose --marker-style plain', '--verbose --marker-style deterrent'],
  );
});

test('markerStyles validation: unknown style, duplicates, conflicting hookArgs, no hook', () => {
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized'],
        ...NO_ABLATION,
        hook: true,
        markerStyles: ['plain', 'sarcastic'],
      }),
    /--marker-styles: unknown style 'sarcastic'/,
  );
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized'],
        ...NO_ABLATION,
        hook: true,
        markerStyles: ['plain', 'plain'],
      }),
    /--marker-styles: duplicate style/,
  );
  // the hook entry parses the FIRST --marker-style: a shared hook-args value
  // carrying the flag would silently collapse every arm to one style
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized'],
        ...NO_ABLATION,
        hook: true,
        hookArgs: '--marker-style informative',
        markerStyles: ALL_STYLES,
      }),
    /--marker-styles cannot be combined with --hook-args containing --marker-style/,
  );
  assert.throws(
    () =>
      buildVariants({
        modes: ['full'],
        ...NO_ABLATION,
        hook: true,
        markerStyles: ALL_STYLES,
      }),
    /--marker-styles: no hook-bearing variants/,
  );
  assert.throws(
    () =>
      buildVariants({
        modes: ['optimized', 'slim'],
        ...NO_ABLATION,
        hook: false,
        markerStyles: ALL_STYLES,
      }),
    /--marker-styles: no hook-bearing variants/,
  );
});

test('markerStyles fan-out also covers ablation variants', () => {
  const variants = buildVariants({
    modes: ['optimized'],
    ablate: [],
    ablateAdd: [],
    ablateGroups: ['behavior'],
    hook: true,
    markerStyles: ['plain', 'informative'],
  });
  const ids = variants.map((v) => v.id).sort();
  assert.deepEqual(ids, [
    'optimized-marker-informative',
    'optimized-marker-plain',
    'optimized-minus-behavior-atoms-marker-informative',
    'optimized-minus-behavior-atoms-marker-plain',
  ]);
  // style file names stay unique across the fan-out (duplicate check active)
  const styleNames = variants.map((v) => v.styleName);
  assert.equal(new Set(styleNames).size, styleNames.length);
});
