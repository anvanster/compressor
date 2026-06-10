import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeCodeAdapter } from '../../src/adapters/claude-code.ts';
import { applyChanges } from '../../src/adapters/apply.ts';
import { renderOutputStyle } from '../../src/packs/render.ts';
import type { AdapterContext } from '../../src/adapters/types.ts';

const HOOK_COMMAND = 'node /opt/compressor/dist/hook.js';

async function makeCtx(global = false): Promise<AdapterContext> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-adapter-'));
  const projectDir = path.join(root, 'project');
  const homeDir = path.join(root, 'home');
  await mkdir(projectDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  return { projectDir, homeDir, global, hookCommand: HOOK_COMMAND };
}

function settingsFile(ctx: AdapterContext): string {
  const root = ctx.global ? ctx.homeDir : ctx.projectDir;
  return path.join(root, '.claude', 'settings.json');
}

function localSettingsFile(ctx: AdapterContext): string {
  const root = ctx.global ? ctx.homeDir : ctx.projectDir;
  return path.join(root, '.claude', 'settings.local.json');
}

function styleFile(ctx: AdapterContext, mode: string): string {
  const root = ctx.global ? ctx.homeDir : ctx.projectDir;
  return path.join(root, '.claude', 'output-styles', `compressor-${mode}.md`);
}

const foreignPostEntry = {
  matcher: 'Write',
  hooks: [{ type: 'command', command: '/usr/local/bin/format-on-write' }],
};

const seedSettings = {
  permissions: { allow: ['Bash(ls:*)'] },
  hooks: {
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] },
    ],
    PostToolUse: [foreignPostEntry],
  },
};

const ourEntry = {
  matcher: 'Read|Bash|Grep|Glob',
  hooks: [{ type: 'command', command: HOOK_COMMAND }],
};

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

