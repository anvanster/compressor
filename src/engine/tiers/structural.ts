import type { AppliedTransform, CompressMeta, Estimator, MarkerStyle, Policy } from '../types.ts';
import { OMISSION_MARKER } from '../types.ts';

export interface TierResult {
  content: string;
  transform?: AppliedTransform;
}

export function tierResult(before: string, after: string, id: string): TierResult {
  if (after === before) return { content: before };
  return { content: after, transform: { id, charsSaved: before.length - after.length } };
}

const ANSI_RE =
  /\u001b\[[0-9;:<=>?]*[ -\/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g;
// strips remaining C0 controls and DEL, but never \t (0x09) or \n (0x0a)
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export function stripAnsi(content: string): TierResult {
  const next = content.replace(ANSI_RE, '').replace(CONTROL_RE, '');
  return tierResult(content, next, 'strip-ansi');
}

const BLANK_RE = /^[ \t]*$/;

export function collapseBlankRuns(content: string): TierResult {
  const lines = content.split('\n');
  const out: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    if (run.length >= 3) out.push('');
    else out.push(...run);
    run = [];
  };
  for (const line of lines) {
    if (BLANK_RE.test(line)) {
      run.push(line);
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return tierResult(content, out.join('\n'), 'collapse-blank');
}

export function dedupeLines(content: string): TierResult {
  const lines = content.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    let run = 1;
    while (i + run < lines.length && lines[i + run] === line) run += 1;
    if (run >= 3 && line.trim() !== '') {
      out.push(line, `[compressor: previous line repeated ${run - 1} more times]`);
    } else {
      for (let k = 0; k < run; k += 1) out.push(line);
    }
    i += run;
  }
  return tierResult(content, out.join('\n'), 'dedupe-lines');
}

// Claude Code Read prefixes: "   123→content" (U+2192) or tab-separated variants.
const LINE_NUM_CAPTURE_RE = /^ *(\d+)(?:→|\t)/;

export function lineNumberOf(line: string): number | undefined {
  const digits = LINE_NUM_CAPTURE_RE.exec(line)?.[1];
  return digits === undefined ? undefined : Number(digits);
}

// 'informative' marker style: what the omitted region contains, so the model
// can skip it or retrieve surgically instead of paginating the whole file.
const FAILURE_LINE_RE = /\b(error|fail(ed|ure)?|warn(ing)?|exception|panic|fatal)\b/i;

export interface FailureScan {
  /** matching lines in the scanned region (compressor markers excluded) */
  count: number;
  /** original-coordinate line numbers of the first 3 matches, when resolvable */
  lines: number[];
}

/**
 * Scan omitted lines for error/failure/warning content. Original coordinates
 * follow the same rules as the marker math: embedded Read line numbers are
 * authoritative; `firstFileLine + index` is the fallback when the caller
 * vouches that positions are file lines. Marker lines inserted by earlier
 * tiers in this run are never counted as content.
 */
export function scanFailureLines(lines: readonly string[], firstFileLine?: number): FailureScan {
  let count = 0;
  const found: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || line.includes(OMISSION_MARKER)) continue;
    if (!FAILURE_LINE_RE.test(line)) continue;
    count += 1;
    if (found.length < 3) {
      const n =
        lineNumberOf(line) ?? (firstFileLine === undefined ? undefined : firstFileLine + i);
      if (n !== undefined) found.push(n);
    }
  }
  return { count, lines: found };
}

/** "L1, L2, L3 (first 3)" — the qualifier only when matches were truncated. */
export function formatMatchLines(scan: FailureScan): string {
  return scan.lines.join(', ') + (scan.count > 3 ? ' (first 3)' : '');
}

export function omissionMarker(
  a: number,
  b: number,
  estTokens: number,
  meta: CompressMeta,
  style: MarkerStyle,
  omittedLines: readonly string[],
): string {
  const head = `[compressor: lines ${a}-${b} omitted (~${estTokens} est tokens)`;
  const limit = b - a + 1;
  if (meta.tool === 'read' && meta.filePath !== undefined) {
    const file = meta.filePath;
    if (style === 'deterrent') {
      return `${head} — likely irrelevant; Read ${file} offset=${a} limit=${limit} ONLY if the problem you are chasing points into this range]`;
    }
    if (style === 'informative') {
      const scan = scanFailureLines(omittedLines, a);
      if (scan.count === 0) {
        return `${head} — no error/failure/warning lines in the omitted range; safe to skip. Read ${file} offset=${a} limit=${limit} only if needed]`;
      }
      const nearest = scan.lines[0] ?? a;
      return `${head} — ${scan.count} lines matching error/fail/warn at lines ${formatMatchLines(scan)} — Read ${file} offset=${nearest} limit=20 for the nearest match; full range offset=${a} limit=${limit}]`;
    }
    return `${head} — Read ${file} with offset=${a} and limit=${limit} to retrieve]`;
  }
  if (style === 'deterrent') {
    return `${head} — likely irrelevant; re-run with a narrower filter (grep, --quiet, head) ONLY if the problem you are chasing points into this range]`;
  }
  if (style === 'informative') {
    const scan = scanFailureLines(omittedLines, a);
    if (scan.count === 0) {
      return `${head} — no error/failure/warning lines in the omitted range; safe to skip. Re-run with a narrower filter (grep, --quiet, head) only if needed]`;
    }
    return `${head} — ${scan.count} lines matching error/fail/warn at lines ${formatMatchLines(scan)} — re-run with a narrower filter (grep, --quiet, head) to retrieve]`;
  }
  return `${head} — re-run with a narrower filter (grep, --quiet, head) to retrieve]`;
}

