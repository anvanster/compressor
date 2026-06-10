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
