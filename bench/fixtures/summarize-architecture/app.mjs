import { foldPipeline } from './pipeline.mjs';
import { createContext } from './context.mjs';
import { errorBoundary } from './errors.mjs';
import { finalizeResponse, notFound } from './respond.mjs';
import { Router, routeDispatch } from './router.mjs';

export class Application {
  #middlewares = [];
  #router = new Router();
  #pipeline = null;

  use(middleware) {
    this.#middlewares.push(middleware);
    this.#pipeline = null;
    return this;
  }

  get(pattern, ...handlers) {
    this.#router.register('GET', pattern, ...handlers);
    this.#pipeline = null;
    return this;
  }

  post(pattern, ...handlers) {
    this.#router.register('POST', pattern, ...handlers);
    this.#pipeline = null;
    return this;
  }

  put(pattern, ...handlers) {
    this.#router.register('PUT', pattern, ...handlers);
    this.#pipeline = null;
    return this;
  }

  del(pattern, ...handlers) {
    this.#router.register('DELETE', pattern, ...handlers);
    this.#pipeline = null;
    return this;
  }

  /**
   * The composed chain is built lazily and memoized: error boundary first
   * (outermost layer), then app middleware in registration order, then the
   * router adapter; the terminal renders a 404 for anything that fell all
   * the way through. Registering middleware or routes invalidates the memo.
   */
  #compose() {
    if (this.#pipeline === null) {
      this.#pipeline = foldPipeline(
        [errorBoundary(), ...this.#middlewares, routeDispatch(this.#router)],
        (ctx) => notFound(ctx),
      );
    }
    return this.#pipeline;
  }

  async handle(rawRequest) {
    const ctx = createContext(rawRequest);
    const run = this.#compose();
    await run(ctx);
    return finalizeResponse(ctx);
  }

  routeCount() {
    return this.#router.routeCount();
  }
}

export function createApp() {
  return new Application();
}
