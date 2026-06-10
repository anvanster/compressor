// Deterministic warehouse catalog: 40 SKUs with fixed weights and prices.

import { formatId } from './util.mjs';

const CATALOG = new Map();
for (let i = 1; i <= 40; i += 1) {
  CATALOG.set(formatId('SKU', i), {
    grams: 40 + i * 37,
    unitCents: 150 + i * 55,
  });
}

function entryFor(sku) {
  const entry = CATALOG.get(sku);
  if (entry === undefined) {
    throw new RangeError(`unknown sku: ${sku}`);
  }
  return entry;
}

function assertQty(qty) {
  if (!Number.isInteger(qty) || qty < 1) {
    throw new RangeError(`qty must be a positive integer, got ${qty}`);
  }
}

export function catalogSkus() {
  return [...CATALOG.keys()];
}

export function weightOf(sku) {
  return entryFor(sku).grams;
}

export function priceOf(sku) {
  return entryFor(sku).unitCents;
}

export function lineWeight(sku, qty) {
  assertQty(qty);
  return weightOf(sku) * qty;
}

export function lineCents(sku, qty) {
  assertQty(qty);
  return priceOf(sku) * qty;
}
