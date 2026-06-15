import type { MarkerStyle } from '../types.ts';
import { scanFailureLines, tierResult } from './structural.ts';
import type { OmissionSink, TierResult } from './structural.ts';

/**
 * Style-aware omission marker shared by the test/build log filters. Logs have
 * no file coordinates, so the informative variant reports match counts only.
 * Log-SHAPED content is usually a non-file output (Bash/test runner), but a
 * file Read of a log file (e.g. `Read build.log`) is also log-shaped — and for
 * that case CCR must NOT engage (the file owns freshness; #3=B / §7). The
 * caller (engine/index.ts) enforces the scope by withholding the sink for file
 * reads, so this function never has to know the tool kind:
 *   OFF path / file read (sink undefined): today's exact marker, byte-for-byte
 *     (INVARIANT A) — the descriptive re-run clause, no stash, no placeholder.
 *   ON path, non-file (sink present): the dropped lines are stashed and the
 *     recovery clause becomes a bare placeholder token compressCall swaps for a
 *     real retrieve handle / descriptive fallback (INVARIANT B). The plain
 *     style has no recovery clause today (just `${head}]`); CCR appends the
 *     placeholder so a handle can still be carried.
 */
function logMarker(
  noun: 'passing-test' | 'build-log',
  omittedLines: readonly string[],
  style: MarkerStyle,
  sink?: OmissionSink,
): string {
  const head = `[compressor: ${omittedLines.length} ${noun} lines omitted`;
  if (sink !== undefined) {
    return `${head} ${sink.add(omittedLines.join('\n'))}]`;
  }
  if (style === 'deterrent') {
    return `${head} — likely irrelevant; re-run with a narrower filter ONLY if the problem you are chasing points into the omitted output]`;
  }
  if (style === 'informative') {
    const matches = scanFailureLines(omittedLines).count;
    return matches === 0
      ? `${head} — no error/failure/warning lines in the omitted output; safe to skip. Re-run with a narrower filter only if needed]`
      : `${head} — ${matches} omitted lines matching error/fail/warn — re-run with a narrower filter to retrieve]`;
  }
  return `${head}]`;
}

const TEST_PASS_RES: readonly RegExp[] = [
  /^\s*[✓✔√]\s/,
  /^PASS\s/,
  /^\s*--- PASS:/,
  /^test\s+\S+\s+\.\.\.\s+ok\s*$/,
  /\bPASSED\s*$/,
  /^ok\s+\d+\s/,
];

const TEST_FAIL_RES: readonly RegExp[] = [
  /^\s*[✗✘✖×]\s/,
  /^FAIL\b/,
  /--- FAIL/,
  /\bFAILED\b/,
  /^not ok\s/,
  /\bpanicked\b/,
  /^\s*●/,
  // error reports only ('Error: boom', 'error: x'), not prose containing 'error'
  /^\s*(?:[A-Za-z]*Error|error)\s*[:(]/,
];

const TEST_SUMMARY_RES: readonly RegExp[] = [
  /^(Tests|Test Suites|Snapshots|Time|Duration):/,
  /\d+\s+pass(?:ed|ing)\b/,
  /\d+\s+fail(?:ed|ing)\b/,
  /^test result:/,
  /^Ran all test suites/,
  /^=+ .* =+$/,
  // node:test spec ('ℹ pass 118') and tap ('# pass 118') summary counters
  /^(?:ℹ|#) (?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) \d+\s*$/,
];

export function filterTestLog(
  content: string,
  style: MarkerStyle = 'plain',
  sink?: OmissionSink,
): TierResult {
  const lines = content.split('\n');
  const isFail = (l: string): boolean => TEST_FAIL_RES.some((re) => re.test(l));
  const isSummary = (l: string): boolean => TEST_SUMMARY_RES.some((re) => re.test(l));
  const isPass = (l: string): boolean => TEST_PASS_RES.some((re) => re.test(l));

  // unrecognized format: never drop anything
  if (!lines.some(isFail) && !lines.some(isSummary)) return { content };

  const out: string[] = [];
  const omittedLines: string[] = [];
  let markerIdx = -1;
  for (const line of lines) {
    if (isPass(line) && !isFail(line) && !isSummary(line)) {
      if (markerIdx < 0) markerIdx = out.length;
      omittedLines.push(line);
    } else {
      out.push(line);
    }
  }
  if (omittedLines.length === 0) return { content };
  out.splice(markerIdx, 0, logMarker('passing-test', omittedLines, style, sink));
  return tierResult(content, out.join('\n'), 'log-filter');
}

const BUILD_ERROR_RES: readonly RegExp[] = [
  /error\[E\d+\]/,
  /^\s*(error|warning)(\s+[A-Z]+\d+)?:/i,
  /\b(error|warning)\s+TS\d+:/,
  /:\d+(?::\d+)?:\s*(?:fatal\s+)?(?:error|warning)\b/,
  /npm ERR!/,
  /^\s*(Error|TypeError|SyntaxError|ReferenceError|RangeError)\b/,
];

const BUILD_STATUS_RES: readonly RegExp[] = [
  /^\s*error: aborting/,
  /^\s*error: could not compile/,
  /Found \d+ errors?/,
  /\d+ errors? generated/,
  /^make: \*\*\*/,
  /^Build (?:FAILED|failed|succeeded)/,
  /^\s*Finished\b/,
  /[✖✗] \d+ problems?/,
  /exited with code \d+/,
];

export function filterBuildLog(
  content: string,
  style: MarkerStyle = 'plain',
  sink?: OmissionSink,
): TierResult {
  const lines = content.split('\n');
  const isError = (l: string): boolean => BUILD_ERROR_RES.some((re) => re.test(l));
  const isStatus = (l: string): boolean => BUILD_STATUS_RES.some((re) => re.test(l));

  // unrecognized format: never drop anything
  if (!lines.some(isError) && !lines.some(isStatus)) return { content };

  const out: string[] = [];
  const omittedLines: string[] = [];
  let markerIdx = -1;
  let inErrorBlock = false;
  for (const line of lines) {
    let keep: boolean;
    if (isError(line)) {
      inErrorBlock = true;
      keep = true;
    } else if (isStatus(line)) {
      inErrorBlock = false;
      keep = true;
    } else if (inErrorBlock) {
      if (line.trim() === '') {
        inErrorBlock = false;
        keep = false;
      } else {
        keep = true;
      }
    } else {
      keep = false;
    }
    if (keep) {
      out.push(line);
    } else {
      if (markerIdx < 0) markerIdx = out.length;
      omittedLines.push(line);
    }
  }
  if (omittedLines.length === 0) return { content };
  out.splice(markerIdx, 0, logMarker('build-log', omittedLines, style, sink));
  return tierResult(content, out.join('\n'), 'log-filter');
}
