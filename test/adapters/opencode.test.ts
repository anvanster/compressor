import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createOpencodeAdapter,
  parseInstalledMode,
  renderOpencodePlugin,
} from '../../src/adapters/opencode.ts';
import { applyChanges } from '../../src/adapters/apply.ts';
import { markerBegin } from '../../src/packs/render.ts';
import type { Adapter, AdapterContext } from '../../src/adapters/types.ts';

// OpenCode adapter — compressor-OWNED plugin file, mirroring the cursor .mdc
// pattern: overwrite on install, delete on uninstall, mode from the header
// marker. The adapter accepts an injectable package root (default-parameter
// style, like paths.ts resolvers), so these tests fixture a fake
// dist/opencode-plugin.js instead of requiring a build.

const HOOK_COMMAND = 'node "/opt/compressor/dist/hook.js"';
const FAKE_BUNDLE = 'export const CompressorPlugin = async () => ({});\n';

interface Fixture {
  ctx: AdapterContext;
  adapter: Adapter;
  root: string;
}

async function makeFixture(global = false, bundle: string | null = FAKE_BUNDLE): Promise<Fixture> {
  const base = await mkdtemp(path.join(os.tmpdir(), 'compressor-opencode-'));
  const projectDir = path.join(base, 'project');
  const homeDir = path.join(base, 'home');
  const root = path.join(base, 'pkg');
  await mkdir(projectDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  if (bundle !== null) {
    await mkdir(path.join(root, 'dist'), { recursive: true });
    await writeFile(path.join(root, 'dist', 'opencode-plugin.js'), bundle, 'utf8');
  }
  return {
    ctx: { projectDir, homeDir, global, hookCommand: HOOK_COMMAND },
    adapter: createOpencodeAdapter(root),
    root,
  };
}

function projectPluginFile(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, '.opencode', 'plugins', 'compressor.js');
}

function globalPluginFile(ctx: AdapterContext): string {
  return path.join(ctx.homeDir, '.config', 'opencode', 'plugins', 'compressor.js');
}

test('install writes the owned file: mode marker + prologue + bundle body', async () => {
  const { ctx, adapter } = await makeFixture();
  await applyChanges(await adapter.install('slim', ctx));

  const body = await readFile(projectPluginFile(ctx), 'utf8');
  assert.equal(body, renderOpencodePlugin('slim', FAKE_BUNDLE));
  const lines = body.split('\n');
  assert.equal(lines[0], `// ${markerBegin('slim')}`, 'header: ownership + mode marker');
  assert.equal(lines[1], "const COMPRESSOR_MODE = 'slim';", 'prologue: module-scoped mode const');
  assert.ok(body.endsWith(FAKE_BUNDLE), 'bundle body verbatim after the prologue');
  assert.equal(parseInstalledMode(body), 'slim');

  // idempotent
  assert.deepEqual(await adapter.install('slim', ctx), []);

  // mode switch rewrites the owned file in place
  await applyChanges(await adapter.install('optimized', ctx));
  const switched = await readFile(projectPluginFile(ctx), 'utf8');
  assert.equal(switched, renderOpencodePlugin('optimized', FAKE_BUNDLE));
  assert.equal(parseInstalledMode(switched), 'optimized');
});

test('missing bundle: install refuses with the run-npm-run-build error', async () => {
  const { ctx, adapter } = await makeFixture(false, null);
  await assert.rejects(
    adapter.install('slim', ctx),
    /opencode plugin bundle missing at .* — run 'npm run build' in the compressor package, then re-run/,
  );
  assert.ok(!existsSync(projectPluginFile(ctx)), 'nothing written');
});

test('uninstall deletes the owned file and prunes empty plugins/.opencode dirs', async () => {
  const { ctx, adapter } = await makeFixture();
  await applyChanges(await adapter.install('slim', ctx));
  assert.ok(existsSync(projectPluginFile(ctx)));

  await applyChanges(await adapter.uninstall(ctx));
  assert.ok(!existsSync(projectPluginFile(ctx)), 'plugin deleted');
  assert.ok(
    !existsSync(path.join(ctx.projectDir, '.opencode')),
    'empty .opencode pruned (would flip detect() true forever)',
  );

  // idempotent: nothing left to remove
  assert.deepEqual(await adapter.uninstall(ctx), []);
});

test('uninstall keeps plugins/ when a foreign plugin file lives there', async () => {
  const { ctx, adapter } = await makeFixture();
  await applyChanges(await adapter.install('slim', ctx));
  const foreign = path.join(ctx.projectDir, '.opencode', 'plugins', 'my-plugin.js');
  await writeFile(foreign, 'export const Mine = async () => ({});\n', 'utf8');

  await applyChanges(await adapter.uninstall(ctx));
  assert.ok(!existsSync(projectPluginFile(ctx)), 'our file deleted');
  assert.ok(existsSync(foreign), 'foreign plugin untouched');
  assert.ok(existsSync(path.join(ctx.projectDir, '.opencode', 'plugins')), 'dir kept');
});

