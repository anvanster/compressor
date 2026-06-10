export function send(ctx, status, body, headers = {}) {
  if (ctx.response.ended) {
    throw new Error('response already ended');
  }
  ctx.response.status = status;
  Object.assign(ctx.response.headers, headers);
  ctx.response.body = body;
  ctx.response.ended = true;
}

export function text(ctx, status, body) {
  send(ctx, status, body, { 'content-type': 'text/plain; charset=utf-8' });
}

export function json(ctx, status, value) {
  send(ctx, status, JSON.stringify(value), { 'content-type': 'application/json' });
}

export function redirect(ctx, location, status = 302) {
  send(ctx, status, '', { location });
}

export function noContent(ctx) {
  send(ctx, 204, null);
}

export function notFound(ctx) {
  json(ctx, 404, { error: `no route for ${ctx.request.method} ${ctx.request.path}` });
}

/**
 * Convert the mutable response draft into the plain object the framework
 * hands back to the caller. A pipeline that never wrote a response yields
 * a 404 here, so every request resolves to something well-formed.
 */
export function finalizeResponse(ctx) {
  if (!ctx.response.ended) {
    notFound(ctx);
  }
  return {
    status: ctx.response.status,
    headers: { ...ctx.response.headers },
    body: ctx.response.body,
  };
}
