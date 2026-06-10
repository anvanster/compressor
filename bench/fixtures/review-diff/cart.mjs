import { findProduct } from './catalog.mjs';

export function createCart(currency = 'USD') {
  return { currency, items: [] };
}

export function addItem(cart, sku, quantity = 1) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError(`quantity must be a positive integer, got ${quantity}`);
  }
  const product = findProduct(sku);
  const existing = cart.items.find((item) => item.sku === sku);
  if (existing) {
    existing.quantity += quantity;
    return cart;
  }
  cart.items.push({
    sku: product.sku,
    name: product.name,
    unitPrice: product.unitPrice,
    taxable: product.taxable,
    quantity,
  });
  return cart;
}

export function removeItem(cart, sku, quantity = Infinity) {
  const index = cart.items.findIndex((item) => item.sku === sku);
  if (index === -1) {
    throw new Error(`sku not in cart: ${sku}`);
  }
  const item = cart.items[index];
  if (quantity >= item.quantity) {
    cart.items.splice(index, 1);
  } else {
    item.quantity -= quantity;
  }
  return cart;
}

export function itemCount(cart) {
  return cart.items.reduce((sum, item) => sum + item.quantity, 0);
}

export function isEmpty(cart) {
  return cart.items.length === 0;
}
