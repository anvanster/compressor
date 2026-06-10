import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agentsMdAdapter } from '../../src/adapters/agents-md.ts';
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

function agentsMdFile(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, 'AGENTS.md');
}

function markerCount(text: string): number {
  return text.split(MARKER_BEGIN_PREFIX).length - 1;
}

test('install into empty project creates AGENTS.md with only our section; uninstall truncates it', async () => {
  const ctx = await makeCtx();
  await applyChanges(await agentsMdAdapter.install('optimized', ctx));

  const body = await readFile(agentsMdFile(ctx), 'utf8');
  assert.equal(body, `${renderMarkedSection('optimized', 'agents-md').body}\n`);
  assert.equal(parseAtomManifest(body)?.mode, 'optimized');

  // idempotent
  assert.deepEqual(await agentsMdAdapter.install('optimized', ctx), []);

  // never delete: creation is not derivable from disk, so err KEEP
  await applyChanges(await agentsMdAdapter.uninstall(ctx));
  assert.ok(existsSync(agentsMdFile(ctx)));
  assert.equal(await readFile(agentsMdFile(ctx), 'utf8'), '');
});

test('uninstall keeps a user-created empty AGENTS.md instead of deleting it', async () => {
  const ctx = await makeCtx();
  // user-created placeholder (possibly git-tracked) — indistinguishable on
  // disk from a file we created, so uninstall must err KEEP
  await writeFile(agentsMdFile(ctx), '', 'utf8');

  await applyChanges(await agentsMdAdapter.install('slim', ctx));
  await applyChanges(await agentsMdAdapter.uninstall(ctx));
  assert.ok(existsSync(agentsMdFile(ctx)), 'user placeholder must survive uninstall');
  assert.equal(await readFile(agentsMdFile(ctx), 'utf8'), '');
});

test('uninstall round-trips a whitespace-only AGENTS.md byte-for-byte', async () => {
  const ctx = await makeCtx();
  await writeFile(agentsMdFile(ctx), ' \n', 'utf8');

  await applyChanges(await agentsMdAdapter.install('slim', ctx));
  await applyChanges(await agentsMdAdapter.uninstall(ctx));
  assert.ok(existsSync(agentsMdFile(ctx)));
  assert.equal(await readFile(agentsMdFile(ctx), 'utf8'), ' \n');
});

test('foreign content above and below our section is byte-preserved across switch + uninstall', async () => {
  const ctx = await makeCtx();
  const original = '# Project agents guide\n\nRun `make dev` first.\n';
  await writeFile(agentsMdFile(ctx), original, 'utf8');

  await applyChanges(await agentsMdAdapter.install('slim', ctx));
  const afterInstall = await readFile(agentsMdFile(ctx), 'utf8');
  assert.equal(
    afterInstall,
    `# Project agents guide\n\nRun \`make dev\` first.\n\n${renderMarkedSection('slim', 'agents-md').body}\n`,
  );

  // user appends content BELOW our section
  const below = '\n## Deployment\nnever on Fridays\n';
  await writeFile(agentsMdFile(ctx), `${afterInstall}${below}`, 'utf8');

  // mode switch replaces in place — no duplicate sections
  await applyChanges(await agentsMdAdapter.install('optimized', ctx));
  const switched = await readFile(agentsMdFile(ctx), 'utf8');
  assert.equal(markerCount(switched), 1);
  assert.equal(parseAtomManifest(switched)?.mode, 'optimized');
  assert.equal(
    switched,
    `# Project agents guide\n\nRun \`make dev\` first.\n\n${renderMarkedSection('optimized', 'agents-md').body}\n\n## Deployment\nnever on Fridays\n`,
  );

  // uninstall keeps the user's file, foreign bytes exact
  await applyChanges(await agentsMdAdapter.uninstall(ctx));
  assert.equal(
    await readFile(agentsMdFile(ctx), 'utf8'),
    '# Project agents guide\n\nRun `make dev` first.\n\n## Deployment\nnever on Fridays\n',
  );

  // uninstall with nothing of ours present plans no changes
  assert.deepEqual(await agentsMdAdapter.uninstall(ctx), []);
});

test('status reports installed + mode + native-readers note', async () => {
  const ctx = await makeCtx();
  const before = await agentsMdAdapter.status(ctx);
  assert.equal(before.installed, false);
  assert.equal(before.detail, 'not installed');

  await applyChanges(await agentsMdAdapter.install('slim', ctx));
  const status = await agentsMdAdapter.status(ctx);
  assert.equal(status.agent, 'agents-md');
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'slim');
  assert.match(
    status.detail,
    /instructions only — read natively by Cursor, Copilot, Codex, Windsurf; Claude Code does NOT read AGENTS\.md/,
  );
});

test('--global install throws; global uninstall is a no-op', async () => {
  const ctx = await makeCtx(true);
  await assert.rejects(
    agentsMdAdapter.install('optimized', ctx),
    /agents-md: AGENTS\.md is a per-project standard; use project scope/,
  );
  assert.deepEqual(await agentsMdAdapter.uninstall(ctx), []);
});

test('detect: AGENTS.md itself, or .cursor/.github signal agents that read it', async () => {
  const ctx = await makeCtx();
  assert.equal(await agentsMdAdapter.detect(ctx), false);

  await writeFile(agentsMdFile(ctx), '# guide\n', 'utf8');
  assert.equal(await agentsMdAdapter.detect(ctx), true);

  const withGithub = await makeCtx();
  await mkdir(path.join(withGithub.projectDir, '.github'), { recursive: true });
  assert.equal(await agentsMdAdapter.detect(withGithub), true);

  const withCursor = await makeCtx();
  await mkdir(path.join(withCursor.projectDir, '.cursor'), { recursive: true });
  assert.equal(await agentsMdAdapter.detect(withCursor), true);
});
