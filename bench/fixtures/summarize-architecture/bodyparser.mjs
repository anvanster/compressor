import { header } from './context.mjs';
import { badRequest, payloadTooLarge } from './errors.mjs';

/**
 * Parse JSON request bodies into ctx.request.body. Non-JSON content types
 * pass through untouched. Oversized or malformed payloads throw HttpError,
 * which unwinds to the error boundary.
 */
export function jsonBodyParser({ limitBytes = 64 * 1024 } = {}) {
  return async (ctx, next) => {
    const contentType = header(ctx, 'content-type') ?? '';
    const raw = ctx.request.rawBody;
    if (raw !== null && contentType.includes('application/json')) {
      if (typeof raw !== 'string') {
        throw badRequest('json body must be a string payload');
      }
      if (raw.length > limitBytes) {
        throw payloadTooLarge(`body exceeds ${limitBytes} bytes`);
      }
      try {
        ctx.request.body = JSON.parse(raw);
      } catch {
        throw badRequest('malformed json body');
      }
    }
    return next();
  };
}
