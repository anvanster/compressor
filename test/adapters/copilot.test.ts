import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copilotAdapter } from '../../src/adapters/copilot.ts';
import { applyChanges } from '../../src/adapters/apply.ts';
import {
  MARKER_BEGIN_PREFIX,
  parseAtomManifest,
  renderMarkedSection,
} from '../../src/packs/render.ts';
import type { AdapterContext } from '../../src/adapters/types.ts';

const HOOK_COMMAND = 'node "/opt/compressor/dist/hook.js"';

async function makeCtx(global = false): Promise<AdapterContext> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-adapter-'));
  const projectDir = path.join(root, 'project');
  const homeDir = path.join(root, 'home');
  await mkdir(projectDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  return { projectDir, homeDir, global, hookCommand: HOOK_COMMAND };
}

function instructionsFile(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, '.github', 'copilot-instructions.md');
}

function hookConfigFile(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, '.github', 'hooks', 'compressor.json');
}

const OUR_COPILOT_COMMAND_BASE = 'node "/opt/compressor/dist/copilot-hook.js"';

interface HookConfig {
  version: number;
  hooks: Record<string, Array<Record<string, unknown>>>;
}

async function readHookConfig(ctx: AdapterContext): Promise<HookConfig> {
  return JSON.parse(await readFile(hookConfigFile(ctx), 'utf8')) as HookConfig;
}

function agentsMdFile(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, 'AGENTS.md');
}

function markerCount(text: string): number {
  return text.split(MARKER_BEGIN_PREFIX).length - 1;
}

test('install into empty project creates file with only our section; uninstall truncates it', async () => {
  const ctx = await makeCtx();
  await applyChanges(await copilotAdapter.install('slim', ctx));

  const body = await readFile(instructionsFile(ctx), 'utf8');
  assert.equal(body, `${renderMarkedSection('slim', 'copilot').body}\n`);
  assert.equal(parseAtomManifest(body)?.mode, 'slim');

  // idempotent: planning the same install again yields no changes
  assert.deepEqual(await copilotAdapter.install('slim', ctx), []);

  // never delete: creation is not derivable from disk, so err KEEP
  await applyChanges(await copilotAdapter.uninstall(ctx));
  assert.ok(existsSync(instructionsFile(ctx)));
  assert.equal(await readFile(instructionsFile(ctx), 'utf8'), '');
});

test('foreign content above and below our section is byte-preserved across switch + uninstall', async () => {
  const ctx = await makeCtx();
  const original = '# Team instructions\n\nUse pnpm, not npm.\n';
  await mkdir(path.dirname(instructionsFile(ctx)), { recursive: true });
  await writeFile(instructionsFile(ctx), original, 'utf8');

  await applyChanges(await copilotAdapter.install('slim', ctx));
  const afterInstall = await readFile(instructionsFile(ctx), 'utf8');
  assert.equal(
    afterInstall,
    `# Team instructions\n\nUse pnpm, not npm.\n\n${renderMarkedSection('slim', 'copilot').body}\n`,
  );

  // user appends content BELOW our section
  const below = '\n## Later notes\nadded after install\n';
  await writeFile(instructionsFile(ctx), `${afterInstall}${below}`, 'utf8');

  // mode switch replaces the section in place — no duplicates, foreign bytes intact
  await applyChanges(await copilotAdapter.install('optimized', ctx));
  const switched = await readFile(instructionsFile(ctx), 'utf8');
  assert.equal(
    switched,
    `# Team instructions\n\nUse pnpm, not npm.\n\n${renderMarkedSection('optimized', 'copilot').body}\n\n## Later notes\nadded after install\n`,
  );
  assert.equal(markerCount(switched), 1);
  assert.equal(parseAtomManifest(switched)?.mode, 'optimized');

  // uninstall keeps the file (foreign content) and restores foreign bytes exactly
  await applyChanges(await copilotAdapter.uninstall(ctx));
  const final = await readFile(instructionsFile(ctx), 'utf8');
  assert.equal(
    final,
    '# Team instructions\n\nUse pnpm, not npm.\n\n## Later notes\nadded after install\n',
  );
});

