import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunk, pageCount, paginate, range } from './index.mjs';

test('range produces a half-open integer sequence', () => {
  assert.deepEqual(range(1, 5), [1, 2, 3, 4]);
  assert.deepEqual(range(3, 3), []);
});

test('pageCount rounds up partial pages', () => {
  assert.equal(pageCount(10, 3), 4);
  assert.equal(pageCount(9, 3), 3);
  assert.equal(pageCount(0, 3), 0);
});

test('chunk splits items into fixed-size groups', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});

test('paginate rejects invalid pages and clamps overflow', () => {
  assert.throws(() => paginate([1], 0, 2), TypeError);
  assert.throws(() => paginate('nope', 1, 2), TypeError);
  assert.deepEqual(paginate([1, 2, 3], 5, 2), []);
});

test('paginate keeps a short remainder on the last page', () => {
  assert.deepEqual(paginate([1, 2, 3, 4, 5, 6, 7], 3, 3), [7]);
});

test('paginate returns a full first page', () => {
  assert.deepEqual(paginate([1, 2, 3, 4, 5, 6], 1, 3), [1, 2, 3]);
});

test('paginate returns the final full page intact', () => {
  assert.deepEqual(paginate([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, 3), [7, 8, 9]);
});
