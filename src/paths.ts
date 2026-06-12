import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PackMode } from './packs/types.ts';

export function isCompressorRoot(dir: string): boolean {
  const pkgPath = path.join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }
    const pkg = parsed as Record<string, unknown>;
    // Identify our package by the `compressor` bin, not its name — survives the
    // unscoped→@astudioplus/compressor rename and any future scope change. The
    // name check is a belt-and-suspenders fallback.
    const bin = pkg['bin'];
    if (typeof bin === 'object' && bin !== null && 'compressor' in bin) {
      return true;
    }
    const name = pkg['name'];
    return name === 'compressor' || name === '@astudioplus/compressor';
  } catch {
    return false;
  }
}

export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (isCompressorRoot(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('could not locate the compressor package root from ' + import.meta.url);
    }
    dir = parent;
  }
}

/**
 * How an installed hook command addresses the bundle:
 * - 'absolute': `node "<root>/dist/hook.js" --mode X` — always works on this
 *   machine, breaks on relocation and is a dead command for anyone else.
 * - 'relocatable': `compressor-hook --mode X` — the package.json bin on PATH;
 *   works wherever @astudioplus/compressor is installed (committable).
 */
export type HookCommandStyle = 'absolute' | 'relocatable';

/** package.json bin names for the bundles (the hot path skips the CLI/commander). */
export const HOOK_BIN = 'compressor-hook';
export const COPILOT_HOOK_BIN = 'compressor-copilot-hook';

/**
 * Does `binName` resolve on PATH? `command -v` is POSIX and requires the hit
 * to be executable. Any failure (no /bin/sh — e.g. Windows — empty PATH, or
 * a plain miss) is "no"; callers fall back to the absolute style (fail-safe).
 * Resolving to a DIFFERENT install of the same package is fine: same product.
 */
function resolvesOnPath(binName: string): boolean {
  try {
    const out = execFileSync('/bin/sh', ['-c', `command -v ${binName}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() !== '';
  } catch {
    return false;
  }
}

/**
 * Which command style to install:
 * - source checkout (src/cli/index.ts under root) → 'absolute': dogfooding
 *   tracks the dev build; a PATH bin would silently run a stale npm install.
 * - npm-installed layout (dist only) → 'relocatable' IF compressor-hook
 *   actually resolves on PATH; otherwise 'absolute'.
 * Any error → 'absolute' (an absolute command always works on this machine).
 */
export function detectHookCommandStyle(root: string = packageRoot()): HookCommandStyle {
  try {
    if (existsSync(path.join(root, 'src', 'cli', 'index.ts'))) {
      return 'absolute';
    }
    return resolvesOnPath(HOOK_BIN) ? 'relocatable' : 'absolute';
  } catch {
    return 'absolute';
  }
}

function notOnPathError(binName: string): Error {
  return new Error(
    `relocatable hook command requested but '${binName}' does not resolve on PATH — ` +
      `install the package globally (npm install -g @astudioplus/compressor) or use --hook-command absolute`,
  );
}

function hookCommandFor(mode: PackMode, root: string, style: HookCommandStyle): string {
  if (style === 'relocatable') {
    return `${HOOK_BIN} --mode ${mode}`;
  }
  // quoted so the command survives package roots containing spaces
  return `node "${path.join(root, 'dist', 'hook.js')}" --mode ${mode}`;
}

/**
 * Hook command for ownership matching in status/uninstall — must work even
 * when the bundle is missing (e.g. uninstalling a broken install). Callers
 * matching a specific form pass the style explicitly.
 */
export function describeHookCommand(
  mode: PackMode,
  root: string = packageRoot(),
  style: HookCommandStyle = detectHookCommandStyle(root),
): string {
  return hookCommandFor(mode, root, style);
}

/**
 * Command line installed for the PostToolUse hook. Refuses to install a
 * command that would fail on every tool call (fail-open hook = silent no-op):
 * absolute requires the local bundle, relocatable requires the PATH bin.
 */
export function resolveHookCommand(
  mode: PackMode,
  root: string = packageRoot(),
  style: HookCommandStyle = detectHookCommandStyle(root),
): string {
  if (style === 'relocatable') {
    if (!resolvesOnPath(HOOK_BIN)) {
      throw notOnPathError(HOOK_BIN);
    }
    return hookCommandFor(mode, root, style);
  }
  const hookPath = path.join(root, 'dist', 'hook.js');
  if (!existsSync(hookPath)) {
    throw new Error(
      `hook bundle missing at ${hookPath} — run 'npm run build' in the compressor package, then re-run`,
    );
  }
  return hookCommandFor(mode, root, style);
}

function copilotHookCommandFor(mode: PackMode, root: string, style: HookCommandStyle): string {
  if (style === 'relocatable') {
    return `${COPILOT_HOOK_BIN} --mode ${mode}`;
  }
  // quoted so the command survives package roots containing spaces
  return `node "${path.join(root, 'dist', 'copilot-hook.js')}" --mode ${mode}`;
}

/** Copilot hook command for display/matching — works without the bundle. */
export function describeCopilotHookCommand(
  mode: PackMode,
  root: string = packageRoot(),
  style: HookCommandStyle = detectHookCommandStyle(root),
): string {
  return copilotHookCommandFor(mode, root, style);
}

/**
 * Command line installed for the Copilot postToolUse hook. Like
 * resolveHookCommand, refuses to install a command that would fail on every
 * tool call (Copilot postToolUse is fail-open: a dead command = silent no-op).
 */
export function resolveCopilotHookCommand(
  mode: PackMode,
  root: string = packageRoot(),
  style: HookCommandStyle = detectHookCommandStyle(root),
): string {
  if (style === 'relocatable') {
    if (!resolvesOnPath(COPILOT_HOOK_BIN)) {
      throw notOnPathError(COPILOT_HOOK_BIN);
    }
    return copilotHookCommandFor(mode, root, style);
  }
  const hookPath = path.join(root, 'dist', 'copilot-hook.js');
  if (!existsSync(hookPath)) {
    throw new Error(
      `copilot hook bundle missing at ${hookPath} — run 'npm run build' in the compressor package, then re-run`,
    );
  }
  return copilotHookCommandFor(mode, root, style);
}

/**
 * Copilot hook command derived from the Claude Code hook command carried in
 * AdapterContext (the only resolved-path carrier adapters receive; the
 * adapters/types.ts contract is frozen). Both commands are generated in this
 * module from the same root and style, so swapping the sibling bundle name
 * (absolute form) or the sibling bin name (relocatable form) and the --mode
 * flag reproduces copilotHookCommandFor exactly. Mode omitted → base form
 * for ownership matching (mode-agnostic, like claude-code's predicate).
 */
export function copilotHookCommandFrom(hookCommand: string, mode?: PackMode): string {
  const base = hookCommand
    .replace(/ --mode \S+$/, '')
    .replace(/(?<![\w-])hook\.js("?)$/, 'copilot-hook.js$1')
    .replace(/^compressor-hook$/, COPILOT_HOOK_BIN);
  return mode === undefined ? base : `${base} --mode ${mode}`;
}
