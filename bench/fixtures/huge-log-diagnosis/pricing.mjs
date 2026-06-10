// Pricing rules: tier surcharges, discounts, line and invoice totals.

import { clamp, sumCents, tierForWeight } from './util.mjs';

const TIER_SURCHARGE_CENTS = Object.freeze({
  letter: 0,
  parcel: 120,
  freight: 480,
  pallet: 1500,
});

export function surchargeFor(grams) {
  return TIER_SURCHARGE_CENTS[tierForWeight(grams)];
}

export function discountedCents(cents, percent) {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`cents must be a non-negative integer, got ${cents}`);
  }
  const pct = clamp(percent, 0, 90);
  return cents - Math.floor((cents * pct) / 100);
}

export function lineTotal(unitCents, qty) {
  if (!Number.isInteger(unitCents) || unitCents < 0) {
    throw new RangeError(`unitCents must be a non-negative integer, got ${unitCents}`);
  }
  if (!Number.isInteger(qty) || qty < 1) {
    throw new RangeError(`qty must be a positive integer, got ${qty}`);
  }
  return unitCents * qty;
}

export function invoiceTotal(itemCents, grams) {
  return sumCents(itemCents) + surchargeFor(grams);
}
