import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrder, refundOrder, shipOrder } from './orders.mjs';

const valid = () => ({ id: 7, items: ['widget'], total: 25 });

test('createOrder stamps status created', () => {
  assert.deepEqual(createOrder(valid()), { ...valid(), status: 'created' });
});

test('shipOrder stamps status shipped', () => {
  assert.deepEqual(shipOrder(valid()), { ...valid(), status: 'shipped' });
});

test('refundOrder caps the refund at the order total', () => {
  assert.equal(refundOrder(valid(), 100).refund, 25);
  assert.equal(refundOrder(valid(), 10).refund, 10);
  assert.throws(() => refundOrder(valid(), -1), TypeError);
});

test('all three functions reject invalid orders identically', () => {
  const cases = [
    null,
    { id: 0, items: ['x'], total: 5 },
    { id: 1, items: [], total: 5 },
    { id: 1, items: ['x'], total: -1 },
    { id: 1, items: ['x'], total: Infinity },
  ];
  for (const fn of [createOrder, shipOrder, (o) => refundOrder(o, 1)]) {
    for (const bad of cases) {
      assert.throws(() => fn(bad), TypeError);
    }
  }
});

test('shared order validation lives in validate.mjs', async () => {
  const mod = await import('./validate.mjs');
  assert.equal(typeof mod.validateOrder, 'function', 'validate.mjs must export validateOrder');
  assert.throws(() => mod.validateOrder({ id: 1, items: [], total: 5 }), TypeError);
  assert.doesNotThrow(() => mod.validateOrder({ id: 1, items: ['x'], total: 5 }));
});
