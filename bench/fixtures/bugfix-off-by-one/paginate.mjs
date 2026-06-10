import { pageCount } from './count.mjs';

export function paginate(items, page, perPage) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  if (!Number.isInteger(page) || page <= 0) {
    throw new TypeError('page must be a positive integer');
  }
  const pages = pageCount(items.length, perPage);
  if (page > pages) {
    return [];
  }
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage - 1);
}
