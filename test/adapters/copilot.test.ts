import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { copilotAdapter } from '../../src/adapters/copilot.ts';
import { applyChanges } from '../../src/adapters/apply.ts';
import { describeCopilotHookCommand } from '../../src/paths.ts';
import {
  MARKER_BEGIN_PREFIX,
  parseAtomManifest,
  renderMarkedSection,
} from '../../src/packs/render.ts';
import type { AdapterContext } from '../../src/adapters/types.ts';

// Hermeticity: the adapter reads $COPILOT_HOME for global-scope resolution —
// a developer's real value must never leak into these tests. Cleared for the
// whole file; tests that need it use withCopilotHome.
const SAVED_COPILOT_HOME = process.env['COPILOT_HOME'];
delete process.env['COPILOT_HOME'];
after(() => {
  if (SAVED_COPILOT_HOME !== undefined) {
    process.env['COPILOT_HOME'] = SAVED_COPILOT_HOME;
  }
});

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

function globalHookConfigFile(ctx: AdapterContext): string {
  return path.join(ctx.homeDir, '.copilot', 'hooks', 'compressor.json');
}

/** Run with COPILOT_HOME set (or deleted when undefined), restoring after. */
async function withCopilotHome(
  value: string | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  const saved = process.env['COPILOT_HOME'];
  if (value === undefined) {
    delete process.env['COPILOT_HOME'];
  } else {
    process.env['COPILOT_HOME'] = value;
  }
  try {
    await fn();
  } finally {
    if (saved === undefined) {
      delete process.env['COPILOT_HOME'];
    } else {
      process.env['COPILOT_HOME'] = saved;
    }
  }
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

// Deliberate behavior change (global hooks phase): --global no longer throws.
// User-scope hooks (<copilotHome>/hooks/, CLI >= 1.0.21) are real; global
// install plans ONLY the hook config — instructions stay project-scoped.
test('global install plans only the hook config under ~/.copilot/hooks — no instructions anywhere; idempotent', async () => {
  await withCopilotHome(undefined, async () => {
    const ctx = await makeCtx(true);

    const changes = await copilotAdapter.install('slim', ctx);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]?.path, globalHookConfigFile(ctx));
    await applyChanges(changes);

    const raw = await readFile(globalHookConfigFile(ctx), 'utf8');
    const config = JSON.parse(raw) as HookConfig;
    assert.equal(config.version, 1);
    assert.deepEqual(Object.keys(config.hooks), ['postToolUse']);
    assert.equal(config.hooks['postToolUse']?.length, 1);
    const entry = config.hooks['postToolUse']?.[0];
    assert.ok(entry !== undefined);
    assert.equal(entry['type'], 'command');
    // quoted command with the --mode flag, same shape as project scope
    assert.equal(entry['bash'], `${OUR_COPILOT_COMMAND_BASE} --mode slim`);
    assert.equal(entry['powershell'], entry['bash']);
    assert.equal(typeof entry['timeoutSec'], 'number');

    // NEVER an instructions change at global scope — no file in the project,
    // nothing outside the hook config in the fake home
    assert.ok(!existsSync(instructionsFile(ctx)));
    assert.ok(!existsSync(path.join(ctx.projectDir, '.github')));
    assert.ok(!existsSync(path.join(ctx.homeDir, '.copilot', 'copilot-instructions.md')));

    // idempotent: second install plans nothing; file byte-identical
    assert.deepEqual(await copilotAdapter.install('slim', ctx), []);
    assert.equal(await readFile(globalHookConfigFile(ctx), 'utf8'), raw);

    // global uninstall deletes the file when only ours is in it
    await applyChanges(await copilotAdapter.uninstall(ctx));
    assert.ok(!existsSync(globalHookConfigFile(ctx)));

    // nothing of ours left: uninstall plans no changes
    assert.deepEqual(await copilotAdapter.uninstall(ctx), []);
  });
});

