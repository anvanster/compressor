import { json } from './respond.mjs';

export class HttpError extends Error {
  constructor(status, message, { expose = status < 500 } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.expose = expose;
  }
}

export function badRequest(message) {
  return new HttpError(400, message);
}

export function payloadTooLarge(message) {
  return new HttpError(413, message);
}

/**
 * Outermost middleware: anything thrown anywhere below it — other
 * middleware, route handlers, the router itself — unwinds the stack to
 * this layer, which converts the exception into an HTTP error response.
 * HttpError instances keep their status and (when exposed) message;
 * everything else is masked as a generic 500 so internals never leak.
 */
export function errorBoundary() {
  return async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      const isHttp = error instanceof HttpError;
      const status = isHttp ? error.status : 500;
      const message = isHttp && error.expose ? error.message : 'internal error';
      ctx.response.ended = false;
      ctx.response.headers = {};
      json(ctx, status, { error: message });
      ctx.state.set('lastError', { status, detail: error.message });
    }
  };
}
