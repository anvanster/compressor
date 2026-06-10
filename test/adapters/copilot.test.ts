import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

test('status reports installed + mode + asymmetry note + AGENTS.md overlap', async () => {
  const ctx = await makeCtx();
  const before = await copilotAdapter.status(ctx);
  assert.equal(before.installed, false);
  assert.equal(before.detail, 'not installed');

  await applyChanges(await copilotAdapter.install('optimized', ctx));
  const status = await copilotAdapter.status(ctx);
  assert.equal(status.agent, 'copilot');
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'optimized');
  // regression: Copilot DOES have hooks (.github/hooks postToolUse can replace
  // tool output) — the gap is that compressor's hook is not ported yet
  assert.match(
    status.detail,
    /instructions only — compressor's compression hook is not yet ported to Copilot hooks \(\.github\/hooks\)/,
  );
  assert.doesNotMatch(status.detail, /has no hook mechanism/);
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
