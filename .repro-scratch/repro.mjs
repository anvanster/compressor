import { copilotAdapter } from '../src/adapters/copilot.ts';

const ctx = {
  projectDir: new URL('.', import.meta.url).pathname,
  homeDir: '/nonexistent-home',
  global: false,
  hookCommand: 'node "/opt/compressor/dist/hook.js"',
};

const changes = await copilotAdapter.install('optimized', ctx);
for (const c of changes) {
  if (c.path.endsWith('compressor.json')) {
    console.log('--- BEFORE ---');
    console.log(c.before);
    console.log('--- AFTER ---');
    console.log(c.after);
  }
}
