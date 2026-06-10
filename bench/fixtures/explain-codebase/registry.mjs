export class PluginRegistry {
  #plugins = [];

  add(plugin) {
    if (plugin === null || typeof plugin !== 'object' || typeof plugin.name !== 'string') {
      throw new TypeError('a plugin is an object with a string name');
    }
    this.#plugins.push(plugin);
    this.#plugins.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  names() {
    return this.#plugins.map((plugin) => plugin.name);
  }

  runPhase(phase, envelope) {
    for (const plugin of this.#plugins) {
      const hook = plugin[phase];
      if (typeof hook !== 'function') {
        continue;
      }
      hook.call(plugin, envelope);
      if (envelope.cancelled) {
        return;
      }
    }
  }
}