test('COPILOT_HOME overrides the global hook location', async () => {
  const ctx = await makeCtx(true);
  const copilotHome = path.join(path.dirname(ctx.projectDir), 'copilot-home');
  await withCopilotHome(copilotHome, async () => {
    await applyChanges(await copilotAdapter.install('optimized', ctx));

    const file = path.join(copilotHome, 'hooks', 'compressor.json');
    const config = JSON.parse(await readFile(file, 'utf8')) as HookConfig;
    assert.equal(
      config.hooks['postToolUse']?.[0]?.['bash'],
      `${OUR_COPILOT_COMMAND_BASE} --mode optimized`,
    );
    // nothing written under the default ~/.copilot
    assert.ok(!existsSync(path.join(ctx.homeDir, '.copilot')));

    // detect/status/uninstall all honor the override
    assert.equal(await copilotAdapter.detect(ctx), true);
    const status = await copilotAdapter.status(ctx);
    assert.equal(status.installed, true);
    assert.match(status.detail, /\$COPILOT_HOME\/hooks\/compressor\.json \(global\)/);
    await applyChanges(await copilotAdapter.uninstall(ctx));
    assert.ok(!existsSync(file));
  });
});

test('regression: relative or tilde COPILOT_HOME is refused — global scope must never anchor to cwd', async () => {
  // '.copilot-custom' would land under process.cwd() (inside the project tree,
  // committable; stranded for uninstall from any other cwd); '~/copilot-home'
  // is a literal tilde — Node never expands ~ — so it is relative too.
  for (const value of ['.copilot-custom', '~/copilot-home']) {
    await withCopilotHome(value, async () => {
      const ctx = await makeCtx(true);
      const refused = /COPILOT_HOME=.* is not an absolute path/;

      // every scope decision routes through copilotHome — all four refuse
      await assert.rejects(copilotAdapter.install('slim', ctx), refused);
      await assert.rejects(copilotAdapter.uninstall(ctx), refused);
      await assert.rejects(copilotAdapter.detect(ctx), refused);
      await assert.rejects(copilotAdapter.status(ctx), refused);

      // project-scope status inspects the global hook for its cross-scope
      // note — it must refuse rather than report a cwd-dependent location
      const projectCtx: AdapterContext = { ...ctx, global: false };
      await assert.rejects(copilotAdapter.status(projectCtx), refused);

      // nothing was planned, so nothing can leak into the current directory
      assert.ok(!existsSync(path.join(process.cwd(), value)));
      assert.ok(!existsSync(path.join(process.cwd(), '~')));
      // and nothing fell back to the default home either
      assert.ok(!existsSync(path.join(ctx.homeDir, '.copilot')));
    });
  }
});

test('regression: whitespace-only COPILOT_HOME counts as unset — default ~/.copilot used', async () => {
  await withCopilotHome('   ', async () => {
    const ctx = await makeCtx(true);

    const changes = await copilotAdapter.install('slim', ctx);
    assert.equal(changes.length, 1);
    // planned under the fake home's ~/.copilot, never '   /hooks/...' in cwd
    assert.equal(changes[0]?.path, globalHookConfigFile(ctx));
    await applyChanges(changes);
    assert.ok(!existsSync(path.join(process.cwd(), '   ')));

    // display also treats it as unset: ~/.copilot, not $COPILOT_HOME
    const status = await copilotAdapter.status(ctx);
    assert.equal(status.installed, true);
    assert.match(status.detail, /~\/\.copilot\/hooks\/compressor\.json \(global\)/);

    await applyChanges(await copilotAdapter.uninstall(ctx));
    assert.ok(!existsSync(globalHookConfigFile(ctx)));
  });
});

test('global config: foreign entry preserved through install, mode switch, and uninstall', async () => {
  await withCopilotHome(undefined, async () => {
    const ctx = await makeCtx(true);
    const foreign = {
      type: 'command',
      bash: './scripts/audit.sh',
      timeoutSec: 5,
    };
    const original = `${JSON.stringify(
      { version: 1, hooks: { postToolUse: [foreign] } },
      null,
      2,
    )}\n`;
    await mkdir(path.dirname(globalHookConfigFile(ctx)), { recursive: true });
    await writeFile(globalHookConfigFile(ctx), original, 'utf8');

    await applyChanges(await copilotAdapter.install('slim', ctx));
    const installed = JSON.parse(
      await readFile(globalHookConfigFile(ctx), 'utf8'),
    ) as HookConfig;
    assert.equal(installed.hooks['postToolUse']?.length, 2);
    assert.deepEqual(installed.hooks['postToolUse']?.[0], foreign);
    assert.equal(
      installed.hooks['postToolUse']?.[1]?.['bash'],
      `${OUR_COPILOT_COMMAND_BASE} --mode slim`,
    );

    // mode switch replaces only our entry's --mode flag — no duplicates
    await applyChanges(await copilotAdapter.install('optimized', ctx));
    const switched = JSON.parse(
      await readFile(globalHookConfigFile(ctx), 'utf8'),
    ) as HookConfig;
    assert.equal(switched.hooks['postToolUse']?.length, 2);
    assert.deepEqual(switched.hooks['postToolUse']?.[0], foreign);
    assert.equal(
      switched.hooks['postToolUse']?.[1]?.['bash'],
      `${OUR_COPILOT_COMMAND_BASE} --mode optimized`,
    );

    // uninstall strips only ours; foreign-bearing file kept byte-equal
    await applyChanges(await copilotAdapter.uninstall(ctx));
    assert.equal(await readFile(globalHookConfigFile(ctx), 'utf8'), original);
  });
});

