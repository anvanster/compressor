import { foldPipeline } from './pipeline.mjs';
import { HttpError } from './errors.mjs';

function compilePattern(pattern) {
  const segments = pattern.split('/').filter(Boolean);
  return {
    pattern,
    segments: segments.map((segment) =>
      segment.startsWith(':')
        ? { kind: 'param', name: segment.slice(1) }
        : { kind: 'literal', value: segment },
    ),
  };
}

function matchSegments(compiled, path) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length !== compiled.segments.length) {
    return null;
  }
  const params = {};
  for (let i = 0; i < parts.length; i += 1) {
    const segment = compiled.segments[i];
    const part = parts[i];
    if (segment.kind === 'literal') {
      if (segment.value !== part) {
        return null;
      }
    } else {
      params[segment.name] = decodeURIComponent(part);
    }
  }
  return params;
}

export class Router {
  #routes = [];

  register(method, pattern, ...handlers) {
    if (handlers.length === 0) {
      throw new Error(`route ${method} ${pattern} needs at least one handler`);
    }
    this.#routes.push({ method: method.toUpperCase(), ...compilePattern(pattern), handlers });
    return this;
  }

  match(method, path) {
    for (const route of this.#routes) {
      if (route.method !== method) {
        continue;
      }
      const params = matchSegments(route, path);
      if (params !== null) {
        return { params, handlers: route.handlers };
      }
    }
    return null;
  }

  /** Methods that would match this path — used for 405 responses. */
  allowedMethods(path) {
    const methods = new Set();
    for (const route of this.#routes) {
      if (matchSegments(route, path) !== null) {
        methods.add(route.method);
      }
    }
    return [...methods].sort();
  }

  routeCount() {
    return this.#routes.length;
  }
}

/**
 * Adapt a Router into a middleware. On a match the route's own handler
 * chain is composed with foldPipeline, with the outer `next` as its
 * terminal — so a route handler that calls next() falls back through to
 * whatever comes after the router (typically the 404 terminal).
 */
export function routeDispatch(router) {
  return async (ctx, next) => {
    const matched = router.match(ctx.request.method, ctx.request.path);
    if (!matched) {
      const allowed = router.allowedMethods(ctx.request.path);
      if (allowed.length > 0) {
        throw new HttpError(405, `method not allowed; try ${allowed.join(', ')}`);
      }
      return next();
    }
    ctx.params = matched.params;
    const run = foldPipeline(matched.handlers, () => next());
    return run(ctx);
  };
}
