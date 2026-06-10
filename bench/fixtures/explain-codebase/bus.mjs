import { PluginRegistry } from './registry.mjs';

export class EventBus {
  #handlers = new Map();
  #plugins = new PluginRegistry();

  use(plugin) {
    this.#plugins.add(plugin);
    return this;
  }

  on(eventName, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('handler must be a function');
    }
    const list = this.#handlers.get(eventName) ?? [];
    list.push(handler);
    this.#handlers.set(eventName, list);
    return this;
  }

  emit(eventName, payload) {
    const envelope = { eventName, payload, cancelled: false };
    this.#plugins.runPhase('beforeDispatch', envelope);
    if (envelope.cancelled) {
      this.#plugins.runPhase('afterDispatch', envelope);
      return { delivered: 0, cancelled: true };
    }
    const handlers = this.#handlers.get(envelope.eventName) ?? [];
    for (const handler of handlers) {
      handler(envelope.payload, envelope.eventName);
    }
    this.#plugins.runPhase('afterDispatch', envelope);
    return { delivered: handlers.length, cancelled: false };
  }
}