test('full round-trip preserves foreign settings, indent, and is idempotent', async () => {
  const ctx = await makeCtx();
  const seeded = `${JSON.stringify(seedSettings, null, 4)}\n`;
  await mkdir(path.dirname(settingsFile(ctx)), { recursive: true });
  await writeFile(settingsFile(ctx), seeded, 'utf8');

  await applyChanges(await claudeCodeAdapter.install('slim', ctx));

  const slimBody = await readFile(styleFile(ctx, 'slim'), 'utf8');
  assert.equal(slimBody, renderOutputStyle('slim').body);
  assert.ok(slimBody.includes('keep-coding-instructions: true'));

  // the machine-specific hook command lands in settings.local.json, never the
  // shared settings.json
  const afterInstall = await readFile(settingsFile(ctx), 'utf8');
  assert.deepEqual(JSON.parse(afterInstall), {
    permissions: seedSettings.permissions,
    hooks: {
      PreToolUse: seedSettings.hooks.PreToolUse,
      PostToolUse: [foreignPostEntry],
    },
    outputStyle: 'compressor-slim',
  });
  assert.match(afterInstall, /\n {4}"/);
  assert.ok(!afterInstall.includes(HOOK_COMMAND));
  assert.deepEqual(await readJson(localSettingsFile(ctx)), {
    hooks: { PostToolUse: [ourEntry] },
  });

  await applyChanges(await claudeCodeAdapter.install('optimized', ctx));

  assert.ok(!existsSync(styleFile(ctx, 'slim')));
  assert.ok(existsSync(styleFile(ctx, 'optimized')));
  const afterSwitch = await readJson(settingsFile(ctx));
  assert.deepEqual(afterSwitch, {
    permissions: seedSettings.permissions,
    hooks: {
      PreToolUse: seedSettings.hooks.PreToolUse,
      PostToolUse: [foreignPostEntry],
    },
    outputStyle: 'compressor-optimized',
  });
  assert.deepEqual(await readJson(localSettingsFile(ctx)), {
    hooks: { PostToolUse: [ourEntry] },
  });

  const status = await claudeCodeAdapter.status(ctx);
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'optimized');
  assert.match(status.detail, /output style \(optimized\)/);
  assert.match(status.detail, /hook installed/);
  assert.match(status.detail, /\(project\)/);

  await applyChanges(await claudeCodeAdapter.uninstall(ctx));

  assert.ok(!existsSync(styleFile(ctx, 'slim')));
  assert.ok(!existsSync(styleFile(ctx, 'optimized')));
  assert.ok(!existsSync(localSettingsFile(ctx)));
  const afterUninstall = await readFile(settingsFile(ctx), 'utf8');
  assert.deepEqual(JSON.parse(afterUninstall), seedSettings);
  assert.match(afterUninstall, /\n {4}"/);

  const statusAfter = await claudeCodeAdapter.status(ctx);
  assert.equal(statusAfter.installed, false);
  assert.equal(statusAfter.detail, 'not installed');
});

test('install on missing settings creates it; uninstall deletes our-only settings', async () => {
  const ctx = await makeCtx();

  await applyChanges(await claudeCodeAdapter.install('slim', ctx));

  const written = await readFile(settingsFile(ctx), 'utf8');
  assert.deepEqual(JSON.parse(written), { outputStyle: 'compressor-slim' });
  assert.match(written, /\n {2}"/);
  assert.deepEqual(JSON.parse(await readFile(localSettingsFile(ctx), 'utf8')), {
    hooks: { PostToolUse: [ourEntry] },
  });

  const changes = await claudeCodeAdapter.uninstall(ctx);
  const settingsChange = changes.find((c) => c.path === settingsFile(ctx));
  assert.ok(settingsChange);
  assert.equal(settingsChange.after, null);
  const localChange = changes.find((c) => c.path === localSettingsFile(ctx));
  assert.ok(localChange);
  assert.equal(localChange.after, null);

  await applyChanges(changes);
  assert.ok(!existsSync(settingsFile(ctx)));
  assert.ok(!existsSync(localSettingsFile(ctx)));
  assert.ok(!existsSync(styleFile(ctx, 'slim')));
});

test('re-install of the same mode plans no changes (idempotent)', async () => {
  const ctx = await makeCtx();
  await applyChanges(await claudeCodeAdapter.install('slim', ctx));
  const again = await claudeCodeAdapter.install('slim', ctx);
  assert.deepEqual(again, []);
});

test('install throws on invalid settings JSON without planning changes', async () => {
  const ctx = await makeCtx();
  await mkdir(path.dirname(settingsFile(ctx)), { recursive: true });
  await writeFile(settingsFile(ctx), '{ not json', 'utf8');
  await assert.rejects(
    claudeCodeAdapter.install('slim', ctx),
    /not touching/,
  );
});

test('global install writes under homeDir and status is scope-faithful', async () => {
  const ctx = await makeCtx(true);
  await applyChanges(await claudeCodeAdapter.install('optimized', ctx));

  assert.ok(existsSync(path.join(ctx.homeDir, '.claude', 'output-styles', 'compressor-optimized.md')));
  assert.ok(!existsSync(path.join(ctx.projectDir, '.claude')));

  const status = await claudeCodeAdapter.status(ctx);
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'optimized');
  assert.match(status.detail, /\(global\)/);

  const projectCtx: AdapterContext = { ...ctx, global: false };
  const projectStatus = await claudeCodeAdapter.status(projectCtx);
  assert.equal(projectStatus.installed, true);
  assert.equal(projectStatus.mode, 'optimized');
  assert.match(projectStatus.detail, /globally/);

  // scope-faithful uninstall: project ctx must not touch global artifacts
  await applyChanges(await claudeCodeAdapter.uninstall(projectCtx));
  assert.ok(existsSync(path.join(ctx.homeDir, '.claude', 'output-styles', 'compressor-optimized.md')));
});

test('foreign outputStyle is stashed on install and restored on uninstall', async () => {
  const ctx = await makeCtx();
  const seeded = `${JSON.stringify({ outputStyle: 'Explanatory' }, null, 2)}\n`;
  await mkdir(path.dirname(settingsFile(ctx)), { recursive: true });
  await writeFile(settingsFile(ctx), seeded, 'utf8');

  await applyChanges(await claudeCodeAdapter.install('slim', ctx));
  assert.deepEqual(await readJson(settingsFile(ctx)), {
    outputStyle: 'compressor-slim',
  });
  const styleBody = await readFile(styleFile(ctx, 'slim'), 'utf8');
  assert.ok(styleBody.startsWith(renderOutputStyle('slim').body));
  assert.ok(styleBody.includes('compressor:prior-output-style "Explanatory"'));

  // the stash survives a mode switch
  await applyChanges(await claudeCodeAdapter.install('optimized', ctx));
  const switched = await readFile(styleFile(ctx, 'optimized'), 'utf8');
  assert.ok(switched.includes('compressor:prior-output-style "Explanatory"'));

  await applyChanges(await claudeCodeAdapter.uninstall(ctx));
  assert.deepEqual(await readJson(settingsFile(ctx)), {
    outputStyle: 'Explanatory',
  });
});

test('foreign outputStyle install is idempotent (re-install plans no changes)', async () => {
  const ctx = await makeCtx();
  await mkdir(path.dirname(settingsFile(ctx)), { recursive: true });
  await writeFile(
    settingsFile(ctx),
    `${JSON.stringify({ outputStyle: 'Explanatory' }, null, 2)}\n`,
    'utf8',
  );
  await applyChanges(await claudeCodeAdapter.install('slim', ctx));
  assert.deepEqual(await claudeCodeAdapter.install('slim', ctx), []);
});

test("another tool's dist/hook.js entry is never claimed, replaced, or removed", async () => {
  const ctx = await makeCtx();
  const otherToolEntry = {
    matcher: 'Write',
    hooks: [
      { type: 'command', command: 'node /Users/me/tools/other-guard/dist/hook.js' },
    ],
  };
  const seed = {
    outputStyle: 'compressor-mystyle',
    hooks: { PostToolUse: [otherToolEntry] },
  };
  const seeded = `${JSON.stringify(seed, null, 2)}\n`;
  await mkdir(path.dirname(settingsFile(ctx)), { recursive: true });
  await writeFile(settingsFile(ctx), seeded, 'utf8');

  await applyChanges(await claudeCodeAdapter.install('slim', ctx));
  assert.deepEqual(await readJson(settingsFile(ctx)), {
    outputStyle: 'compressor-slim',
    hooks: { PostToolUse: [otherToolEntry] },
  });
  assert.deepEqual(await readJson(localSettingsFile(ctx)), {
    hooks: { PostToolUse: [ourEntry] },
  });

  // uninstall must not delete the user's settings.json or the foreign hook;
  // the user-created 'compressor-mystyle' value is not restorable, but the
  // foreign entry keeps the file alive
  await applyChanges(await claudeCodeAdapter.uninstall(ctx));
  assert.ok(existsSync(settingsFile(ctx)));
  assert.deepEqual(await readJson(settingsFile(ctx)), {
    hooks: { PostToolUse: [otherToolEntry] },
  });
  assert.ok(!existsSync(localSettingsFile(ctx)));
});

test('mode switch replaces our hook entry matched across --mode values', async () => {
  const base = 'node /opt/compressor/dist/hook.js';
  const slimCtx = { ...(await makeCtx()), hookCommand: `${base} --mode slim` };
  await applyChanges(await claudeCodeAdapter.install('slim', slimCtx));

  const optimizedCtx = { ...slimCtx, hookCommand: `${base} --mode optimized` };
  await applyChanges(await claudeCodeAdapter.install('optimized', optimizedCtx));

  assert.deepEqual(await readJson(localSettingsFile(optimizedCtx)), {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Read|Bash|Grep|Glob',
          hooks: [{ type: 'command', command: `${base} --mode optimized` }],
        },
      ],
    },
  });

  await applyChanges(await claudeCodeAdapter.uninstall({ ...slimCtx, hookCommand: `${base} --mode optimized` }));
  assert.ok(!existsSync(localSettingsFile(slimCtx)));
});

test('detect: project scope always true; global scope requires a .claude dir', async () => {
  const ctx = await makeCtx();
  assert.equal(await claudeCodeAdapter.detect(ctx), true);

  const globalCtx: AdapterContext = { ...ctx, global: true };
  assert.equal(await claudeCodeAdapter.detect(globalCtx), false);

  await mkdir(path.join(ctx.homeDir, '.claude'), { recursive: true });
  assert.equal(await claudeCodeAdapter.detect(globalCtx), true);
});
