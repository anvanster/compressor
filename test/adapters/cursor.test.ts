import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cursorAdapter } from '../../src/adapters/cursor.ts';
import { applyChanges } from '../../src/adapters/apply.ts';
import {
  MARKER_BEGIN_PREFIX,
  parseAtomManifest,
  renderCursorRules,
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

function mdcFile(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, '.cursor', 'rules', 'compressor.mdc');
}

function legacyFile(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, '.cursorrules');
}

function markerCount(text: string): number {
  return text.split(MARKER_BEGIN_PREFIX).length - 1;
}

test('install writes compressor.mdc with mandatory frontmatter; never creates .cursorrules', async () => {
  const ctx = await makeCtx();
  await applyChanges(await cursorAdapter.install('slim', ctx));

  const body = await readFile(mdcFile(ctx), 'utf8');
  assert.equal(body, renderCursorRules('slim').body);
  // .mdc frontmatter is mandatory for Cursor's rules system (plain .md is
  // silently ignored); with alwaysApply: true the other fields are ignored
  assert.match(body, /^---\ndescription: /);
  assert.match(body, /\nalwaysApply: true\n---\n/);
  assert.equal(parseAtomManifest(body)?.mode, 'slim');
  assert.ok(!existsSync(legacyFile(ctx)));

  // idempotent
  assert.deepEqual(await cursorAdapter.install('slim', ctx), []);

  // mode switch overwrites the owned file in place
  await applyChanges(await cursorAdapter.install('optimized', ctx));
  const switched = await readFile(mdcFile(ctx), 'utf8');
  assert.equal(switched, renderCursorRules('optimized').body);
  assert.equal(parseAtomManifest(switched)?.mode, 'optimized');

  // uninstall deletes the compressor-owned .mdc
  await applyChanges(await cursorAdapter.uninstall(ctx));
  assert.ok(!existsSync(mdcFile(ctx)));
  assert.ok(!existsSync(legacyFile(ctx)));
});

test('pre-existing legacy .cursorrules gets a marked section and round-trips byte-equal', async () => {
  const ctx = await makeCtx();
  const original = '# My cursor rules\n\nBe nice.\n';
  await writeFile(legacyFile(ctx), original, 'utf8');

  await applyChanges(await cursorAdapter.install('slim', ctx));
  assert.ok(existsSync(mdcFile(ctx)));
  const legacy = await readFile(legacyFile(ctx), 'utf8');
  assert.equal(
    legacy,
    `# My cursor rules\n\nBe nice.\n\n${renderMarkedSection('slim', 'cursor').body}\n`,
  );

  // mode switch replaces the section in place, no duplicates
  await applyChanges(await cursorAdapter.install('optimized', ctx));
  const switched = await readFile(legacyFile(ctx), 'utf8');
  assert.equal(markerCount(switched), 1);
  assert.ok(switched.includes('mode=optimized'));
  assert.ok(!switched.includes('mode=slim'));

  // uninstall: .mdc deleted, .cursorrules byte-equal to pre-install original
  await applyChanges(await cursorAdapter.uninstall(ctx));
  assert.ok(!existsSync(mdcFile(ctx)));
  assert.equal(await readFile(legacyFile(ctx), 'utf8'), original);

  const status = await cursorAdapter.status(ctx);
  assert.equal(status.installed, false);
});

test('uninstall never deletes .cursorrules even when only our section remained', async () => {
  const ctx = await makeCtx();
  await writeFile(legacyFile(ctx), '', 'utf8'); // user has an empty legacy file

  await applyChanges(await cursorAdapter.install('slim', ctx));
  const legacy = await readFile(legacyFile(ctx), 'utf8');
  assert.equal(legacy, `${renderMarkedSection('slim', 'cursor').body}\n`);

  await applyChanges(await cursorAdapter.uninstall(ctx));
  assert.ok(existsSync(legacyFile(ctx)), '.cursorrules was not ours to delete');
  assert.equal(await readFile(legacyFile(ctx), 'utf8'), '');
});

