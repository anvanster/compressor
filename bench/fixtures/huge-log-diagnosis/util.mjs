// Shared helpers for the parcel-hub modules.
//
// Tier table (operations handbook, rev 12):
//   letter  — up to and including 500 g
//   parcel  — 501 g up to and including 2,000 g
//   freight — 2,001 g up to and including 20,000 g
//   pallet  — anything heavier

export function tierForWeight(grams) {
  if (!Number.isInteger(grams) || grams <= 0) {
    throw new RangeError(`weight must be a positive integer of grams, got ${grams}`);
  }
  if (grams < 500) return 'letter';
  if (grams <= 2000) return 'parcel';
  if (grams <= 20000) return 'freight';
  return 'pallet';
}

export function formatId(prefix, n) {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`id number must be a non-negative integer, got ${n}`);
  }
  return `${prefix}-${String(n).padStart(5, '0')}`;
}

export function sumCents(values) {
  let total = 0;
  for (const value of values) {
    if (!Number.isInteger(value)) {
      throw new TypeError(`cents must be integers, got ${value}`);
    }
    total += value;
  }
  return total;
}

export function clamp(value, lo, hi) {
  if (lo > hi) {
    throw new RangeError('clamp: lo must not exceed hi');
  }
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

export function formatCents(cents) {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`cents must be an integer, got ${cents}`);
  }
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
