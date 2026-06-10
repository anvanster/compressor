// Order assembly: catalog-backed orders plus hand-weighed one-off packages.

import { lineCents, lineWeight } from './inventory.mjs';
import { formatId, sumCents, tierForWeight } from './util.mjs';

export function buildOrder(seq, lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new RangeError('order needs at least one line');
  }
  return { id: formatId('ORD', seq), lines };
}

export function orderWeight(order) {
  let grams = 0;
  for (const line of order.lines) {
    grams += lineWeight(line.sku, line.qty);
  }
  return grams;
}

export function orderSubtotal(order) {
  return sumCents(order.lines.map((line) => lineCents(line.sku, line.qty)));
}

export function packOrder(order) {
  const grams = orderWeight(order);
  return { id: order.id, grams, tier: tierForWeight(grams) };
}

// One-off packages weighed at the counter (not in the catalog).
export function manualPackage(seq, grams) {
  return { id: formatId('PKG', seq), grams, tier: tierForWeight(grams) };
}
