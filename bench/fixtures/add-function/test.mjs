import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capitalize, truncate, words } from './strings.mjs';

test('capitalize uppercases the first character only', () => {
  assert.equal(capitalize('hello'), 'Hello');
  assert.equal(capitalize(''), '');
  assert.equal(capitalize('a b'), 'A b');
});

test('truncate keeps short strings and shortens long ones', () => {
  assert.equal(truncate('abc', 5), 'abc');
  assert.equal(truncate('abcdef', 5), 'abcd…');
  assert.throws(() => truncate('abc', 0), TypeError);
});

test('words splits on whitespace runs', () => {
  assert.deepEqual(words('  one\ttwo \n three '), ['one', 'two', 'three']);
  assert.deepEqual(words(''), []);
});

test('slugify converts arbitrary titles to url-safe slugs', async () => {
  const mod = await import('./strings.mjs');
  assert.equal(typeof mod.slugify, 'function', 'strings.mjs must export slugify');
  assert.equal(mod.slugify('Hello, World!'), 'hello-world');
  assert.equal(mod.slugify('  --Already   Slugged--  '), 'already-slugged');
  assert.equal(mod.slugify('v2.0 release notes'), 'v2-0-release-notes');
  assert.equal(mod.slugify(''), '');
  assert.throws(() => mod.slugify(42), TypeError);
});
