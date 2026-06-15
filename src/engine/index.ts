import type {
  AppliedTransform,
  CompressMeta,
  CompressOptions,
  CompressResult,
  Estimator,
  Policy,
} from './types.ts';
import { OMISSION_MARKER } from './types.ts';
import { detectKind } from './detect.ts';
import {
  collapseBlankRuns,
  createOmissionSink,
  dedupeLines,
  stripAnsi,
  truncateHeadTail,
} from './tiers/structural.ts';
import type { TierResult } from './tiers/structural.ts';
import { langFromPath, skeleton, stripComments } from './tiers/code.ts';
import { filterBuildLog, filterTestLog } from './tiers/logs.ts';

export * from './types.ts';
export { policyFor } from './policy.ts';

export function compress(
  content: string,
  meta: CompressMeta,
  policy: Policy,
  estimate: Estimator,
  options: CompressOptions = {},
): CompressResult {
  const estTokensIn = estimate(content);
  const bytesIn = utf8Bytes(content);

  // CCR omission collection is OPT-IN (default OFF). When OFF, `sink` is
  // undefined and every transform renders today's exact descriptive markers
  // with no placeholders and no omissions — byte-identical (INVARIANT A). Only
  // the hook (compressCall) passes collectOmissions:true. The sink is PURE
  // data: it mints placeholder tokens and accumulates omitted text; hashing and
  // IO live entirely in the hook layer.
  const sink = options.collectOmissions === true ? createOmissionSink() : undefined;

  const passthrough =
    meta.mode === 'full' ||
    meta.targeted === true ||
    content.includes(OMISSION_MARKER) ||
    estTokensIn < policy.touch;

  if (passthrough) {
    return {
      content,
      stats: {
        bytesIn,
        bytesOut: bytesIn,
        estTokensIn,
        estTokensOut: estTokensIn,
        kind: detectKind(content, meta.filePath),
        transforms: [],
      },
    };
  }

  let current = content;
  const transforms: AppliedTransform[] = [];
  const apply = (result: TierResult): void => {
    current = result.content;
    if (result.transform !== undefined) transforms.push(result.transform);
  };

  // Decision estimator: threshold checks and truncation boundaries must not
  // depend on marker TEXT, only on content — otherwise the marker-style
  // experiment arms (plain/deterrent/informative phrasings of different
  // lengths) would diverge in WHICH lines they keep, not just in marker
  // wording. Any line containing OMISSION_MARKER mid-pipeline was inserted by
  // an earlier tier in this run (pre-marked input passes through above), and
  // every style inserts the same NUMBER of marker lines, so excluding them
  // keeps decisions identical across styles.
  const decide: Estimator = (text) =>
    estimate(
      text.includes(OMISSION_MARKER)
        ? text
            .split('\n')
            .filter((line) => !line.includes(OMISSION_MARKER))
            .join('\n')
        : text,
    );

  if (policy.structural) {
    apply(stripAnsi(current));
    apply(collapseBlankRuns(current));
    apply(dedupeLines(current));
  }

  const kind = detectKind(current, meta.filePath);

  if (policy.codeAware && kind === 'code') {
    const lang = langFromPath(meta.filePath);
    if (decide(current) > policy.skeleton) {
      apply(skeleton(current, lang, meta, estimate, policy.markerStyle));
    } else if (decide(current) > policy.commentStrip) {
      apply(stripComments(current, lang, policy.markerStyle));
    }
  }

  if (policy.logAware && decide(current) > policy.logFilter) {
    // CCR scope (#3=B / §7): a FILE Read of a log-shaped file must keep today's
    // descriptive re-read marker — no stash, no placeholder — exactly like the
    // structural file-read branch (omissionMarker/countMarker gate on the same
    // condition). Otherwise a file Read of e.g. build.log would emit a
    // `compressor retrieve <handle>` for a chunk whose freshness the file owns,
    // a staleness bug. Withhold the sink for file reads so logMarker renders the
    // descriptive (re-run) clause and collects nothing.
    const isFileRead = meta.tool === 'read' && meta.filePath !== undefined;
    const logSink = isFileRead ? undefined : sink;
    if (kind === 'test-log') apply(filterTestLog(current, policy.markerStyle, logSink));
    else if (kind === 'build-log') apply(filterBuildLog(current, policy.markerStyle, logSink));
  }

  if (decide(current) > policy.truncateBudget) {
    // Earlier tiers (except strip-ansi) delete lines, so array positions no
    // longer correspond to file line numbers.
    const positionsAreFileLines = transforms.every((t) => t.id === 'strip-ansi');
    apply(truncateHeadTail(current, meta, policy, decide, positionsAreFileLines, sink));
  }

  const result: CompressResult = {
    content: current,
    stats: {
      bytesIn,
      bytesOut: utf8Bytes(current),
      estTokensIn,
      estTokensOut: estimate(current),
      kind,
      transforms,
    },
  };
  // Surface collected omissions only when the sink is active AND something was
  // cut, so OFF-path and no-cut callers see exactly today's result shape (no
  // `omissions` key). compressCall reads this to stash + swap placeholders.
  if (sink !== undefined && sink.omissions.length > 0) {
    result.omissions = sink.omissions;
  }
  return result;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}
