export function roundMoney(amount) {
  return Math.round(amount * 100) / 100;
}

export function computeSubtotal(items) {
  const raw = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  return roundMoney(raw);
}

export function taxableSubtotal(items) {
  const raw = items
    .filter((item) => item.taxable)
    .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  return roundMoney(raw);
}

const COUPONS = new Map([
  ['WELCOME10', { kind: 'percent', value: 10 }],
  ['FREESHIP', { kind: 'flat', value: 7.5 }],
  ['VIP25', { kind: 'percent', value: 25 }],
]);

export function applyCoupon(subtotal, code) {
  if (code === null || code === undefined) {
    return { subtotal, discount: 0 };
  }
  const coupon = COUPONS.get(code);
  if (!coupon) {
    throw new Error(`invalid coupon code: ${code}`);
  }
  const discount =
    coupon.kind === 'percent'
      ? roundMoney((subtotal * coupon.value) / 100)
      : Math.min(coupon.value, subtotal);
  return { subtotal: roundMoney(subtotal - discount), discount: roundMoney(discount) };
}

const TAX_RATES = new Map([
  ['US-CA', 0.0925],
  ['US-NY', 0.08875],
  ['US-TX', 0.0825],
  ['US-OR', 0],
  ['EU-DE', 0.19],
  ['EU-FR', 0.2],
]);

export function knownRegions() {
  return [...TAX_RATES.keys()];
}

export function computeTax(taxableAmount, region) {
  const rate = TAX_RATES.get(region);
  if (rate === undefined) {
    throw new Error(`no tax table for region: ${region}`);
  }
  return roundMoney(taxableAmount * rate);
}
