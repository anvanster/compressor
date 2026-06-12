import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PackMode } from '../packs/types.ts';
import { parseAtomManifest, renderOutputStyle } from '../packs/render.ts';
import { HOOK_BIN, describeHookCommand } from '../paths.ts';
import type {
  Adapter,
  AdapterContext,
  AdapterStatus,
  FileChange,
} from './types.ts';

const PACK_MODES: readonly PackMode[] = ['optimized', 'slim'];

const SETTINGS_FILE = 'settings.json';
const LOCAL_SETTINGS_FILE = 'settings.local.json';

function invalidSettingsError(fileName: string): string {
  return `${fileName} is not valid JSON — not touching it (fix or remove it, then re-run)`;
}

const HOOK_MATCHER = 'Read|Bash|Grep|Glob';

function isPackMode(value: string): value is PackMode {
  return value === 'optimized' || value === 'slim';
}

function scopeRoot(ctx: AdapterContext, global: boolean): string {
  return global ? ctx.homeDir : ctx.projectDir;
}

function stylePath(root: string, mode: PackMode): string {
  return path.join(root, '.claude', 'output-styles', `compressor-${mode}.md`);
}

function settingsPath(root: string): string {
  return path.join(root, '.claude', SETTINGS_FILE);
}

/**
 * Where the hook entry lives. Project-scope settings.json is the SHARED file
 * (conventionally committed); the hook command is machine-specific — an
 * absolute path, or a PATH bin teammates may not have installed — so at
 * project scope it goes into settings.local.json.
 * Global scope (~/.claude) is personal — settings.json holds everything.
 */
function hookSettingsPath(root: string, global: boolean): string {
  return global ? settingsPath(root) : path.join(root, '.claude', LOCAL_SETTINGS_FILE);
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

function parseSettings(
  text: string | null,
  fileName: string = SETTINGS_FILE,
): Record<string, unknown> {
  if (text === null) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(invalidSettingsError(fileName));
  }
  const record = asRecord(parsed);
  if (record === null) {
    throw new Error(invalidSettingsError(fileName));
  }
  return { ...record };
}

function detectIndent(original: string | null): string {
  if (original === null) {
    return '  ';
  }
  return /\n([ \t]+)"/.exec(original)?.[1] ?? '  ';
}

function serializeSettings(
  settings: Record<string, unknown>,
  original: string | null,
): string {
  return `${JSON.stringify(settings, null, detectIndent(original))}\n`;
}

function hookCommandBase(hookCommand: string): string {
  return hookCommand.replace(/ --mode \S+$/, '');
}

/**
 * Base forms we accept as ours: the context's command (whatever style the
 * caller resolved), its legacy unquoted variant, and THIS install's absolute
 * form (upgrade path: an entry written by an older absolute-style install at
 * this root must be claimed when the context now carries the relocatable
 * command — and vice versa). An absolute entry pointing at some OTHER root is
 * not distinguishable from a foreign tool's hook, so it is never claimed.
 */
function ourBases(hookCommand: string): string[] {
  const bases = new Set<string>();
  const add = (command: string): void => {
    const base = hookCommandBase(command);
    bases.add(base);
    bases.add(base.replaceAll('"', '')); // legacy unquoted form
  };
  add(hookCommand);
  try {
    add(describeHookCommand('optimized', undefined, 'absolute')); // mode is stripped
  } catch {
    // package root unresolvable — the context command still identifies us
  }
  return [...bases];
}

/**
 * Relocatable (PATH bin) form is ours regardless of the context's style, at
 * the word boundary: `compressor-hook` exactly or `compressor-hook <args>` —
 * never `compressor-hooks` or `my-compressor-hook`.
 */
function isRelocatableOurs(command: string): boolean {
  return command === HOOK_BIN || command.startsWith(`${HOOK_BIN} `);
}

/**
 * Ownership predicate: exact match on our resolved hook command, allowing a
 * different --mode value (mode switches rewrite the flag; the absolute path
 * or our PATH bin name identifies us). Generic substrings like 'dist/hook.js'
 * are NOT ours — other tools use the same bundling layout.
 */
function isOurHookEntry(entry: unknown, hookCommand: string): boolean {
  const record = asRecord(entry);
  const hooks = asArray(record?.hooks);
  if (hooks === null) {
    return false;
  }
  const bases = ourBases(hookCommand);
  return hooks.some((hook) => {
    const command = asRecord(hook)?.command;
    if (typeof command !== 'string') {
      return false;
    }
    return (
      command === hookCommand ||
      isRelocatableOurs(command) ||
      bases.some(
        (base) => command === base || command.startsWith(`${base} --mode `),
      )
    );
  });
}