test('status reports installed + mode + asymmetry note + AGENTS.md overlap', async () => {
  const ctx = await makeCtx();
  const before = await cursorAdapter.status(ctx);
  assert.equal(before.installed, false);
  assert.equal(before.detail, 'not installed');

  await applyChanges(await cursorAdapter.install('slim', ctx));
  const status = await cursorAdapter.status(ctx);
  assert.equal(status.agent, 'cursor');
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'slim');
  assert.match(status.detail, /\.cursor\/rules\/compressor\.mdc/);
  // regression: Cursor DOES ship hooks — the real asymmetry is that they
  // cannot rewrite built-in tool output (postToolUse replaces MCP output only)
  assert.match(
    status.detail,
    /instructions only — Cursor hooks cannot rewrite built-in tool output \(postToolUse replaces MCP output only\)/,
  );
  assert.doesNotMatch(status.detail, /has no hook mechanism/);
  assert.doesNotMatch(status.detail, /also reads AGENTS\.md/);

  await writeFile(
    path.join(ctx.projectDir, 'AGENTS.md'),
    `${renderMarkedSection('slim', 'agents-md').body}\n`,
    'utf8',
  );
  const overlapped = await cursorAdapter.status(ctx);
  assert.match(
    overlapped.detail,
    /NOTE: Cursor also reads AGENTS\.md — both installed means duplicated instructions/,
  );
});

test('status flags a hand-edited compressor.mdc as locally modified', async () => {
  const ctx = await makeCtx();
  await applyChanges(await cursorAdapter.install('slim', ctx));
  const clean = await cursorAdapter.status(ctx);
  assert.doesNotMatch(clean.detail, /locally modified/);

  // hand edit that keeps the manifest intact: mode still parsed, drift flagged
  await writeFile(
    mdcFile(ctx),
    `${renderCursorRules('slim').body}- my extra hand-written rule\n`,
    'utf8',
  );
  const modified = await cursorAdapter.status(ctx);
  assert.equal(modified.installed, true);
  assert.equal(modified.mode, 'slim');
  assert.match(modified.detail, /locally modified — install will overwrite/);

  // hand edit that breaks the manifest: drift still reported, not silently dropped
  await writeFile(
    mdcFile(ctx),
    '---\ndescription: hacked\nalwaysApply: true\n---\n\nmy own rules\n',
    'utf8',
  );
  const broken = await cursorAdapter.status(ctx);
  assert.equal(broken.installed, true);
  assert.equal(broken.mode, undefined);
  assert.match(broken.detail, /locally modified — install will overwrite/);
});

test('status reports a legacy-only install (section in .cursorrules, no .mdc)', async () => {
  const ctx = await makeCtx();
  await writeFile(
    legacyFile(ctx),
    `user rules\n\n${renderMarkedSection('optimized', 'cursor').body}\n`,
    'utf8',
  );
  const status = await cursorAdapter.status(ctx);
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'optimized');
  assert.match(status.detail, /legacy \.cursorrules section/);
});

test('--global install throws; global uninstall is a no-op', async () => {
  const ctx = await makeCtx(true);
  await assert.rejects(
    cursorAdapter.install('slim', ctx),
    /cursor: Cursor rules are per-project; use project scope/,
  );
  assert.deepEqual(await cursorAdapter.uninstall(ctx), []);
});

test('detect: .cursor dir or .cursorrules file', async () => {
  const ctx = await makeCtx();
  assert.equal(await cursorAdapter.detect(ctx), false);

  await writeFile(legacyFile(ctx), '# rules\n', 'utf8');
  assert.equal(await cursorAdapter.detect(ctx), true);

  const ctx2 = await makeCtx();
  await mkdir(path.join(ctx2.projectDir, '.cursor'), { recursive: true });
  assert.equal(await cursorAdapter.detect(ctx2), true);
});