test('uninstall round-trips byte-equal to the pre-install original', async () => {
  const ctx = await makeCtx();
  const original = '# Ours\n\nsome user text\n';
  await mkdir(path.dirname(instructionsFile(ctx)), { recursive: true });
  await writeFile(instructionsFile(ctx), original, 'utf8');

  await applyChanges(await copilotAdapter.install('optimized', ctx));
  await applyChanges(await copilotAdapter.uninstall(ctx));
  assert.equal(await readFile(instructionsFile(ctx), 'utf8'), original);

  // uninstall with nothing of ours present plans no changes
  assert.deepEqual(await copilotAdapter.uninstall(ctx), []);
});

test('status reports installed + mode + hook surfaces note + AGENTS.md overlap', async () => {
  const ctx = await makeCtx();
  const before = await copilotAdapter.status(ctx);
  assert.equal(before.installed, false);
  assert.equal(before.detail, 'not installed');

  await applyChanges(await copilotAdapter.install('optimized', ctx));
  const status = await copilotAdapter.status(ctx);
  assert.equal(status.agent, 'copilot');
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'optimized');
  // the compression hook is ported: install plans both the instruction
  // section and the .github/hooks/compressor.json postToolUse entry
  assert.match(status.detail, /instructions \+ input compression \(Copilot hooks\)/);
  // honesty about surfaces: the installed command is an absolute local path,
  // so compression works only in Copilot CLI on this machine — the status
  // string must never imply a cloud-agent benefit
  assert.match(status.detail, /effective in Copilot CLI on this machine only/);
  assert.doesNotMatch(status.detail, /CLI \+ cloud agent only/);
  assert.doesNotMatch(status.detail, /has no hook mechanism/);
  assert.doesNotMatch(status.detail, /not yet ported/);
  assert.doesNotMatch(status.detail, /also reads AGENTS\.md/);

  // AGENTS.md also carrying our section ⇒ duplication warning
  await writeFile(
    agentsMdFile(ctx),
    `${renderMarkedSection('optimized', 'agents-md').body}\n`,
    'utf8',
  );
  const overlapped = await copilotAdapter.status(ctx);
  assert.match(
    overlapped.detail,
    /NOTE: Copilot also reads AGENTS\.md — both installed means duplicated instructions/,
  );
});

test('uninstall keeps a user-created empty file instead of deleting it', async () => {
  const ctx = await makeCtx();
  // user-created placeholder (possibly git-tracked) — indistinguishable on
  // disk from a file we created, so uninstall must err KEEP
  await mkdir(path.dirname(instructionsFile(ctx)), { recursive: true });
  await writeFile(instructionsFile(ctx), '', 'utf8');

  await applyChanges(await copilotAdapter.install('slim', ctx));
  await applyChanges(await copilotAdapter.uninstall(ctx));
  assert.ok(
    existsSync(instructionsFile(ctx)),
    'user placeholder must survive uninstall',
  );
  assert.equal(await readFile(instructionsFile(ctx), 'utf8'), '');
});

test('uninstall round-trips a whitespace-only user file byte-for-byte', async () => {
  const ctx = await makeCtx();
  await mkdir(path.dirname(instructionsFile(ctx)), { recursive: true });
  await writeFile(instructionsFile(ctx), ' \n', 'utf8');

  await applyChanges(await copilotAdapter.install('slim', ctx));
  await applyChanges(await copilotAdapter.uninstall(ctx));
  assert.ok(existsSync(instructionsFile(ctx)));
  assert.equal(await readFile(instructionsFile(ctx), 'utf8'), ' \n');
});

test('file ending in an unclosed code fence: install stays idempotent, uninstall removable', async () => {
  const ctx = await makeCtx();
  const original = '# Notes\n\n```\ncode never closed\n';
  await mkdir(path.dirname(instructionsFile(ctx)), { recursive: true });
  await writeFile(instructionsFile(ctx), original, 'utf8');

  await applyChanges(await copilotAdapter.install('slim', ctx));
  // second install plans nothing — the section must not duplicate
  assert.deepEqual(await copilotAdapter.install('slim', ctx), []);
  const body = await readFile(instructionsFile(ctx), 'utf8');
  assert.equal(markerCount(body), 1);

  // section is visible (not stranded): status sees it, uninstall removes it
  assert.equal((await copilotAdapter.status(ctx)).installed, true);
  await applyChanges(await copilotAdapter.uninstall(ctx));
  assert.equal(await readFile(instructionsFile(ctx), 'utf8'), original);
});

