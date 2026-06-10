const PRODUCTS = new Map([
  ['KB-201', { sku: 'KB-201', name: 'Mechanical keyboard', unitPrice: 89.0, taxable: true }],
  ['MS-310', { sku: 'MS-310', name: 'Trackball mouse', unitPrice: 54.5, taxable: true }],
  ['HS-118', { sku: 'HS-118', name: 'Wired headset', unitPrice: 39.99, taxable: true }],
  ['DK-440', { sku: 'DK-440', name: 'Standing desk mat', unitPrice: 64.0, taxable: true }],
  ['CB-072', { sku: 'CB-072', name: 'Braided USB-C cable', unitPrice: 12.25, taxable: true }],
  ['GC-050', { sku: 'GC-050', name: 'Gift card', unitPrice: 25.0, taxable: false }],
]);

export function findProduct(sku) {
  const product = PRODUCTS.get(sku);
  if (!product) {
    throw new Error(`unknown sku: ${sku}`);
  }
  return product;
}

export function listSkus() {
  return [...PRODUCTS.keys()];
}

export function priceOf(sku) {
  return findProduct(sku).unitPrice;
}

export function isTaxable(sku) {
  return findProduct(sku).taxable;
}