function mergeHookEntry(
  settings: Record<string, unknown>,
  hookCommand: string,
): void {
  const ourEntry = {
    matcher: HOOK_MATCHER,
    hooks: [{ type: 'command', command: hookCommand }],
  };
  const hooks = { ...(asRecord(settings.hooks) ?? {}) };
  const post = asArray(hooks.PostToolUse) ?? [];
  const next: unknown[] = [];
  let replaced = false;
  for (const entry of post) {
    if (isOurHookEntry(entry, hookCommand)) {
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
  hooks.PostToolUse = next;
  settings.hooks = hooks;
}

function stripOurHooks(
  settings: Record<string, unknown>,
  hookCommand: string,
): void {
  const hooks = asRecord(settings.hooks);
  const post = asArray(hooks?.PostToolUse);
  if (hooks === null || post === null) {
    return;
  }
  const kept = post.filter((entry) => !isOurHookEntry(entry, hookCommand));
  if (kept.length === post.length) {
    return;
  }
  const next = { ...hooks };
  if (kept.length === 0) {
    delete next.PostToolUse;
  } else {
    next.PostToolUse = kept;
  }
  if (Object.keys(next).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = next;
  }
}

function stripOurSettings(
  settings: Record<string, unknown>,
  hookCommand: string,
  priorStyle: string | null,
): void {
  if (
    typeof settings.outputStyle === 'string' &&
    settings.outputStyle.startsWith('compressor-')
  ) {
    if (priorStyle !== null) {
      settings.outputStyle = priorStyle;
    } else {
      delete settings.outputStyle;
    }
  }
  stripOurHooks(settings, hookCommand);
}

// A pre-existing foreign outputStyle is stashed in our style file (an
// artifact we own) so uninstall can restore it instead of deleting it.
const PRIOR_STYLE_RE = /<!-- compressor:prior-output-style (.*) -->/;

function stashPriorStyle(body: string, prior: string | null): string {
  if (prior === null) {
    return body;
  }
  return `${body}<!-- compressor:prior-output-style ${JSON.stringify(prior)} -->\n`;
}

function priorStyleFrom(body: string | null): string | null {
  if (body === null) {
    return null;
  }
  const raw = PRIOR_STYLE_RE.exec(body)?.[1];
  if (raw === undefined) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

interface ScopeArtifacts {
  styleMode: PackMode | null;
  settingsMode: PackMode | null;
  hookPresent: boolean;
}

function hasArtifacts(artifacts: ScopeArtifacts): boolean {
  return artifacts.styleMode !== null || artifacts.settingsMode !== null;
}

async function hasOurHook(
  filePath: string,
  fileName: string,
  hookCommand: string,
): Promise<boolean> {
  const text = await readFileOrNull(filePath);
  if (text === null) {
    return false;
  }
  let settings: Record<string, unknown> | null = null;
  try {
    settings = parseSettings(text, fileName);
  } catch {
    settings = null;
  }
  const post = asArray(asRecord(settings?.hooks)?.PostToolUse);
  return post?.some((entry) => isOurHookEntry(entry, hookCommand)) ?? false;
}

async function inspectScope(
  root: string,
  global: boolean,
  hookCommand: string,
): Promise<ScopeArtifacts> {
  let styleMode: PackMode | null = null;
  for (const mode of PACK_MODES) {
    const body = await readFileOrNull(stylePath(root, mode));
    if (body !== null) {
      styleMode = parseAtomManifest(body)?.mode ?? mode;
      break;
    }
  }
  let settingsMode: PackMode | null = null;
  const text = await readFileOrNull(settingsPath(root));
  if (text !== null) {
    let settings: Record<string, unknown> | null = null;
    try {
      settings = parseSettings(text);
    } catch {
      settings = null;
    }
    if (settings !== null) {
      const outputStyle = settings.outputStyle;
      if (
        typeof outputStyle === 'string' &&
        outputStyle.startsWith('compressor-')
      ) {
        const mode = outputStyle.slice('compressor-'.length);
        if (isPackMode(mode)) {
          settingsMode = mode;
        }
      }
    }
  }
  let hookPresent = await hasOurHook(
    hookSettingsPath(root, global),
    global ? SETTINGS_FILE : LOCAL_SETTINGS_FILE,
    hookCommand,
  );
  if (!hookPresent && !global) {
    hookPresent = await hasOurHook(settingsPath(root), SETTINGS_FILE, hookCommand);
  }
  return { styleMode, settingsMode, hookPresent };
}

export const claudeCodeAdapter: Adapter = {
  name: 'claude-code',

  async detect(ctx: AdapterContext): Promise<boolean> {
    if (await dirExists(path.join(scopeRoot(ctx, ctx.global), '.claude'))) {
      return true;
    }
    if (await dirExists(path.join(scopeRoot(ctx, !ctx.global), '.claude'))) {
      return true;
    }
    // Claude Code is the primary target: project scope always detects in v1.
    return !ctx.global;
  },

  async install(mode: PackMode, ctx: AdapterContext): Promise<FileChange[]> {
    const root = scopeRoot(ctx, ctx.global);
    const changes: FileChange[] = [];

    const styleFile = stylePath(root, mode);
    const styleBefore = await readFileOrNull(styleFile);

    const otherMode: PackMode = mode === 'slim' ? 'optimized' : 'slim';
    const otherFile = stylePath(root, otherMode);
    const otherBefore = await readFileOrNull(otherFile);

    const settingsFile = settingsPath(root);
    const settingsBefore = await readFileOrNull(settingsFile);
    const settings = parseSettings(settingsBefore);

    // Preserve a pre-existing foreign outputStyle (or one already stashed by
    // a previous install) so uninstall can restore it.
    const currentStyle =
      typeof settings.outputStyle === 'string' ? settings.outputStyle : null;
    const foreignStyle =
      currentStyle !== null && !currentStyle.startsWith('compressor-')
        ? currentStyle
        : null;
    const prior =
      foreignStyle ?? priorStyleFrom(styleBefore) ?? priorStyleFrom(otherBefore);

    changes.push({
      path: styleFile,
      before: styleBefore,
      after: stashPriorStyle(renderOutputStyle(mode).body, prior),
    });
    if (otherBefore !== null) {
      changes.push({ path: otherFile, before: otherBefore, after: null });
    }

    settings.outputStyle = `compressor-${mode}`;
    if (ctx.global) {
      mergeHookEntry(settings, ctx.hookCommand);
    } else {
      // shared settings.json must never carry our machine-specific command
      stripOurHooks(settings, ctx.hookCommand);
      const localFile = hookSettingsPath(root, false);
      const localBefore = await readFileOrNull(localFile);
      const local = parseSettings(localBefore, LOCAL_SETTINGS_FILE);
      mergeHookEntry(local, ctx.hookCommand);
      changes.push({
        path: localFile,
        before: localBefore,
        after: serializeSettings(local, localBefore),
      });
    }
    changes.push({
      path: settingsFile,
      before: settingsBefore,
      after: serializeSettings(settings, settingsBefore),
    });

    return changes.filter((change) => change.before !== change.after);
  },

  async uninstall(ctx: AdapterContext): Promise<FileChange[]> {
    const root = scopeRoot(ctx, ctx.global);
    const changes: FileChange[] = [];

    let priorStyle: string | null = null;
    for (const mode of PACK_MODES) {
      const file = stylePath(root, mode);
      const before = await readFileOrNull(file);
      if (before !== null) {
        priorStyle ??= priorStyleFrom(before);
        changes.push({ path: file, before, after: null });
      }
    }

    const settingsFile = settingsPath(root);
    const settingsBefore = await readFileOrNull(settingsFile);
    if (settingsBefore !== null) {
      const settings = parseSettings(settingsBefore);
      stripOurSettings(settings, ctx.hookCommand, priorStyle);
      const after =
        Object.keys(settings).length === 0
          ? null
          : serializeSettings(settings, settingsBefore);
      if (after !== settingsBefore) {
        changes.push({ path: settingsFile, before: settingsBefore, after });
      }
    }

    if (!ctx.global) {
      const localFile = hookSettingsPath(root, false);
      const localBefore = await readFileOrNull(localFile);
      if (localBefore !== null) {
        const local = parseSettings(localBefore, LOCAL_SETTINGS_FILE);
        stripOurHooks(local, ctx.hookCommand);
        const after =
          Object.keys(local).length === 0
            ? null
            : serializeSettings(local, localBefore);
        if (after !== localBefore) {
          changes.push({ path: localFile, before: localBefore, after });
        }
      }
    }

    return changes;
  },

  async status(ctx: AdapterContext): Promise<AdapterStatus> {
    const primary = await inspectScope(
      scopeRoot(ctx, ctx.global),
      ctx.global,
      ctx.hookCommand,
    );
    const secondary = await inspectScope(
      scopeRoot(ctx, !ctx.global),
      !ctx.global,
      ctx.hookCommand,
    );
    const primaryLabel = ctx.global ? 'global' : 'project';
    const secondaryWhere = ctx.global ? 'at project level' : 'globally';

    const primaryInstalled = hasArtifacts(primary);
    const secondaryInstalled = hasArtifacts(secondary);
    const mode =
      primary.styleMode ??
      primary.settingsMode ??
      secondary.styleMode ??
      secondary.settingsMode ??
      undefined;

    let detail: string;
    if (primaryInstalled) {
      const parts: string[] = [];
      const primaryMode = primary.styleMode ?? primary.settingsMode;
      if (primaryMode !== null) {
        parts.push(`output style (${primaryMode})`);
      }
      if (primary.hookPresent) {
        parts.push('hook installed');
      }
      detail = `${parts.join(' + ')} (${primaryLabel})`;
      if (secondaryInstalled) {
        detail += `; also installed ${secondaryWhere}`;
      }
    } else if (secondaryInstalled) {
      detail = `not installed (${primaryLabel}); installed ${secondaryWhere}`;
    } else {
      detail = 'not installed';
    }

    return {
      agent: 'claude-code',
      installed: primaryInstalled || secondaryInstalled,
      ...(mode !== undefined ? { mode } : {}),
      detail,
    };
  },
};
