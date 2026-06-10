import { createApp } from './app.mjs';
import { requestLog } from './logger.mjs';
import { jsonBodyParser } from './bodyparser.mjs';
import { staticAssets } from './static.mjs';
import { HttpError } from './errors.mjs';
import { json, text } from './respond.mjs';

const USERS = new Map([
  ['1', { id: '1', name: 'Ada' }],
  ['2', { id: '2', name: 'Grace' }],
]);

const logSink = [];

const app = createApp()
  .use(requestLog(logSink))
  .use(jsonBodyParser({ limitBytes: 1024 }))
  .use(
    staticAssets('/assets/', {
      'site.css': 'body { margin: 0; }',
      'app.js': 'console.log("hi");',
    }),
  );

app.get('/health', (ctx) => {
  text(ctx, 200, 'ok');
});

app.get('/users/:id', (ctx, next) => {
  const user = USERS.get(ctx.params.id);
  if (!user) {
    return next();
  }
  json(ctx, 200, user);
});

app.post('/users', (ctx) => {
  if (!ctx.request.body || typeof ctx.request.body.name !== 'string') {
    throw new HttpError(400, 'body must include a string name');
  }
  json(ctx, 201, { id: 'new', name: ctx.request.body.name });
});

app.get('/teapot', () => {
  throw new HttpError(418, 'short and stout');
});

app.get('/crash', () => {
  throw new Error('secret stack detail');
});

const requests = [
  { method: 'GET', url: '/health' },
  { method: 'GET', url: '/users/2' },
  { method: 'GET', url: '/users/99' },
  { method: 'GET', url: '/assets/site.css' },
  {
    method: 'POST',
    url: '/users',
    headers: { 'Content-Type': 'application/json' },
    body: '{"name":"Linus"}',
  },
  {
    method: 'POST',
    url: '/users',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  },
  { method: 'POST', url: '/health' },
  { method: 'GET', url: '/teapot' },
  { method: 'GET', url: '/crash' },
];

for (const request of requests) {
  const response = await app.handle(request);
  console.log(`${request.method} ${request.url} -> ${response.status} ${response.body}`);
}

console.log(`routes registered: ${app.routeCount()}`);
console.log(`log entries: ${logSink.length}`);