test('status: mode from the header marker + honesty note', async () => {
  const { ctx, adapter } = await makeFixture();
  const before = await adapter.status(ctx);
  assert.equal(before.installed, false);
  assert.equal(before.detail, 'not installed');

  await applyChanges(await adapter.install('optimized', ctx));
  const status = await adapter.status(ctx);
  assert.equal(status.agent, 'opencode');
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'optimized');
  assert.match(status.detail, /\.opencode\/plugins\/compressor\.js \(project\)/);
  assert.match(status.detail, /compression plugin/);
  // honesty: instructions are NOT this adapter's job, and the plugin format
  // is doc-verified only
  assert.match(
    status.detail,
    /instructions come from AGENTS\.md \(OpenCode reads it natively; run init --agent agents-md\)/,
  );
  assert.match(
    status.detail,
    /plugin format doc-verified 2026-06-12, not yet live-verified against an OpenCode install/,
  );
  assert.doesNotMatch(status.detail, /locally modified/);
});

test('status flags a hand-edited plugin file as locally modified', async () => {
  const { ctx, adapter } = await makeFixture();
  await applyChanges(await adapter.install('slim', ctx));

  // hand edit that keeps the header intact: mode still parsed, drift flagged
  await writeFile(
    projectPluginFile(ctx),
    `${renderOpencodePlugin('slim', FAKE_BUNDLE)}// my extra line\n`,
    'utf8',
  );
  const modified = await adapter.status(ctx);
  assert.equal(modified.installed, true);
  assert.equal(modified.mode, 'slim');
  assert.match(modified.detail, /locally modified — install will overwrite/);

  // hand edit that destroys the header: drift still reported, mode unknown
  await writeFile(projectPluginFile(ctx), 'export const Hacked = async () => ({});\n', 'utf8');
  const broken = await adapter.status(ctx);
  assert.equal(broken.installed, true);
  assert.equal(broken.mode, undefined);
  assert.match(broken.detail, /locally modified — install will overwrite/);
});

test('parseInstalledMode reads only the header line, never the body', () => {
  // a marker-like string deeper in the file (e.g. inside the bundled engine)
  // must not masquerade as the install marker
  const decoy = `// some comment\nconst x = "${markerBegin('slim')}";\n`;
  assert.equal(parseInstalledMode(decoy), undefined);
  assert.equal(parseInstalledMode(renderOpencodePlugin('slim', FAKE_BUNDLE)), 'slim');
});

test('global scope uses ~/.config/opencode/plugins (XDG path, not ~/.opencode)', async () => {
  const { ctx, adapter } = await makeFixture(true);
  await applyChanges(await adapter.install('slim', ctx));

  const file = globalPluginFile(ctx);
  assert.ok(existsSync(file), 'plugin under <home>/.config/opencode/plugins/');
  assert.ok(
    !existsSync(path.join(ctx.homeDir, '.opencode')),
    'nothing under ~/.opencode at global scope',
  );
  assert.equal(parseInstalledMode(await readFile(file, 'utf8')), 'slim');

  const status = await adapter.status(ctx);
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'slim');
  assert.match(status.detail, /~\/\.config\/opencode\/plugins\/compressor\.js \(global\)/);

  // uninstall deletes + prunes the empty chain up to .config
  await applyChanges(await adapter.uninstall(ctx));
  assert.ok(!existsSync(file));
  assert.ok(
    !existsSync(path.join(ctx.homeDir, '.config', 'opencode')),
    'empty opencode config dir pruned',
  );
});

test('project status reports a global-only install (cross-scope note)', async () => {
  const { ctx, adapter } = await makeFixture(true);
  await applyChanges(await adapter.install('optimized', ctx));

  const projectCtx: AdapterContext = { ...ctx, global: false };
  const status = await adapter.status(projectCtx);
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'optimized');
  assert.match(status.detail, /not installed \(project\); installed globally/);
});

test('detect: .opencode dir or opencode.json (project); ~/.config/opencode (global)', async () => {
  const { ctx, adapter } = await makeFixture();
  assert.equal(await adapter.detect(ctx), false);

  await mkdir(path.join(ctx.projectDir, '.opencode'), { recursive: true });
  assert.equal(await adapter.detect(ctx), true);

  const viaConfig = await makeFixture();
  await writeFile(path.join(viaConfig.ctx.projectDir, 'opencode.json'), '{}\n', 'utf8');
  assert.equal(await viaConfig.adapter.detect(viaConfig.ctx), true);

  const globalFx = await makeFixture(true);
  assert.equal(await globalFx.adapter.detect(globalFx.ctx), false);
  await mkdir(path.join(globalFx.ctx.homeDir, '.config', 'opencode'), { recursive: true });
  assert.equal(await globalFx.adapter.detect(globalFx.ctx), true);
});
