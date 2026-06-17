import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeCodeAdapter } from '../../src/adapters/claude-code.ts';
import { applyChanges } from '../../src/adapters/apply.ts';
import type { AdapterContext } from '../../src/adapters/types.ts';

// The Claude Code matcher is a REGEX; widening it to reach MCP tools must keep
// install/status/uninstall round-tripping (ownership keys on the hook COMMAND,
// not the matcher string).

const HOOK_COMMAND = 'node /opt/compressor/dist/hook.js';

async function makeCtx(): Promise<AdapterContext> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compressor-mcp-adapter-'));
  const projectDir = path.join(root, 'project');
  const homeDir = path.join(root, 'home');
  await mkdir(projectDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  return { projectDir, homeDir, global: false, hookCommand: HOOK_COMMAND };
}

function localSettingsFile(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, '.claude', 'settings.local.json');
}

interface PostEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

async function readPostEntries(ctx: AdapterContext): Promise<PostEntry[]> {
  const text = await readFile(localSettingsFile(ctx), 'utf8');
  const parsed = JSON.parse(text) as { hooks?: { PostToolUse?: PostEntry[] } };
  return parsed.hooks?.PostToolUse ?? [];
}

test('installed matcher includes mcp__.* (reaches MCP tools)', async () => {
  const ctx = await makeCtx();
  await applyChanges(await claudeCodeAdapter.install('slim', ctx));
  const entries = await readPostEntries(ctx);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.matcher, 'Read|Bash|Grep|Glob|mcp__.*');
  assert.equal(entries[0]?.hooks[0]?.command, HOOK_COMMAND);
});

test('install → status → uninstall round-trips clean with the MCP matcher', async () => {
  const ctx = await makeCtx();

  await applyChanges(await claudeCodeAdapter.install('optimized', ctx));
  const status = await claudeCodeAdapter.status(ctx);
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'optimized');
  assert.match(status.detail, /hook installed/);

  await applyChanges(await claudeCodeAdapter.uninstall(ctx));
  // our-only local settings removed entirely
  assert.ok(!existsSync(localSettingsFile(ctx)), 'local settings cleaned up');
  const after = await claudeCodeAdapter.status(ctx);
  assert.equal(after.installed, false);
});

test('uninstall claims an OLD-matcher entry (ownership keys on the command)', async () => {
  const ctx = await makeCtx();
  // simulate a prior install that wrote the narrow matcher
  const old = {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Read|Bash|Grep|Glob',
          hooks: [{ type: 'command', command: HOOK_COMMAND }],
        },
      ],
    },
  };
  await mkdir(path.dirname(localSettingsFile(ctx)), { recursive: true });
  await writeFile(localSettingsFile(ctx), `${JSON.stringify(old, null, 2)}\n`, 'utf8');

  // a fresh install replaces it in place (no duplicate), now with the wide matcher
  await applyChanges(await claudeCodeAdapter.install('slim', ctx));
  const entries = await readPostEntries(ctx);
  assert.equal(entries.length, 1, 'no duplicate entry');
  assert.equal(entries[0]?.matcher, 'Read|Bash|Grep|Glob|mcp__.*');

  // uninstall still removes it (keyed on the command, not the matcher)
  await applyChanges(await claudeCodeAdapter.uninstall(ctx));
  assert.ok(!existsSync(localSettingsFile(ctx)));
});