test('--global install throws; global uninstall is a no-op', async () => {
  const ctx = await makeCtx(true);
  await assert.rejects(
    copilotAdapter.install('slim', ctx),
    /copilot: no user-global instruction mechanism; use project scope/,
  );
  assert.deepEqual(await copilotAdapter.uninstall(ctx), []);
});

test('detect: requires a .github directory', async () => {
  const ctx = await makeCtx();
  assert.equal(await copilotAdapter.detect(ctx), false);
  await mkdir(path.join(ctx.projectDir, '.github'), { recursive: true });
  assert.equal(await copilotAdapter.detect(ctx), true);
});

test('hook config: fresh install writes version 1 + our postToolUse entry; uninstall deletes the file', async () => {
  const ctx = await makeCtx();
  await applyChanges(await copilotAdapter.install('slim', ctx));

  const config = await readHookConfig(ctx);
  assert.equal(config.version, 1);
  assert.deepEqual(Object.keys(config.hooks), ['postToolUse']);
  assert.equal(config.hooks['postToolUse']?.length, 1);
  const entry = config.hooks['postToolUse']?.[0];
  assert.ok(entry !== undefined);
  assert.equal(entry['type'], 'command');
  assert.equal(entry['bash'], `${OUR_COPILOT_COMMAND_BASE} --mode slim`);
  // both platform keys per the Copilot hooks reference
  assert.equal(entry['powershell'], entry['bash']);
  assert.equal(typeof entry['timeoutSec'], 'number');

  // idempotent: planning the same install again yields no changes
  assert.deepEqual(await copilotAdapter.install('slim', ctx), []);

  // the config file is ours (namespaced name, nothing foreign left) → deleted
  await applyChanges(await copilotAdapter.uninstall(ctx));
  assert.ok(!existsSync(hookConfigFile(ctx)), 'compressor.json removed');
});

test('hook config: install/status/mode-switch/uninstall round-trip preserves foreign content byte-for-byte', async () => {
  const ctx = await makeCtx();
  const foreign = {
    type: 'command',
    bash: './scripts/audit.sh',
    powershell: './scripts/audit.ps1',
    timeoutSec: 5,
  };
  const foreignSessionStart = { type: 'command', bash: './scripts/banner.sh' };
  const original = `${JSON.stringify(
    {
      version: 1,
      hooks: { postToolUse: [foreign], sessionStart: [foreignSessionStart] },
    },
    null,
    2,
  )}\n`;
  await mkdir(path.dirname(hookConfigFile(ctx)), { recursive: true });
  await writeFile(hookConfigFile(ctx), original, 'utf8');

  await applyChanges(await copilotAdapter.install('slim', ctx));
  const installed = await readHookConfig(ctx);
  assert.equal(installed.version, 1);
  assert.equal(installed.hooks['postToolUse']?.length, 2);
  assert.deepEqual(installed.hooks['postToolUse']?.[0], foreign);
  assert.deepEqual(installed.hooks['sessionStart'], [foreignSessionStart]);
  assert.equal(
    installed.hooks['postToolUse']?.[1]?.['bash'],
    `${OUR_COPILOT_COMMAND_BASE} --mode slim`,
  );

  const status = await copilotAdapter.status(ctx);
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'slim');
  assert.match(status.detail, /input compression/);

  // mode switch rewrites only our entry's --mode flag — no duplicates
  await applyChanges(await copilotAdapter.install('optimized', ctx));
  const switched = await readHookConfig(ctx);
  assert.equal(switched.hooks['postToolUse']?.length, 2);
  assert.deepEqual(switched.hooks['postToolUse']?.[0], foreign);
  assert.equal(
    switched.hooks['postToolUse']?.[1]?.['bash'],
    `${OUR_COPILOT_COMMAND_BASE} --mode optimized`,
  );

  // uninstall removes only ours; foreign content round-trips byte-equal
  await applyChanges(await copilotAdapter.uninstall(ctx));
  assert.equal(await readFile(hookConfigFile(ctx), 'utf8'), original);

  // nothing of ours left: a second uninstall plans no hook-config changes
  const again = await copilotAdapter.uninstall(ctx);
  assert.ok(
    again.every((change) => change.path !== hookConfigFile(ctx)),
    'foreign-only config is never touched again',
  );
});

