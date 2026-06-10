import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { PackMode } from '../packs/types.ts';
import { parseAtomManifest, renderMarkedSection } from '../packs/render.ts';
import { copilotHookCommandFrom } from '../paths.ts';
import {
  readMarkedSection,
  removeMarkedSection,
  upsertMarkedSection,
} from './markers.ts';
import type {
  Adapter,
  AdapterContext,
  AdapterStatus,
  FileChange,
} from './types.ts';

// Copilot reads .github/copilot-instructions.md for instructions, and Copilot
// CLI + cloud agent run command hooks from .github/hooks/*.json. Our
// postToolUse entry replaces tool results via modifiedResult.textResultForLlm
// — the same input-compression mechanism as the Claude Code PostToolUse hook.
//
// Honesty notes baked into status:
// - hooks run in Copilot CLI and cloud agent ONLY; the VS Code/IDE surface
//   does not execute these hook files (instructions still apply there)
// - the installed command is `node "<abs path>/dist/copilot-hook.js" ...` —
//   an absolute path on THIS machine. The cloud agent's Linux sandbox (and
//   any teammate's clone of a committed .github/hooks/compressor.json)
//   cannot run it, so compression is effective only in Copilot CLI on the
//   installing machine; elsewhere the entry is a dead command that degrades
//   to a logged fail-open no-op (postToolUse never blocks the agent).
//   Status must not imply a cloud-agent benefit.
// - user-scope hooks (<copilotHome>/hooks/, CLI >= 1.0.21; copilotHome is
//   $COPILOT_HOME when set, else ~/.copilot) load in Copilot CLI only. Global
//   install therefore plans ONLY the hook config there — instructions have no
//   user-global mechanism at all (personal instructions are a github.com web
//   setting), the IDE runs no hook files, and the cloud agent reads only
//   .github/hooks/ on the default branch.
const HOOK_SURFACES_NOTE =
  'compression effective in Copilot CLI on this machine only — the hook command is an absolute local path (a fail-open no-op for cloud agent and teammates; the IDE runs no hook files)';
const HOOK_MISSING_NOTE =
  'instructions only — compression hook not installed (.github/hooks/compressor.json)';
const AGENTS_MD_OVERLAP_NOTE =
  'NOTE: Copilot also reads AGENTS.md — both installed means duplicated instructions';
const GLOBAL_HOOK_NOTE =
  'machine-wide input compression for Copilot CLI on this machine (instructions are per-repo; IDE runs no hook files; cloud agent reads only .github/hooks on the default branch)';
const GLOBAL_CROSS_NOTE = 'installed globally (machine-wide hook)';

/** Our hook config file under .github/hooks/ (any NAME.json is valid). */
const HOOK_CONFIG_FILE = 'compressor.json';

/**
 * postToolUse accepts no matcher, so this command runs after EVERY successful
 * tool call. Compression is local CPU only; cap well below the 30s default so
 * a wedged node process cannot stall the agent. Non-zero/timeout is fail-open.
 */
const HOOK_TIMEOUT_SEC = 10;

function instructionsPath(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, '.github', 'copilot-instructions.md');
}

function hookConfigPath(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, '.github', 'hooks', HOOK_CONFIG_FILE);
}

/**
 * The effective $COPILOT_HOME override, or null when unset (whitespace-only
 * counts as unset). Non-absolute values — including a literal `~`, which Node
 * never expands — are refused: every scope decision (detect/install/uninstall/
 * status) routes through this value, and a relative path would anchor the
 * "machine-wide" hook to whatever directory the command happened to run from
 * (global-to-project scope leakage; an uninstall from any other cwd could
 * never find the file again).
 */
function copilotHomeOverride(): string | null {
  const env = process.env['COPILOT_HOME'];
  if (env === undefined || env.trim() === '') {
    return null;
  }
  if (!path.isAbsolute(env)) {
    throw new Error(
      `COPILOT_HOME=${JSON.stringify(env)} is not an absolute path — refusing to anchor the machine-wide hook to the current directory (~ is not expanded; set an absolute path or unset it, then re-run)`,
    );
  }
  return env;
}

