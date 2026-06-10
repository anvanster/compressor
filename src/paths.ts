import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PackMode } from './packs/types.ts';

function isCompressorRoot(dir: string): boolean {
  const pkgPath = path.join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Record<string, unknown>)['name'] === 'compressor'
    );
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

function hookCommandFor(mode: PackMode, root: string): string {
  // quoted so the command survives package roots containing spaces
  return `node "${path.join(root, 'dist', 'hook.js')}" --mode ${mode}`;
}

/**
 * Hook command for ownership matching in status/uninstall — must work even
 * when the bundle is missing (e.g. uninstalling a broken install).
 */
export function describeHookCommand(mode: PackMode, root: string = packageRoot()): string {
  return hookCommandFor(mode, root);
}

/**
 * Command line installed for the PostToolUse hook. Refuses to install a
 * command that would fail on every tool call (fail-open hook = silent no-op).
 */
export function resolveHookCommand(mode: PackMode, root: string = packageRoot()): string {
  const hookPath = path.join(root, 'dist', 'hook.js');
  if (!existsSync(hookPath)) {
    throw new Error(
      `hook bundle missing at ${hookPath} — run 'npm run build' in the compressor package, then re-run`,
    );
  }
  return hookCommandFor(mode, root);
}

function copilotHookCommandFor(mode: PackMode, root: string): string {
  // quoted so the command survives package roots containing spaces
  return `node "${path.join(root, 'dist', 'copilot-hook.js')}" --mode ${mode}`;
}

/** Copilot hook command for display/matching — works without the bundle. */
export function describeCopilotHookCommand(
  mode: PackMode,
  root: string = packageRoot(),
): string {
  return copilotHookCommandFor(mode, root);
}

/**
 * Command line installed for the Copilot postToolUse hook. Like
 * resolveHookCommand, refuses to install a command that would fail on every
 * tool call (Copilot postToolUse is fail-open: a dead command = silent no-op).
 */
export function resolveCopilotHookCommand(
  mode: PackMode,
  root: string = packageRoot(),
): string {
  const hookPath = path.join(root, 'dist', 'copilot-hook.js');
  if (!existsSync(hookPath)) {
    throw new Error(
      `copilot hook bundle missing at ${hookPath} — run 'npm run build' in the compressor package, then re-run`,
    );
  }
  return copilotHookCommandFor(mode, root);
}

/**
 * Copilot hook command derived from the Claude Code hook command carried in
 * AdapterContext (the only resolved-path carrier adapters receive; the
 * adapters/types.ts contract is frozen). Both commands are generated in this
 * module from the same root, so swapping the sibling bundle name and --mode
 * flag reproduces copilotHookCommandFor exactly. Mode omitted → base form
 * for ownership matching (mode-agnostic, like claude-code's predicate).
 */
export function copilotHookCommandFrom(hookCommand: string, mode?: PackMode): string {
  const base = hookCommand
    .replace(/ --mode \S+$/, '')
    .replace(/(?<![\w-])hook\.js("?)$/, 'copilot-hook.js$1');
  return mode === undefined ? base : `${base} --mode ${mode}`;
}
