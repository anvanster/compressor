/**
 * Compose middleware into a single callable. Each middleware has the shape
 * (ctx, next) => Promise; `terminal` runs when the innermost middleware
 * calls next(). The fold is right-to-left, so the first middleware in the
 * array becomes the outermost layer of the onion.
 */
export function foldPipeline(middlewares, terminal) {
  if (typeof terminal !== 'function') {
    throw new TypeError('terminal must be a function');
  }
  for (const middleware of middlewares) {
    if (typeof middleware !== 'function') {
      throw new TypeError('every middleware must be a function');
    }
  }
  return middlewares.reduceRight((next, middleware) => {
    return async function layer(ctx) {
      let called = false;
      const step = () => {
        if (called) {
          return Promise.reject(new Error('next() called more than once in a middleware'));
        }
        called = true;
        return next(ctx);
      };
      return middleware(ctx, step);
    };
  }, async (ctx) => terminal(ctx));
}