test('status: global detail + project cross-scope notes', async () => {
  await withCopilotHome(undefined, async () => {
    const ctx = await makeCtx(); // project scope
    const globalCtx: AdapterContext = { ...ctx, global: true };

    // nothing anywhere: both scopes report not installed
    const empty = await copilotAdapter.status(globalCtx);
    assert.equal(empty.installed, false);
    assert.equal(empty.detail, 'not installed');

    // only global installed
    await applyChanges(await copilotAdapter.install('slim', globalCtx));
    const globalStatus = await copilotAdapter.status(globalCtx);
    assert.equal(globalStatus.installed, true);
    assert.equal(globalStatus.mode, 'slim');
    assert.match(
      globalStatus.detail,
      /~\/\.copilot\/hooks\/compressor\.json \(global\)/,
    );
    assert.match(
      globalStatus.detail,
      /machine-wide input compression for Copilot CLI on this machine/,
    );
    assert.match(globalStatus.detail, /instructions are per-repo/);
    assert.match(globalStatus.detail, /IDE runs no hook files/);
    assert.match(
      globalStatus.detail,
      /cloud agent reads only \.github\/hooks on the default branch/,
    );

    // project ctx with only global installed: scope-faithful primary line
    // plus the cross-scope note (mode surfaced from the global hook)
    const projectOnly = await copilotAdapter.status(ctx);
    assert.match(projectOnly.detail, /^not installed \(project\)/);
    assert.match(projectOnly.detail, /installed globally \(machine-wide hook\)/);
    assert.equal(projectOnly.mode, 'slim');

    // BOTH scopes installed: project detail appends the also-globally note
    await applyChanges(await copilotAdapter.install('optimized', ctx));
    const both = await copilotAdapter.status(ctx);
    assert.equal(both.installed, true);
    assert.equal(both.mode, 'optimized');
    assert.match(both.detail, /instructions \+ input compression/);
    assert.match(both.detail, /also installed globally \(machine-wide hook\)/);

    // project-only after global uninstall: no cross-scope note
    await applyChanges(await copilotAdapter.uninstall(globalCtx));
    const projectScoped = await copilotAdapter.status(ctx);
    assert.doesNotMatch(projectScoped.detail, /globally/);
  });
});

