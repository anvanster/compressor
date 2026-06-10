function parseQuery(queryString) {
  const query = {};
  if (!queryString) {
    return query;
  }
  for (const pair of queryString.split('&')) {
    if (!pair) {
      continue;
    }
    const [rawKey, rawValue = ''] = pair.split('=', 2);
    query[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue);
  }
  return query;
}

function lowerCaseKeys(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

/**
 * Build the per-request context. Everything downstream — middleware, route
 * handlers, error rendering — reads and mutates this one object; nothing
 * else is threaded through the pipeline.
 */
export function createContext(rawRequest) {
  const { method = 'GET', url = '/', headers = {}, body = null } = rawRequest;
  const [path = '/', queryString = ''] = url.split('?', 2);
  return {
    request: {
      method: method.toUpperCase(),
      path,
      query: parseQuery(queryString),
      headers: lowerCaseKeys(headers),
      rawBody: body,
      body: null,
    },
    response: {
      status: null,
      headers: {},
      body: null,
      ended: false,
    },
    params: {},
    state: new Map(),
  };
}

export function header(ctx, name) {
  return ctx.request.headers[name.toLowerCase()] ?? null;
}
