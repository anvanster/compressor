import { mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileChange } from './types.ts';

/**
 * Dir names that bound upward pruning. A deleted config under one of these
 * may leave dirs our install created (e.g. <home>/.copilot/hooks/ after a
 * global copilot uninstall — an empty hooks dir flips detect() to true
 * forever); a foreign file anywhere in the chain makes rmdir fail and stops
 * the climb, so pre-existing dirs survive.
 */
const PRUNE_BOUNDARIES = ['.claude', '.copilot'];

/** Remove now-empty dirs left after a delete, climbing no higher than the owning boundary segment. */
async function pruneEmptyOwnedDirs(filePath: string): Promise<void> {
  const segments = path.dirname(filePath).split(path.sep);
  const boundary = PRUNE_BOUNDARIES.find((name) => segments.includes(name));
  if (boundary === undefined) {
    return;
  }
  let dir = path.dirname(filePath);
  while (dir.split(path.sep).includes(boundary)) {
    try {
      await rmdir(dir);
    } catch {
      return;
    }
    if (path.basename(dir) === boundary) {
      return;
    }
    dir = path.dirname(dir);
  }
}

export async function applyChanges(changes: FileChange[]): Promise<void> {
  for (const change of changes) {
    if (change.after === null) {
      await rm(change.path, { force: true });
      await pruneEmptyOwnedDirs(change.path);
    } else {
      await mkdir(path.dirname(change.path), { recursive: true });
      await writeFile(change.path, change.after, 'utf8');
    }
  }
}

function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

interface DiffParts {
  prefixLen: number;
  removed: string[];
  added: string[];
}

function diffParts(before: string[], after: string[]): DiffParts {
  const max = Math.min(before.length, after.length);
  let prefixLen = 0;
  while (prefixLen < max && before[prefixLen] === after[prefixLen]) {
    prefixLen += 1;
  }
  let suffixLen = 0;
  while (
    suffixLen < max - prefixLen &&
    before[before.length - 1 - suffixLen] === after[after.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }
  return {
    prefixLen,
    removed: before.slice(prefixLen, before.length - suffixLen),
    added: after.slice(prefixLen, after.length - suffixLen),
  };
}

const DIFF_CONTEXT = 2;
const DIFF_BODY_MAX_LINES = 200;
/** Created files print their full body below this many lines… */
const CREATE_BODY_MAX_LINES = 80;
/** …and are capped at this many head lines plus a remainder count above it. */
const CREATE_BODY_HEAD_LINES = 40;

export function renderChanges(changes: FileChange[]): string {
  const out: string[] = [];
  for (const change of changes) {
    const beforeLines = change.before === null ? [] : splitLines(change.before);
    const afterLines = change.after === null ? [] : splitLines(change.after);
    if (change.after === null) {
      out.push(`delete ${change.path} (+0/-${beforeLines.length})`);
      continue;
    }
    if (change.before === null) {
      out.push(`create ${change.path} (+${afterLines.length}/-0)`);
      // the body IS what the user is approving — show it (capped when long)
      if (afterLines.length < CREATE_BODY_MAX_LINES) {
        out.push(...afterLines.map((line) => `  ${line}`));
      } else {
        out.push(
          ...afterLines
            .slice(0, CREATE_BODY_HEAD_LINES)
            .map((line) => `  ${line}`),
          `  … (${afterLines.length - CREATE_BODY_HEAD_LINES} more lines)`,
        );
      }
      continue;
    }
    const { prefixLen, removed, added } = diffParts(beforeLines, afterLines);
    out.push(`update ${change.path} (+${added.length}/-${removed.length})`);
    if (
      beforeLines.length < DIFF_BODY_MAX_LINES &&
      afterLines.length < DIFF_BODY_MAX_LINES
    ) {
      const suffixStart = prefixLen + removed.length;
      out.push(
        ...beforeLines
          .slice(Math.max(0, prefixLen - DIFF_CONTEXT), prefixLen)
          .map((line) => `  ${line}`),
        ...removed.map((line) => `- ${line}`),
        ...added.map((line) => `+ ${line}`),
        ...beforeLines
          .slice(suffixStart, suffixStart + DIFF_CONTEXT)
          .map((line) => `  ${line}`),
      );
    }
  }
  return out.join('\n');
}
