// Shipping quotes: tier base rate times destination-zone factor.

import { formatCents, tierForWeight } from './util.mjs';

const TIER_BASE_CENTS = Object.freeze({
  letter: 150,
  parcel: 600,
  freight: 2400,
  pallet: 10500,
});

const ZONE_FACTOR_TENTHS = Object.freeze({
  'zone-1': 10,
  'zone-2': 14,
  'zone-3': 19,
});

export function zones() {
  return Object.keys(ZONE_FACTOR_TENTHS);
}

export function quoteShipping(grams, zone) {
  const factor = ZONE_FACTOR_TENTHS[zone];
  if (factor === undefined) {
    throw new RangeError(`unknown zone: ${zone}`);
  }
  const tier = tierForWeight(grams);
  const cents = (TIER_BASE_CENTS[tier] * factor) / 10;
  return { tier, zone, cents };
}

export function labelFor(grams, zone) {
  const quote = quoteShipping(grams, zone);
  return `${quote.tier}/${quote.zone} ${formatCents(quote.cents)}`;
}

export function cheapestZone(grams, zoneNames) {
  if (!Array.isArray(zoneNames) || zoneNames.length === 0) {
    throw new RangeError('cheapestZone needs at least one zone');
  }
  let best = null;
  for (const zone of zoneNames) {
    const quote = quoteShipping(grams, zone);
    if (best === null || quote.cents < best.cents) {
      best = quote;
    }
  }
  return best.zone;
}
