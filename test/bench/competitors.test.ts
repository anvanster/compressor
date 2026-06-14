import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import {
  COMPETITORS,
  competitorVariant,
  isCompetitor,
  stripFrontmatter,
} from '../../src/bench/competitors.ts';
import { buildVariants } from '../../src/bench/ablate.ts';

const REPO_COMPETITORS = path.resolve('bench/competitors');

test('stripFrontmatter removes a leading YAML block, leaves bodies untouched', () => {
  assert.equal(stripFrontmatter('---\nname: x\n---\nbody here'), 'body here');
  assert.equal(stripFrontmatter('no frontmatter\nbody'), 'no frontmatter\nbody');
  // only the LEADING block is stripped; a later --- divider survives
  assert.equal(stripFrontmatter('---\na: 1\n---\nbody\n---\nmore'), 'body\n---\nmore');
});

test('isCompetitor recognizes known packs only', () => {
  assert.ok(isCompetitor('caveman'));
  assert.ok(!isCompetitor('nonsense'));
  assert.deepEqual([...COMPETITORS], ['caveman']);
});

test('competitorVariant(caveman) builds an output-only arm from the real asset', async () => {
  const variant = await competitorVariant('caveman', REPO_COMPETITORS);
  assert.equal(variant.id, 'caveman');
  assert.equal(variant.styleName, 'caveman');
  assert.equal(variant.hook, false, 'output-only: no compression hook');
  assert.equal(variant.baseMode, 'full');
  // delivered via the same output-style channel as compressor
  assert.ok(variant.styleBody?.startsWith('---\ndescription: '), 'output-style frontmatter');
  assert.ok(variant.styleBody?.includes('keep-coding-instructions: true'), 'fair: same coding-instructions flag');
  // the real caveman ruleset is present, its own skill frontmatter stripped
  assert.ok(variant.styleBody?.includes('Respond terse like smart caveman'), 'real pack body embedded');
  assert.ok(!variant.styleBody?.includes('name: caveman'), 'upstream skill frontmatter stripped');
});

test('competitorVariant errors clearly when the asset is missing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-comp-'));
  await assert.rejects(competitorVariant('caveman', dir), /pack asset missing/);
});

test('competitorVariant errors on an empty pack body', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-comp-empty-'));
  await writeFile(path.join(dir, 'caveman-skill.md'), '---\nname: caveman\n---\n', 'utf8');
  await assert.rejects(competitorVariant('caveman', dir), /empty after stripping frontmatter/);
});

test('buildVariants appends competitors alongside the compressor modes', async () => {
  const caveman = await competitorVariant('caveman', REPO_COMPETITORS);
  const variants = buildVariants({
    modes: ['full', 'optimized'],
    ablate: [],
    ablateAdd: [],
    ablateGroups: [],
    hook: true,
    competitors: [caveman],
  });
  assert.deepEqual(
    variants.map((v) => v.id),
    ['full', 'optimized', 'caveman'],
  );
  // the hook stays on the compressor mode and off the competitor
  assert.equal(variants.find((v) => v.id === 'optimized')?.hook, true);
  assert.equal(variants.find((v) => v.id === 'caveman')?.hook, false);
});
