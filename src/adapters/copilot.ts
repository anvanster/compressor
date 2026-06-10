import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
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
// - ~/.copilot/hooks (user scope) exists since CLI v1.0.40 but is CLI-only
//   and instructions have no user-global mechanism at all, so compressor
//   installs at project scope only
const HOOK_SURFACES_NOTE =
  'compression effective in Copilot CLI on this machine only — the hook command is an absolute local path (a fail-open no-op for cloud agent and teammates; the IDE runs no hook files)';
const HOOK_MISSING_NOTE =
  'instructions only — compression hook not installed (.github/hooks/compressor.json)';
const AGENTS_MD_OVERLAP_NOTE =
  'NOTE: Copilot also reads AGENTS.md — both installed means duplicated instructions';

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

interface HookState {
  present: boolean;
  mode: PackMode | null;
}

async function inspectHook(ctx: AdapterContext): Promise<HookState> {
  const text = await readFileOrNull(hookConfigPath(ctx));
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
  const ourCommand = copilotHookCommandFrom(ctx.hookCommand);
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
    return dirExists(path.join(ctx.projectDir, '.github'));
  },

  async install(mode: PackMode, ctx: AdapterContext): Promise<FileChange[]> {
    if (ctx.global) {
      // ~/.copilot/hooks exists (CLI-only, v1.0.40+) but instructions have no
      // user-global mechanism and the cloud agent only reads .github/hooks/,
      // so compressor stays project-scoped for copilot.
      throw new Error(
        'copilot: no user-global instruction mechanism; use project scope',
      );
    }
    const changes: FileChange[] = [];

    const file = instructionsPath(ctx);
    const before = await readFileOrNull(file);
    const after = upsertMarkedSection(
      before,
      renderMarkedSection(mode, 'copilot').body,
    );
    changes.push({ path: file, before, after });

    const command = copilotHookCommandFrom(ctx.hookCommand, mode);
    const hookFile = hookConfigPath(ctx);
    const hookBefore = await readFileOrNull(hookFile);
    const config = parseHookConfig(hookBefore);
    mergeOurHook(config, command);
    changes.push({
      path: hookFile,
      before: hookBefore,
      after: serializeHookConfig(config, hookBefore),
    });

    return changes.filter((change) => change.before !== change.after);
  },

  async uninstall(ctx: AdapterContext): Promise<FileChange[]> {
    if (ctx.global) {
      // install refuses global scope, so nothing of ours can exist there
      return [];
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

    const hookFile = hookConfigPath(ctx);
    const hookBefore = await readFileOrNull(hookFile);
    if (hookBefore !== null) {
      const config = parseHookConfig(hookBefore);
      const ourCommand = copilotHookCommandFrom(ctx.hookCommand);
      if (stripOurHook(config, ourCommand)) {
        // compressor.json is our namespaced file: once only the version stub
        // remains it is safe to delete; foreign entries/events keep it alive.
        const after = onlyVersionLeft(config)
          ? null
          : serializeHookConfig(config, hookBefore);
        changes.push({ path: hookFile, before: hookBefore, after });
      }
    }

    return changes;
  },

  async status(ctx: AdapterContext): Promise<AdapterStatus> {
    const body = await readFileOrNull(instructionsPath(ctx));
    const section = body === null ? null : readMarkedSection(body);
    const hook = await inspectHook(ctx);
    if (section === null && !hook.present) {
      return { agent: 'copilot', installed: false, detail: 'not installed' };
    }

    const mode =
      (section === null ? undefined : parseAtomManifest(section)?.mode) ??
      hook.mode ??
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

    return {
      agent: 'copilot',
      installed: true,
      ...(mode !== undefined ? { mode } : {}),
      detail,
    };
  },
};
