/**
 * Tiny LRU cache for materialized pages. Keys are `${page}:${perPage}`;
 * recency is tracked by Map insertion order (delete + set on each hit).
 */
export class PageCache {
  #entries = new Map();
  #capacity;
  #hits = 0;
  #misses = 0;

  constructor(capacity = 32) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new TypeError('capacity must be a positive integer');
    }
    this.#capacity = capacity;
  }

  static key(page, perPage) {
    if (!Number.isInteger(page) || page <= 0) {
      throw new TypeError('page must be a positive integer');
    }
    if (!Number.isInteger(perPage) || perPage <= 0) {
      throw new TypeError('perPage must be a positive integer');
    }
    return `${page}:${perPage}`;
  }

  get(page, perPage) {
    const key = PageCache.key(page, perPage);
    if (!this.#entries.has(key)) {
      this.#misses += 1;
      return undefined;
    }
    const value = this.#entries.get(key);
    this.#entries.delete(key);
    this.#entries.set(key, value);
    this.#hits += 1;
    return value;
  }

  set(page, perPage, items) {
    if (!Array.isArray(items)) {
      throw new TypeError('items must be an array');
    }
    const key = PageCache.key(page, perPage);
    this.#entries.delete(key);
    this.#entries.set(key, items);
    while (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next().value;
      this.#entries.delete(oldest);
    }
    return this;
  }

  invalidate() {
    this.#entries.clear();
    return this;
  }

  stats() {
    return {
      size: this.#entries.size,
      capacity: this.#capacity,
      hits: this.#hits,
      misses: this.#misses,
    };
  }
}