test('detect: requires a .github directory (project) or <copilotHome> (global)', async () => {
  await withCopilotHome(undefined, async () => {
    const ctx = await makeCtx();
    assert.equal(await copilotAdapter.detect(ctx), false);
    await mkdir(path.join(ctx.projectDir, '.github'), { recursive: true });
    assert.equal(await copilotAdapter.detect(ctx), true);

    // global scope keys on the copilot home dir, not .github
    const globalCtx: AdapterContext = { ...ctx, global: true };
    assert.equal(await copilotAdapter.detect(globalCtx), false);
    await mkdir(path.join(ctx.homeDir, '.copilot'), { recursive: true });
    assert.equal(await copilotAdapter.detect(globalCtx), true);
  });
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

test('relocatable command: install writes the bin form; status shows the relocatable note', async () => {
  const ctx = await makeCtx();
  const relocCtx: AdapterContext = { ...ctx, hookCommand: 'compressor-hook --mode slim' };
  await applyChanges(await copilotAdapter.install('slim', relocCtx));

  const config = await readHookConfig(relocCtx);
  assert.equal(
    config.hooks['postToolUse']?.[0]?.['bash'],
    'compressor-copilot-hook --mode slim',
  );

  const status = await copilotAdapter.status(relocCtx);
  assert.equal(status.installed, true);
  assert.equal(status.mode, 'slim');
  assert.match(
    status.detail,
    /relocatable command — works wherever @astudioplus\/compressor is installed on PATH/,
  );
  assert.doesNotMatch(status.detail, /absolute local path/);
  // still conservative: never an unconditional cloud-agent claim
  assert.match(status.detail, /if the config is on the default branch and the package is in its environment/);
  assert.match(status.detail, /IDE runs no hook files/);

  // the note keys on the INSTALLED form: an absolute-style context (e.g.
  // status run from a source checkout) must still report the relocatable note
  const absStatus = await copilotAdapter.status(ctx);
  assert.equal(absStatus.installed, true);
  assert.match(absStatus.detail, /relocatable command/);
  assert.doesNotMatch(absStatus.detail, /absolute local path/);
});

test('relocatable predicate: word boundary — near-miss commands are never claimed', async () => {
  const ctx = await makeCtx();
  const nearMisses = [
    { type: 'command', bash: 'my-compressor-copilot-hook --mode slim' },
    { type: 'command', bash: 'compressor-copilot-hooks --mode slim' },
  ];
  const original = `${JSON.stringify(
    { version: 1, hooks: { postToolUse: nearMisses } },
    null,
    2,
  )}\n`;
  await mkdir(path.dirname(hookConfigFile(ctx)), { recursive: true });
  await writeFile(hookConfigFile(ctx), original, 'utf8');

  const relocCtx: AdapterContext = { ...ctx, hookCommand: 'compressor-hook --mode slim' };
  await applyChanges(await copilotAdapter.install('slim', relocCtx));
  const installed = await readHookConfig(relocCtx);
  assert.equal(installed.hooks['postToolUse']?.length, 3);
  assert.deepEqual(installed.hooks['postToolUse']?.[0], nearMisses[0]);
  assert.deepEqual(installed.hooks['postToolUse']?.[1], nearMisses[1]);
  assert.equal(
    installed.hooks['postToolUse']?.[2]?.['bash'],
    'compressor-copilot-hook --mode slim',
  );

  // uninstall removes only ours; near-miss entries round-trip byte-equal
  await applyChanges(await copilotAdapter.uninstall(relocCtx));
  assert.equal(await readFile(hookConfigFile(ctx), 'utf8'), original);
});

test('upgrade path: old absolute copilot entry replaced by a relocatable install — no duplicates', async () => {
  const ctx = await makeCtx();
  // the form a previous absolute-style install of THIS package wrote
  const oldAbsolute = describeCopilotHookCommand('slim', undefined, 'absolute');
  const seeded = `${JSON.stringify(
    {
      version: 1,
      hooks: {
        postToolUse: [
          { type: 'command', bash: oldAbsolute, powershell: oldAbsolute, timeoutSec: 10 },
        ],
      },
    },
    null,
    2,
  )}\n`;
  await mkdir(path.dirname(hookConfigFile(ctx)), { recursive: true });
  await writeFile(hookConfigFile(ctx), seeded, 'utf8');

  const relocCtx: AdapterContext = { ...ctx, hookCommand: 'compressor-hook --mode slim' };
  await applyChanges(await copilotAdapter.install('slim', relocCtx));
  const config = await readHookConfig(relocCtx);
  assert.equal(config.hooks['postToolUse']?.length, 1);
  assert.equal(
    config.hooks['postToolUse']?.[0]?.['bash'],
    'compressor-copilot-hook --mode slim',
  );
});

// Regression (minor): global uninstall deleted <copilotHome>/hooks/compressor.json
// but left the now-empty hooks/ and .copilot/ dirs behind — and detect() keys
// on the .copilot dir existing, so it reported true forever after.
test('global uninstall prunes the empty hooks/.copilot dirs it created — detect() flips back to false', async () => {
  await withCopilotHome(undefined, async () => {
    const ctx = await makeCtx(true);
    assert.equal(await copilotAdapter.detect(ctx), false);

    await applyChanges(await copilotAdapter.install('slim', ctx));
    assert.equal(await copilotAdapter.detect(ctx), true);

    await applyChanges(await copilotAdapter.uninstall(ctx));
    assert.ok(
      !existsSync(path.join(ctx.homeDir, '.copilot')),
      '<home>/.copilot gone entirely when we created it',
    );
    assert.equal(await copilotAdapter.detect(ctx), false);
    // the prune is bounded at the .copilot segment — the home dir survives
    assert.ok(existsSync(ctx.homeDir));
  });
});

test('global uninstall keeps a pre-existing .copilot dir holding foreign files', async () => {
  await withCopilotHome(undefined, async () => {
    const ctx = await makeCtx(true);
    const copilotDir = path.join(ctx.homeDir, '.copilot');
    const foreignFile = path.join(copilotDir, 'config.json');
    await mkdir(copilotDir, { recursive: true });
    await writeFile(foreignFile, '{"banner": false}\n', 'utf8');

    await applyChanges(await copilotAdapter.install('slim', ctx));
    await applyChanges(await copilotAdapter.uninstall(ctx));

    // hooks/ was ours (created by install, empty after the delete) — pruned;
    // the foreign file makes rmdir(.copilot) fail, so the user's dir is kept
    assert.ok(!existsSync(path.join(copilotDir, 'hooks')));
    assert.ok(existsSync(copilotDir), 'pre-existing .copilot dir must survive');
    assert.equal(await readFile(foreignFile, 'utf8'), '{"banner": false}\n');
  });
});

test('global uninstall keeps a hooks dir holding a foreign hook config', async () => {
  await withCopilotHome(undefined, async () => {
    const ctx = await makeCtx(true);
    const hooksDir = path.dirname(globalHookConfigFile(ctx));
    const foreignHook = path.join(hooksDir, 'other-tool.json');
    await mkdir(hooksDir, { recursive: true });
    await writeFile(foreignHook, '{"version": 1}\n', 'utf8');

    await applyChanges(await copilotAdapter.install('slim', ctx));
    await applyChanges(await copilotAdapter.uninstall(ctx));

    assert.ok(!existsSync(globalHookConfigFile(ctx)), 'our config removed');
    assert.ok(existsSync(hooksDir), 'foreign-bearing hooks dir kept');
    assert.equal(await readFile(foreignHook, 'utf8'), '{"version": 1}\n');
  });
});

// Regression (minor): the delete-when-only-ours rule treated ANY
// `{"version": <x>}` leftover as our stub. We only ever write version 1; a
// pre-existing file with another version (or unknown top-level keys) is user
// data — uninstall must strip our entries and KEEP the file.
test('regression: pre-existing config with a version we did not write survives uninstall', async () => {
  const ctx = await makeCtx();
  const original = `${JSON.stringify({ version: 2 }, null, 2)}\n`;
  await mkdir(path.dirname(hookConfigFile(ctx)), { recursive: true });
  await writeFile(hookConfigFile(ctx), original, 'utf8');

  await applyChanges(await copilotAdapter.install('slim', ctx));
  const installed = await readHookConfig(ctx);
  assert.equal(installed.version, 2, 'install never rewrites a foreign version');
  assert.equal(installed.hooks['postToolUse']?.length, 1);

  await applyChanges(await copilotAdapter.uninstall(ctx));
  assert.ok(existsSync(hookConfigFile(ctx)), 'version-2 file kept, not deleted');
  assert.equal(await readFile(hookConfigFile(ctx), 'utf8'), original);
});

test('regression: unknown top-level keys keep the file through uninstall', async () => {
  const ctx = await makeCtx();
  const ourCommand = `${OUR_COPILOT_COMMAND_BASE} --mode slim`;
  const ourEntry = {
    type: 'command',
    bash: ourCommand,
    powershell: ourCommand,
    timeoutSec: 10,
  };
  const original = `${JSON.stringify(
    { version: 1, hooks: { postToolUse: [ourEntry] }, customKey: true },
    null,
    2,
  )}\n`;
  await mkdir(path.dirname(hookConfigFile(ctx)), { recursive: true });
  await writeFile(hookConfigFile(ctx), original, 'utf8');

  await applyChanges(await copilotAdapter.uninstall(ctx));
  assert.ok(existsSync(hookConfigFile(ctx)), 'customKey-bearing file kept');
  assert.equal(
    await readFile(hookConfigFile(ctx), 'utf8'),
    `${JSON.stringify({ version: 1, customKey: true }, null, 2)}\n`,
  );
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