/** $COPILOT_HOME when set (Copilot CLI honors it), else ~/.copilot. */
function copilotHome(ctx: AdapterContext): string {
  return copilotHomeOverride() ?? path.join(ctx.homeDir, '.copilot');
}

function globalHookConfigPath(ctx: AdapterContext): string {
  return path.join(copilotHome(ctx), 'hooks', HOOK_CONFIG_FILE);
}

/** Human form of the global config location for status lines. */
function globalHookConfigDisplay(): string {
  return copilotHomeOverride() !== null
    ? `$COPILOT_HOME/hooks/${HOOK_CONFIG_FILE}`
    : `~/.copilot/hooks/${HOOK_CONFIG_FILE}`;
}

function agentsMdPath(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, 'AGENTS.md');
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? (value as unknown[]) : null;
}

function notTouchingIt(what: string): Error {
  return new Error(
    `${HOOK_CONFIG_FILE} ${what} — not touching it (fix or remove it, then re-run)`,
  );
}

function parseHookConfig(text: string | null): Record<string, unknown> {
  if (text === null) {
    return { version: 1 };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw notTouchingIt('is not valid JSON');
  }
  const record = asRecord(parsed);
  if (record === null) {
    throw notTouchingIt('is not valid JSON');
  }
  // A non-object "hooks" or non-array "postToolUse" (an easy hand-edit
  // mistake) would otherwise be coerced to empty by mergeOurHook and written
  // back as only our entry — silently destroying foreign data. Refuse, same
  // as invalid JSON. (Foreign events keep whatever shape they have; merge
  // never rewrites them.)
  if (record['hooks'] !== undefined) {
    const hooks = asRecord(record['hooks']);
    if (hooks === null) {
      throw notTouchingIt('has a non-object "hooks" value');
    }
    if (hooks['postToolUse'] !== undefined && asArray(hooks['postToolUse']) === null) {
      throw notTouchingIt('has a non-array "hooks.postToolUse" value');
    }
  }
  return { ...record };
}

function detectIndent(original: string | null): string {
  if (original === null) {
    return '  ';
  }
  return /\n([ \t]+)"/.exec(original)?.[1] ?? '  ';
}

function serializeHookConfig(
  config: Record<string, unknown>,
  original: string | null,
): string {
  return `${JSON.stringify(config, null, detectIndent(original))}\n`;
}

function commandBase(command: string): string {
  return command.replace(/ --mode \S+$/, '');
}

/**
 * Base forms we accept as ours: the current command (copilot-hook.js path
 * quoted against spaces) and an unquoted variant (legacy tolerance, mirroring
 * the claude-code predicate).
 */
function ourBases(ourCommand: string): string[] {
  const base = commandBase(ourCommand);
  const unquoted = base.replaceAll('"', '');
  return unquoted === base ? [base] : [base, unquoted];
}

function commandIsOurs(command: unknown, ourCommand: string): boolean {
  if (typeof command !== 'string') {
    return false;
  }
  return (
    command === ourCommand ||
    ourBases(ourCommand).some(
      (base) => command === base || command.startsWith(`${base} --mode `),
    )
  );
}

/**
 * Ownership predicate: exact match on our resolved copilot-hook command in
 * the entry's bash or powershell field, allowing a different --mode value
 * (mode switches rewrite the flag; the absolute path identifies us). Generic
 * substrings like 'dist/copilot-hook.js' are NOT ours.
 */
function isOurHookEntry(entry: unknown, ourCommand: string): boolean {
  const record = asRecord(entry);
  if (record === null) {
    return false;
  }
  return (
    commandIsOurs(record['bash'], ourCommand) ||
    commandIsOurs(record['powershell'], ourCommand)
  );
}

function hookEntryFor(command: string): Record<string, unknown> {
  // both platform keys per the reference docs; node invocation is identical
  return {
    type: 'command',
    bash: command,
    powershell: command,
    timeoutSec: HOOK_TIMEOUT_SEC,
  };
}

