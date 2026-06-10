export function createOrder(order) {
  if (order === null || typeof order !== 'object') {
    throw new TypeError('order must be an object');
  }
  if (!Number.isInteger(order.id) || order.id <= 0) {
    throw new TypeError('order.id must be a positive integer');
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new TypeError('order.items must be a non-empty array');
  }
  if (!Number.isFinite(order.total) || order.total < 0) {
    throw new TypeError('order.total must be a non-negative finite number');
  }
  return { ...order, status: 'created' };
}

export function shipOrder(order) {
  if (order === null || typeof order !== 'object') {
    throw new TypeError('order must be an object');
  }
  if (!Number.isInteger(order.id) || order.id <= 0) {
    throw new TypeError('order.id must be a positive integer');
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new TypeError('order.items must be a non-empty array');
  }
  if (!Number.isFinite(order.total) || order.total < 0) {
    throw new TypeError('order.total must be a non-negative finite number');
  }
  return { ...order, status: 'shipped' };
}

export function refundOrder(order, amount) {
  if (order === null || typeof order !== 'object') {
    throw new TypeError('order must be an object');
  }
  if (!Number.isInteger(order.id) || order.id <= 0) {
    throw new TypeError('order.id must be a positive integer');
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new TypeError('order.items must be a non-empty array');
  }
  if (!Number.isFinite(order.total) || order.total < 0) {
    throw new TypeError('order.total must be a non-negative finite number');
  }
  if (!Number.isFinite(amount) || amount < 0) {
    throw new TypeError('amount must be a non-negative finite number');
  }
  const refund = Math.min(amount, order.total);
  return { ...order, status: 'refunded', refund };
}
