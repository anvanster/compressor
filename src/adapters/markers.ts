import { MARKER_BEGIN_PREFIX, MARKER_END } from '../packs/render.ts';

interface Span {
  start: number;
  end: number;
}

const FENCE_RE = /^\s*(?:`{3,}|~{3,})/;

/**
 * Locate our marked section, ignoring marker text inside fenced code blocks
 * (a user may document the markers verbatim in a ``` example).
 */
function findSpan(lines: readonly string[]): Span | null {
  let inFence = false;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    if (start === -1) {
      if (line.trimStart().startsWith(MARKER_BEGIN_PREFIX)) {
        start = i;
      }
    } else if (line.trim() === MARKER_END) {
      return { start, end: i };
    }
  }
  return null;
}

function asBlock(section: string): string {
  return section.endsWith('\n') ? section.slice(0, -1) : section;
}

/**
 * Replace the compressor section in place if present; else append with exactly
 * one blank line of separation. Bytes outside the markers are never modified.
 */
export function upsertMarkedSection(
  existing: string | null,
  section: string,
): string {
  const block = asBlock(section);
  if (existing === null) {
    return `${block}\n`;
  }
  const lines = existing.split('\n');
  const span = findSpan(lines);
  if (span !== null) {
    return [
      ...lines.slice(0, span.start),
      ...block.split('\n'),
      ...lines.slice(span.end + 1),
    ].join('\n');
  }
  const trimmed = existing.replace(/\n+$/u, '');
  return trimmed === '' ? `${block}\n` : `${trimmed}\n\n${block}\n`;
}

export function removeMarkedSection(existing: string): string {
  const lines = existing.split('\n');
  const span = findSpan(lines);
  if (span === null) {
    return existing;
  }
  const before = lines.slice(0, span.start);
  const after = lines.slice(span.end + 1);
  if (before.length > 0 && before[before.length - 1] === '') {
    before.pop();
  } else if (after.length > 0 && after[0] === '') {
    after.shift();
  }
  const result = [...before, ...after].join('\n');
  return result.trim() === '' ? '' : result;
}

export function readMarkedSection(existing: string): string | null {
  const lines = existing.split('\n');
  const span = findSpan(lines);
  if (span === null) {
    return null;
  }
  return lines.slice(span.start, span.end + 1).join('\n');
}
