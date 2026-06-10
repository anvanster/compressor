import { EventBus } from './bus.mjs';
import { auditPlugin, redactPlugin, throttlePlugin } from './plugins.mjs';

export function buildApp() {
  const trail = [];
  const inbox = [];

  const bus = new EventBus()
    .use(throttlePlugin(100))
    .use(auditPlugin(trail))
    .use(redactPlugin(['password', 'token']));

  bus.on('user.login', (payload) => {
    inbox.push({ kind: 'login', user: payload.user });
  });
  bus.on('user.login', (payload) => {
    inbox.push({ kind: 'session', token: payload.token });
  });
  bus.on('user.logout', (payload) => {
    inbox.push({ kind: 'logout', user: payload.user });
  });

  return { bus, trail, inbox };
}
