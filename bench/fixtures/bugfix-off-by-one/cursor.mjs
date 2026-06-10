import { pageCount } from './count.mjs';

// Opaque cursor format: base64url of `v1:<offset>:<perPage>`. Cursors are
// versioned so a future format change can keep accepting old links.
const CURSOR_VERSION = 'v1';

export function encodeCursor(offset, perPage) {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new TypeError('offset must be a non-negative integer');
  }
  if (!Number.isInteger(perPage) || perPage <= 0) {
    throw new TypeError('perPage must be a positive integer');
  }
  return Buffer.from(`${CURSOR_VERSION}:${offset}:${perPage}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor === '') {
    throw new TypeError('cursor must be a non-empty string');
  }
  let decoded;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new TypeError('cursor is not valid base64url');
  }
  const parts = decoded.split(':');
  if (parts.length !== 3 || parts[0] !== CURSOR_VERSION) {
    throw new TypeError(`cursor must be a ${CURSOR_VERSION} cursor`);
  }
  const offset = Number(parts[1]);
  const perPage = Number(parts[2]);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(perPage) || perPage <= 0) {
    throw new TypeError('cursor carries invalid bounds');
  }
  return { offset, perPage };
}

/**
 * Cursor-based slice: returns the window after `cursor` (or the first window
 * when cursor is null) plus the cursor for the next call, or null at the end.
 */
export function sliceAfter(items, cursor, perPage) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  let offset = 0;
  let size = perPage;
  if (cursor !== null && cursor !== undefined) {
    const decoded = decodeCursor(cursor);
    offset = decoded.offset;
    size = decoded.perPage;
  }
  if (!Number.isInteger(size) || size <= 0) {
    throw new TypeError('perPage must be a positive integer');
  }
  const page = items.slice(offset, offset + size);
  const nextOffset = offset + size;
  return {
    items: page,
    nextCursor: nextOffset < items.length ? encodeCursor(nextOffset, size) : null,
    totalPages: pageCount(items.length, size),
  };
}

/** Walks every window of `items`, yielding pages until the cursor runs out. */
export function* iteratePages(items, perPage) {
  let cursor = null;
  do {
    const window = sliceAfter(items, cursor, perPage);
    if (window.items.length === 0) {
      return;
    }
    yield window.items;
    cursor = window.nextCursor;
  } while (cursor !== null);
}
