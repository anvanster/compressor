import { send } from './respond.mjs';

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function contentTypeFor(path) {
  const dot = path.lastIndexOf('.');
  if (dot === -1) {
    return 'application/octet-stream';
  }
  return CONTENT_TYPES.get(path.slice(dot)) ?? 'application/octet-stream';
}

/**
 * Static asset plugin backed by an in-memory map of path -> content.
 * GET requests under `prefix` are answered directly and short-circuit the
 * rest of the pipeline (the router never sees them); anything else, and
 * any miss inside the prefix, falls through via next().
 */
export function staticAssets(prefix, assets) {
  const table = assets instanceof Map ? assets : new Map(Object.entries(assets));
  return async (ctx, next) => {
    const { method, path } = ctx.request;
    if (method !== 'GET' || !path.startsWith(prefix)) {
      return next();
    }
    const key = path.slice(prefix.length);
    const content = table.get(key);
    if (content === undefined) {
      return next();
    }
    send(ctx, 200, content, { 'content-type': contentTypeFor(key) });
  };
}
