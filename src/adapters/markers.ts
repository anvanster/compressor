import { MARKER_BEGIN_LINE_RE, MARKER_END } from '../packs/render.ts';

interface Span {
  start: number;
  end: number;
}

/** Code fence delimiter: up to 3 leading spaces, then ``` / ~~~ (CommonMark). */
const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** 4+ spaces or a tab opens an indented code block — never our marker. */
const INDENTED_CODE_RE = /^(?: {4,}|\t)/;

/**
 * Per-line mask: true ⇨ the line belongs to a CLOSED fenced code block
 * (including its delimiter lines) and must be ignored when locating markers.
 *
 * CommonMark-faithful where it matters for safety:
 * - a fence closes only on the same character, at least as long as the
 *   opener, with nothing but whitespace after it — a ``` line inside an open
 *   ~~~ block is literal text, not a toggle;
 * - a backtick opening fence cannot carry backticks in its info string;
 * - a fence left open at EOF deliberately does NOT mask its content: install
 *   appends our section after such files, and hiding those lines would break
 *   idempotency (duplicate sections) and strand the section with no
 *   uninstall path.
 */
function closedFenceMask(lines: readonly string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let open: { char: string; len: number; from: number } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const match = FENCE_LINE_RE.exec(lines[i] ?? '');
    if (match === null) {
      continue;
    }
    const seq = match[1] ?? '';
    const rest = match[2] ?? '';
    const char = seq.charAt(0);
    if (open === null) {
      if (char === '~' || !rest.includes('`')) {
        open = { char, len: seq.length, from: i };
      }
    } else if (
      char === open.char &&
      seq.length >= open.len &&
      rest.trim() === ''
    ) {
      for (let j = open.from; j <= i; j += 1) {
        mask[j] = true;
      }
      open = null;
    }
  }
  return mask;
}

function isBeginLine(line: string): boolean {
  return !INDENTED_CODE_RE.test(line) && MARKER_BEGIN_LINE_RE.test(line.trim());
}

function isEndLine(line: string): boolean {
  return !INDENTED_CODE_RE.test(line) && line.trim() === MARKER_END;
}

/**
 * Locate our marked section. Safety rules:
 * - a begin line must match the FULL marker grammar (prefix-only prose lines
 *   are ignored);
 * - markers inside closed code fences or indented code blocks are examples,
 *   not boundaries;
 * - an end line pairs with the NEAREST preceding begin: an orphan begin
 *   (user hand-deleted our end) re-anchors to a later real begin instead of
 *   greedily swallowing the user content in between.
 */
function findSpan(lines: readonly string[]): Span | null {
  const fenced = closedFenceMask(lines);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (fenced[i] === true) {
      continue;
    }
    const line = lines[i] ?? '';
    if (isBeginLine(line)) {
      start = i;
    } else if (start !== -1 && isEndLine(line)) {
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
  // No whitespace collapsing here: residue bytes (e.g. a whitespace-only
  // user file that received our section) must survive removal untouched.
  return [...before, ...after].join('\n');
}

export function readMarkedSection(existing: string): string | null {
  const lines = existing.split('\n');
  const span = findSpan(lines);
  if (span === null) {
    return null;
  }
  return lines.slice(span.start, span.end + 1).join('\n');
}
