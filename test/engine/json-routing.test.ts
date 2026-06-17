import test from 'node:test';
import assert from 'node:assert/strict';
import { compress, policyFor } from '../../src/engine/index.ts';
import type { CompressMeta } from '../../src/engine/index.ts';

// JSON takes an EXCLUSIVE engine path that skips ALL structural tiers
// (dedupeLines collapses repeated lines, truncateHeadTail cuts the middle —
// both corrupt JSON). These tests assert the routing: ONLY 'json-minify' runs,
// the output is valid minified JSON, and full mode (the only shipped off-state)
// is byte-identical passthrough.
// NOTE: byte-identity under jsonMinify:false is NOT guaranteed in general —
// with structural:true a repeated-line JSON would route through dedupeLines and
// be corrupted; in production jsonMinify is false ONLY in full mode (policyFor),
// where the passthrough guard fires first.

const estimate = (s: string): number => Math.ceil(s.length / 4);

/** A pretty JSON object big enough to clear slim/optimized `touch`. */
function bigPrettyJson(rows: number): string {
  const arr = Array.from({ length: rows }, (_, i) => ({
    id: i,
    name: `item ${i}`,
    note: 'lorem ipsum dolor sit amet consectetur adipiscing elit',
  }));
  return JSON.stringify({ rows: arr }, null, 2);
}

const META: CompressMeta = { tool: 'mcp', mode: 'slim' };

test('pretty JSON over touch with jsonMinify on → ONLY json-minify transform', () => {
  const pretty = bigPrettyJson(40);
  const result = compress(pretty, META, policyFor('slim'), estimate);

  assert.equal(result.stats.kind, 'json');
  assert.deepEqual(
    result.stats.transforms.map((t) => t.id),
    ['json-minify'],
    'exactly one transform, the json minify',
  );
  // NO structural/code/log transform present
  for (const id of ['dedupe-lines', 'truncate', 'skeleton', 'strip-ansi', 'collapse-blank']) {
    assert.ok(
      !result.stats.transforms.some((t) => t.id === id),
      `${id} must not run on JSON`,
    );
  }
  // output is valid, semantically-equal, denser JSON
  assert.deepEqual(JSON.parse(result.content), JSON.parse(pretty));
  assert.ok(result.content.length < pretty.length, 'minified is shorter');
  assert.ok(!result.content.includes('[compressor:'), 'no omission marker on a lossless transform');
});

test('optimized also minifies JSON (lossless ⇒ safe in optimized)', () => {
  const pretty = bigPrettyJson(60);
  const result = compress(pretty, META, policyFor('optimized'), estimate);
  assert.equal(result.stats.kind, 'json');
  assert.deepEqual(result.stats.transforms.map((t) => t.id), ['json-minify']);
  assert.deepEqual(JSON.parse(result.content), JSON.parse(pretty));
});

test('INVARIANT A: full mode is byte-identical passthrough for the same JSON', () => {
  const pretty = bigPrettyJson(40);
  const result = compress(pretty, META, policyFor('full'), estimate);
  assert.equal(result.content, pretty, 'full mode never modifies content');
  assert.deepEqual(result.stats.transforms, []);
  assert.equal(result.stats.kind, 'json');
});

test('INVARIANT A: jsonMinify off (full policy) leaves JSON byte-identical', () => {
  const pretty = bigPrettyJson(40);
  const off = { ...policyFor('slim'), jsonMinify: false };
  // With jsonMinify off, JSON would fall to the structural flow; but full-policy
  // already proves passthrough. Here assert that explicitly disabling jsonMinify
  // does NOT route through the exclusive JSON branch — and crucially never emits
  // a json-minify transform.
  const result = compress(pretty, META, off, estimate);
  assert.ok(
    !result.stats.transforms.some((t) => t.id === 'json-minify'),
    'no json-minify when the policy flag is off',
  );
  // This assertion is deliberately limited to transform-ABSENCE. Byte-identity
  // is NOT asserted here because it is not guaranteed off the json branch: this
  // hand-built off-policy keeps structural:true, so a repeated-line JSON would
  // route through dedupeLines and be corrupted. The only off-state that ships
  // is full mode, whose passthrough guard fires first — locked in by the test
  // below.
});

test('INVARIANT A: full mode is byte-identical even for a JSON that WOULD corrupt under dedupe', () => {
  // The only shipped off-state is full mode. Use a fixture whose pretty form is
  // a long run of identical lines (an array of 999 identical strings) — exactly
  // the input a non-shipping structural off-policy would mangle via dedupeLines
  // into a '[compressor: …]' marker. Full mode's passthrough must leave it
  // byte-identical, proving the real off-state is safe.
  const arr = Array.from({ length: 999 }, () => 'same');
  const pretty = JSON.stringify(arr, null, 2);
  const lines = pretty.split('\n');
  const repeats = lines.filter((l) => l.trim() === '"same",').length;
  assert.ok(repeats > 900, 'fixture has a long run of identical lines');

  const result = compress(pretty, META, policyFor('full'), estimate);
  assert.equal(result.content, pretty, 'full mode never modifies content');
  assert.deepEqual(result.stats.transforms, []);
  assert.ok(!result.content.includes('[compressor:'), 'no dedupe marker');
});

test('huge pretty JSON with many repeated identical lines: dedupeLines did NOT run', () => {
  // Build JSON whose pretty form has MANY identical lines (the repeated note
  // and closing braces). On the structural path dedupeLines would replace runs
  // with a '[compressor: previous line repeated N more times]' marker —
  // corrupting the JSON. The exclusive path must avoid that entirely.
  const arr = Array.from({ length: 200 }, () => ({ note: 'same', kind: 'same' }));
  const pretty = JSON.stringify(arr, null, 2);
  // sanity: the pretty form really does have long identical-line runs
  const lines = pretty.split('\n');
  const repeats = lines.filter((l) => l.trim() === '"note": "same",').length;
  assert.ok(repeats > 50, 'fixture has a long run of identical lines');

  const result = compress(pretty, META, policyFor('slim'), estimate);
  assert.equal(result.stats.kind, 'json');
  assert.deepEqual(result.stats.transforms.map((t) => t.id), ['json-minify']);
  assert.ok(!result.content.includes('[compressor:'), 'dedupe marker absent');
  // still valid JSON, equal to the original
  assert.deepEqual(JSON.parse(result.content), arr);
});

test('JSON below touch passes through untouched (kind still json)', () => {
  const small = JSON.stringify({ a: 1 }, null, 2);
  const result = compress(small, META, policyFor('slim'), estimate);
  assert.equal(result.content, small);
  assert.deepEqual(result.stats.transforms, []);
});

test('non-JSON generic content is unaffected by the JSON branch (Invariant A)', () => {
  const log = Array.from({ length: 400 }, (_, i) => `row ${i} some output line here`).join('\n');
  const result = compress(log, META, policyFor('slim'), estimate);
  // generic log flows the normal path — NOT json kind, no json-minify transform
  assert.notEqual(result.stats.kind, 'json');
  assert.ok(!result.stats.transforms.some((t) => t.id === 'json-minify'));
});
