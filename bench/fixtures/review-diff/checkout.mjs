import {
  applyCoupon,
  computeSubtotal,
  computeTax,
  roundMoney,
  taxableSubtotal,
} from './pricing.mjs';
import { authorizePayment, createPaymentIntent } from './payments.mjs';
import { isEmpty } from './cart.mjs';

export function receiptLines(cart) {
  return cart.items.map((item) => ({
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    lineTotal: roundMoney(item.unitPrice * item.quantity),
  }));
}

export function checkout(cart, options) {
  const { region, couponCode = null, reference } = options;
  if (isEmpty(cart)) {
    throw new Error('cannot check out an empty cart');
  }
  if (!reference) {
    throw new Error('checkout requires an order reference');
  }

  const subtotal = computeSubtotal(cart.items);
  const { subtotal: discounted, discount } = applyCoupon(subtotal, couponCode);

  // Tax applies to the taxable share of the discounted amount, scaled by the
  // same ratio the discount applied to the whole order.
  const taxableShare = subtotal === 0 ? 0 : taxableSubtotal(cart.items) / subtotal;
  const taxBase = roundMoney(discounted * taxableShare);
  const tax = computeTax(taxBase, region);

  const total = roundMoney(discounted + tax);
  const intent = createPaymentIntent(total, cart.currency, reference);
  const payment = authorizePayment(intent);

  return {
    reference,
    currency: cart.currency,
    lines: receiptLines(cart),
    subtotal,
    discount,
    tax,
    total,
    payment: { intentId: intent.id, status: payment.status, code: payment.code ?? null },
  };
}
