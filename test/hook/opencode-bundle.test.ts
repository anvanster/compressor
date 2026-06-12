import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderOpencodePlugin } from '../../src/adapters/opencode.ts';

// Built-bundle smoke test for dist/opencode-plugin.js — the closest thing to
// live verification available without an OpenCode install: import the real
// bundle (and the adapter-emitted prologue+bundle file) in-process,
// instantiate per the documented plugin format
// (https://opencode.ai/docs/plugins/, fetched 2026-06-12):
//
//   export const MyPlugin = async ({ project, client, $, directory, worktree }) => {
//     return { /* hooks */ }
//   }
//
// and run a compressible payload through tool.execute.after. NOT verified
// here: OpenCode's actual loader behavior at runtime (marked honestly in the
// adapter's status note). Skips when dist/ is absent — `npm run build` first.

const BUNDLE = fileURLToPath(new URL('../../dist/opencode-plugin.js', import.meta.url));

const skipUnbuilt = !existsSync(BUNDLE)
  ? 'dist/opencode-plugin.js missing — run `npm run build` first'
  : false;

// hermetic: never write the developer's real ledger or recovery state
process.env['COMPRESSOR_NO_LEDGER'] = '1';

interface OcHooks {
  'tool.execute.after'?: (input: unknown, output: unknown) => Promise<void>;
}

type OcPlugin = (ctx?: unknown) => Promise<OcHooks>;

interface BundleModule {
  CompressorPlugin: OcPlugin;
  createCompressorPlugin: (mode: unknown) => OcPlugin;
}

function rows(lines: number): string {
  return Array.from(
    { length: lines },
    (_, i) => `row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur adipiscing`,
  ).join('\n');
}

async function runCompressible(plugin: OcPlugin): Promise<{ before: string; after: string }> {
  // documented plugin context shape (client/$ omitted: the plugin must not need them)
  const hooks = await plugin({ project: {}, directory: '/tmp', worktree: '/tmp' });
  const hook = hooks['tool.execute.after'];
  assert.ok(typeof hook === 'function', 'hooks object carries tool.execute.after');
  const before = rows(600);
  const output = { title: 'bash', output: before, metadata: {} };
  await hook(
    { tool: 'bash', sessionID: 'smoke-sess', callID: 'call_1', args: { command: 'make noise' } },
    output,
  );
  return { before, after: output.output };
}

test('raw bundle: every export is a function (loader throws on anything else)', { skip: skipUnbuilt }, async () => {
  const mod: Record<string, unknown> = await import(pathToFileURL(BUNDLE).href);
  const names = Object.keys(mod).filter((k) => k !== 'default');
  assert.ok(names.includes('CompressorPlugin'));
  assert.ok(names.includes('createCompressorPlugin'));
  for (const name of names) {
    // sst/opencode getLegacyPlugins: non-function exports throw
    // TypeError("Plugin export is not a function") and kill plugin loading
    assert.equal(typeof mod[name], 'function', `export ${name} must be a function`);
  }
});

test('raw bundle (no prologue): default plugin works with the default mode', { skip: skipUnbuilt }, async () => {
  const mod = (await import(pathToFileURL(BUNDLE).href)) as unknown as BundleModule;
  const { before, after } = await runCompressible(mod.CompressorPlugin);
  assert.notEqual(after, before, 'output.output mutated');
  assert.ok(after.length < before.length);
  assert.ok(after.includes('[compressor:'), 'omission marker present');
});

test('adapter-emitted file (prologue + bundle): COMPRESSOR_MODE const is read and the hook compresses', { skip: skipUnbuilt }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-opencode-emitted-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // exactly what the adapter installs: header marker + mode const + bundle
  const emitted = renderOpencodePlugin('slim', await readFile(BUNDLE, 'utf8'));
  const file = path.join(dir, 'compressor.mjs'); // .mjs so node imports it as ESM
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, emitted, 'utf8');

  const mod = (await import(pathToFileURL(file).href)) as unknown as BundleModule;
  const { before, after } = await runCompressible(mod.CompressorPlugin);
  assert.notEqual(after, before, 'emitted file compresses (prologue did not break the module)');
  assert.ok(after.includes('[compressor:'), 'omission marker present');

  // the factory export stays usable from the emitted file too
  const { after: viaFactory } = await runCompressible(mod.createCompressorPlugin('slim'));
  assert.ok(viaFactory.includes('[compressor:'));
});

test('prologue const is genuinely read: mode full suppresses what the default would compress', { skip: skipUnbuilt }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-opencode-fullmode-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // differential proof: with no prologue the default ('optimized') compresses
  // this payload (previous test); a 'full' prologue must turn it off — so the
  // const, not the fallback, decided the mode. (The adapter never emits
  // 'full' — install of mode full is an uninstall — this is mechanism proof.)
  const bundle = await readFile(BUNDLE, 'utf8');
  const emitted = `const COMPRESSOR_MODE = 'full';\n${bundle}`;
  const file = path.join(dir, 'compressor-full.mjs');
  await writeFile(file, emitted, 'utf8');

  const mod = (await import(pathToFileURL(file).href)) as unknown as BundleModule;
  const hooks = await mod.CompressorPlugin({ project: {}, directory: '/tmp', worktree: '/tmp' });
  const hook = hooks['tool.execute.after'];
  assert.ok(typeof hook === 'function');
  const before = rows(600);
  const output = { title: 'bash', output: before, metadata: {} };
  await hook(
    { tool: 'bash', sessionID: 'full-sess', callID: 'call_1', args: { command: 'noise' } },
    output,
  );
  assert.equal(output.output, before, 'mode=full prologue: untouched');
});
