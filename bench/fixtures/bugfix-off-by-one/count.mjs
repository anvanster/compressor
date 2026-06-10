export function pageCount(totalItems, perPage) {
  if (!Number.isInteger(totalItems) || totalItems < 0) {
    throw new TypeError('totalItems must be a non-negative integer');
  }
  if (!Number.isInteger(perPage) || perPage <= 0) {
    throw new TypeError('perPage must be a positive integer');
  }
  return Math.ceil(totalItems / perPage);
}