/** Replace our postToolUse entry (or append it), preserving foreign entries and events. */
function mergeOurHook(config: Record<string, unknown>, command: string): void {
  const hooks = { ...(asRecord(config['hooks']) ?? {}) };
  const post = asArray(hooks['postToolUse']) ?? [];
  const ourEntry = hookEntryFor(command);
  const next: unknown[] = [];
  let replaced = false;
  for (const entry of post) {
    if (isOurHookEntry(entry, command)) {
      if (!replaced) {
        next.push(ourEntry);
        replaced = true;
      }
    } else {
      next.push(entry);
    }
  }
  if (!replaced) {
    next.push(ourEntry);
  }
  hooks['postToolUse'] = next;
  config['hooks'] = hooks;
  if (config['version'] === undefined) {
    config['version'] = 1;
  }
}

/** Remove only our entries. Returns true when something was removed. */
function stripOurHook(config: Record<string, unknown>, command: string): boolean {
  const hooks = asRecord(config['hooks']);
  const post = asArray(hooks?.['postToolUse']);
  if (hooks === null || post === null) {
    return false;
  }
  const kept = post.filter((entry) => !isOurHookEntry(entry, command));
  if (kept.length === post.length) {
    return false;
  }
  const next = { ...hooks };
  if (kept.length === 0) {
    delete next['postToolUse'];
  } else {
    next['postToolUse'] = kept;
  }
  if (Object.keys(next).length === 0) {
    delete config['hooks'];
  } else {
    config['hooks'] = next;
  }
  return true;
}

/** Nothing left but the schema version ⇒ the file carries no information. */
function onlyVersionLeft(config: Record<string, unknown>): boolean {
  return Object.keys(config).every((key) => key === 'version');
}

/**
 * Plan merging our entry into the hook config at `filePath` (project or
 * global scope — the merge/ownership/foreign-preservation rules are
 * identical; only the path differs).
 */
async function planHookConfigInstall(
  filePath: string,
  command: string,
): Promise<FileChange> {
  const before = await readFileOrNull(filePath);
  const config = parseHookConfig(before);
  mergeOurHook(config, command);
  return { path: filePath, before, after: serializeHookConfig(config, before) };
}

/**
 * Plan stripping our entry from the hook config at `filePath`. Returns null
 * when there is nothing of ours to remove. compressor.json is our namespaced
 * file: once only the version stub remains it is safe to delete; foreign
 * entries/events keep it alive.
 */
async function planHookConfigUninstall(
  filePath: string,
  ourCommand: string,
): Promise<FileChange | null> {
  const before = await readFileOrNull(filePath);
  if (before === null) {
    return null;
  }
  const config = parseHookConfig(before);
  if (!stripOurHook(config, ourCommand)) {
    return null;
  }
  const after = onlyVersionLeft(config)
    ? null
    : serializeHookConfig(config, before);
  return { path: filePath, before, after };
}

interface HookState {
  present: boolean;
  mode: PackMode | null;
}

async function inspectHookAt(
  filePath: string,
  ourCommand: string,
): Promise<HookState> {
  const text = await readFileOrNull(filePath);
  if (text === null) {
    return { present: false, mode: null };
  }
  let config: Record<string, unknown> | null = null;
  try {
    config = parseHookConfig(text);
  } catch {
    config = null; // status never throws on a broken file
  }
  const post = asArray(asRecord(config?.['hooks'])?.['postToolUse']);
  const ours = post?.find((entry) => isOurHookEntry(entry, ourCommand));
  if (ours === undefined) {
    return { present: false, mode: null };
  }
  const bash = asRecord(ours)?.['bash'];
  const flag =
    typeof bash === 'string' ? / --mode (\S+)$/.exec(bash)?.[1] : undefined;
  return {
    present: true,
    mode: flag === 'optimized' || flag === 'slim' ? flag : null,
  };
}