/** For omissions whose original file line range is unknown: no offset/limit claim. */
function countMarker(
  count: number,
  unit: 'lines' | 'chars',
  estTokens: number,
  meta: CompressMeta,
  style: MarkerStyle,
  omitted: string,
): string {
  const head = `[compressor: ${count} ${unit} omitted (~${estTokens} est tokens)`;
  if (meta.tool === 'read' && meta.filePath !== undefined) {
    const file = meta.filePath;
    if (style === 'deterrent') {
      return `${head} — likely irrelevant; Read ${file} ONLY if the problem you are chasing points into the omitted content]`;
    }
    if (style === 'informative') {
      const matches = scanFailureLines(omitted.split('\n')).count;
      return matches === 0
        ? `${head} — no error/failure/warning lines in the omitted content; safe to skip. Read ${file} only if needed]`
        : `${head} — ${matches} lines matching error/fail/warn in the omitted content — Read ${file} to retrieve]`;
    }
    return `${head} — Read ${file} to retrieve]`;
  }
  if (style === 'deterrent') {
    return `${head} — likely irrelevant; re-run with a narrower filter (grep, --quiet, head) ONLY if the problem you are chasing points into the omitted content]`;
  }
  if (style === 'informative') {
    const matches = scanFailureLines(omitted.split('\n')).count;
    return matches === 0
      ? `${head} — no error/failure/warning lines in the omitted content; safe to skip. Re-run with a narrower filter (grep, --quiet, head) only if needed]`
      : `${head} — ${matches} lines matching error/fail/warn in the omitted content — re-run with a narrower filter (grep, --quiet, head) to retrieve]`;
  }
  return `${head} — re-run with a narrower filter (grep, --quiet, head) to retrieve]`;
}

/** Fallback for content too few-lined to truncate by lines (minified blobs etc.). */
function truncateChars(
  content: string,
  meta: CompressMeta,
  policy: Policy,
  estimate: Estimator,
): TierResult {
  const est = estimate(content);
  const ratio = policy.truncateBudget / est;
  const headChars = Math.max(1, Math.floor(content.length * ratio * 0.6));
  const tailChars = Math.max(1, Math.floor(content.length * ratio * 0.4));
  if (headChars + tailChars >= content.length) return { content };
  const omitted = content.slice(headChars, content.length - tailChars);
  const marker = countMarker(
    omitted.length,
    'chars',
    estimate(omitted),
    meta,
    policy.markerStyle,
    omitted,
  );
  const next = `${content.slice(0, headChars)}\n${marker}\n${content.slice(content.length - tailChars)}`;
  return tierResult(content, next, 'truncate');
}

export function truncateHeadTail(
  content: string,
  meta: CompressMeta,
  policy: Policy,
  estimate: Estimator,
  positionsAreFileLines = true,
): TierResult {
  const est = estimate(content);
  if (est <= policy.truncateBudget) return { content };
  const lines = content.split('\n');
  const total = lines.length;
  const ratio = policy.truncateBudget / est;
  const keep = Math.max(2, Math.floor(total * ratio));
  if (keep >= total) return truncateChars(content, meta, policy, estimate);
  const headCount = Math.max(1, Math.floor(keep * 0.6));
  const tailCount = Math.max(1, keep - headCount);
  const omitStart = headCount + 1;
  const omitEnd = total - tailCount;
  if (omitEnd < omitStart) return { content };
  const omittedLines = lines.slice(headCount, total - tailCount);
  const omitted = omittedLines.join('\n');
  const estOmitted = estimate(omitted);
  // Embedded Read line numbers are authoritative for the file range; array
  // positions are valid file lines only when no earlier tier removed lines.
  const a = lineNumberOf(omittedLines[0] ?? '');
  const b = lineNumberOf(omittedLines[omittedLines.length - 1] ?? '');
  const marker =
    a !== undefined && b !== undefined && a <= b
      ? omissionMarker(a, b, estOmitted, meta, policy.markerStyle, omittedLines)
      : positionsAreFileLines
        ? omissionMarker(omitStart, omitEnd, estOmitted, meta, policy.markerStyle, omittedLines)
        : countMarker(omittedLines.length, 'lines', estOmitted, meta, policy.markerStyle, omitted);
  const next = [...lines.slice(0, headCount), marker, ...lines.slice(total - tailCount)].join('\n');
  return tierResult(content, next, 'truncate');
}