test('hook config: status without our entry reports instructions-only honestly', async () => {
  const ctx = await makeCtx();
  await applyChanges(await copilotAdapter.install('optimized', ctx));
  await rm(hookConfigFile(ctx));

  const status = await copilotAdapter.status(ctx);
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'optimized');
  assert.match(
    status.detail,
    /instructions only — compression hook not installed \(\.github\/hooks\/compressor\.json\)/,
  );
});

test('hook config: hook-only state (instructions removed) still reports installed + mode from the command', async () => {
  const ctx = await makeCtx();
  await applyChanges(await copilotAdapter.install('slim', ctx));
  await writeFile(instructionsFile(ctx), '', 'utf8');

  const status = await copilotAdapter.status(ctx);
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'slim');
  assert.match(status.detail, /input compression only, instructions not installed/);
});

test('regression: status never claims cloud-agent compression — hook command is a machine-local absolute path', async () => {
  const ctx = await makeCtx();
  await applyChanges(await copilotAdapter.install('slim', ctx));

  // instructions + hook branch
  const both = await copilotAdapter.status(ctx);
  assert.match(both.detail, /absolute local path/);
  assert.match(both.detail, /effective in Copilot CLI on this machine only/);

  // hook-only branch (instructions removed) carries the same honest note
  await writeFile(instructionsFile(ctx), '', 'utf8');
  const hookOnly = await copilotAdapter.status(ctx);
  assert.match(hookOnly.detail, /absolute local path/);
  assert.match(hookOnly.detail, /effective in Copilot CLI on this machine only/);
  assert.doesNotMatch(hookOnly.detail, /CLI \+ cloud agent only/);
});

test('regression: non-array hooks.postToolUse is refused like invalid JSON — foreign entry survives', async () => {
  const ctx = await makeCtx();
  // easy hand-edit mistake: a single entry object instead of an array
  const original = `${JSON.stringify(
    {
      version: 1,
      hooks: { postToolUse: { type: 'command', bash: './audit.sh' } },
    },
    null,
    2,
  )}\n`;
  await mkdir(path.dirname(hookConfigFile(ctx)), { recursive: true });
  await writeFile(hookConfigFile(ctx), original, 'utf8');

  await assert.rejects(
    copilotAdapter.install('slim', ctx),
    /compressor\.json has a non-array "hooks\.postToolUse" value — not touching it/,
  );
  // nothing was written: the user's ./audit.sh entry survives byte-for-byte
  assert.equal(await readFile(hookConfigFile(ctx), 'utf8'), original);

  // status stays calm; uninstall also refuses rather than coercing to empty
  assert.equal((await copilotAdapter.status(ctx)).installed, false);
  await assert.rejects(copilotAdapter.uninstall(ctx), /not touching it/);
  assert.equal(await readFile(hookConfigFile(ctx), 'utf8'), original);
});

test('regression: non-object hooks value is refused like invalid JSON — foreign events survive', async () => {
  const ctx = await makeCtx();
  const original = `${JSON.stringify(
    { version: 1, hooks: [{ type: 'command', bash: './x.sh' }] },
    null,
    2,
  )}\n`;
  await mkdir(path.dirname(hookConfigFile(ctx)), { recursive: true });
  await writeFile(hookConfigFile(ctx), original, 'utf8');

  await assert.rejects(
    copilotAdapter.install('slim', ctx),
    /compressor\.json has a non-object "hooks" value — not touching it/,
  );
  assert.equal(await readFile(hookConfigFile(ctx), 'utf8'), original);
  assert.equal((await copilotAdapter.status(ctx)).installed, false);
});

test('hook config: invalid JSON is not touched — install throws, status stays calm', async () => {
  const ctx = await makeCtx();
  await mkdir(path.dirname(hookConfigFile(ctx)), { recursive: true });
  await writeFile(hookConfigFile(ctx), 'not json {{{', 'utf8');

  await assert.rejects(
    copilotAdapter.install('slim', ctx),
    /compressor\.json is not valid JSON — not touching it/,
  );
  const status = await copilotAdapter.status(ctx);
  assert.equal(status.installed, false);
});