export const copilotAdapter: Adapter = {
  name: 'copilot',

  async detect(ctx: AdapterContext): Promise<boolean> {
    if (ctx.global) {
      return dirExists(copilotHome(ctx));
    }
    return dirExists(path.join(ctx.projectDir, '.github'));
  },

  async install(mode: PackMode, ctx: AdapterContext): Promise<FileChange[]> {
    const command = copilotHookCommandFrom(ctx.hookCommand, mode);

    if (ctx.global) {
      // user-scope hooks load in Copilot CLI only; instructions have no
      // user-global mechanism, so global plans ONLY the hook config — never
      // an instructions change.
      const change = await planHookConfigInstall(
        globalHookConfigPath(ctx),
        command,
      );
      return change.before === change.after ? [] : [change];
    }

    const changes: FileChange[] = [];

    const file = instructionsPath(ctx);
    const before = await readFileOrNull(file);
    const after = upsertMarkedSection(
      before,
      renderMarkedSection(mode, 'copilot').body,
    );
    changes.push({ path: file, before, after });

    changes.push(await planHookConfigInstall(hookConfigPath(ctx), command));

    return changes.filter((change) => change.before !== change.after);
  },

  async uninstall(ctx: AdapterContext): Promise<FileChange[]> {
    const ourCommand = copilotHookCommandFrom(ctx.hookCommand);

    if (ctx.global) {
      const change = await planHookConfigUninstall(
        globalHookConfigPath(ctx),
        ourCommand,
      );
      return change === null ? [] : [change];
    }

    const changes: FileChange[] = [];

    const file = instructionsPath(ctx);
    const before = await readFileOrNull(file);
    if (before !== null && readMarkedSection(before) !== null) {
      // Never delete the file: whether WE created it is not derivable from
      // disk (a user-created empty file that received our section is
      // byte-identical to one we created), so err KEEP — worst case an empty
      // file remains. Matches the cursor .cursorrules precedent.
      changes.push({ path: file, before, after: removeMarkedSection(before) });
    }

    const hookChange = await planHookConfigUninstall(
      hookConfigPath(ctx),
      ourCommand,
    );
    if (hookChange !== null) {
      changes.push(hookChange);
    }

    return changes;
  },

  async status(ctx: AdapterContext): Promise<AdapterStatus> {
    const ourCommand = copilotHookCommandFrom(ctx.hookCommand);
    const globalHook = await inspectHookAt(
      globalHookConfigPath(ctx),
      ourCommand,
    );

    if (ctx.global) {
      if (!globalHook.present) {
        return { agent: 'copilot', installed: false, detail: 'not installed' };
      }
      return {
        agent: 'copilot',
        installed: true,
        ...(globalHook.mode !== null ? { mode: globalHook.mode } : {}),
        detail: `${globalHookConfigDisplay()} (global) — ${GLOBAL_HOOK_NOTE}`,
      };
    }

    const body = await readFileOrNull(instructionsPath(ctx));
    const section = body === null ? null : readMarkedSection(body);
    const hook = await inspectHookAt(hookConfigPath(ctx), ourCommand);
    if (section === null && !hook.present) {
      if (globalHook.present) {
        // scope-faithful: nothing at project level, but the machine-wide
        // hook still compresses Copilot CLI input here (claude-code's
        // cross-scope note pattern)
        return {
          agent: 'copilot',
          installed: true,
          ...(globalHook.mode !== null ? { mode: globalHook.mode } : {}),
          detail: `not installed (project); ${GLOBAL_CROSS_NOTE}`,
        };
      }
      return { agent: 'copilot', installed: false, detail: 'not installed' };
    }

    const mode =
      (section === null ? undefined : parseAtomManifest(section)?.mode) ??
      hook.mode ??
      globalHook.mode ??
      undefined;

    let detail: string;
    if (section !== null && hook.present) {
      detail = `.github/copilot-instructions.md section + .github/hooks/${HOOK_CONFIG_FILE} (project) — instructions + input compression (Copilot hooks); ${HOOK_SURFACES_NOTE}`;
    } else if (section !== null) {
      detail = `.github/copilot-instructions.md section (project) — ${HOOK_MISSING_NOTE}`;
    } else {
      detail = `.github/hooks/${HOOK_CONFIG_FILE} (project) — input compression only, instructions not installed; ${HOOK_SURFACES_NOTE}`;
    }
    if (section !== null) {
      const agentsMd = await readFileOrNull(agentsMdPath(ctx));
      if (agentsMd !== null && readMarkedSection(agentsMd) !== null) {
        detail += `; ${AGENTS_MD_OVERLAP_NOTE}`;
      }
    }
    if (globalHook.present) {
      detail += `; also ${GLOBAL_CROSS_NOTE}`;
    }

    return {
      agent: 'copilot',
      installed: true,
      ...(mode !== undefined ? { mode } : {}),
      detail,
    };
  },
};
