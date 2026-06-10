import type { AppliedTransform, CompressMeta, CompressResult, Estimator, Policy } from './types.ts';
import { OMISSION_MARKER } from './types.ts';
import { detectKind } from './detect.ts';
import { collapseBlankRuns, dedupeLines, stripAnsi, truncateHeadTail } from './tiers/structural.ts';
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
): CompressResult {
  const estTokensIn = estimate(content);
  const bytesIn = utf8Bytes(content);

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

  if (policy.structural) {
    apply(stripAnsi(current));
    apply(collapseBlankRuns(current));
    apply(dedupeLines(current));
  }

  const kind = detectKind(current, meta.filePath);

  if (policy.codeAware && kind === 'code') {
    const lang = langFromPath(meta.filePath);
    if (estimate(current) > policy.skeleton) {
      apply(skeleton(current, lang, meta, estimate));
    } else if (estimate(current) > policy.commentStrip) {
      apply(stripComments(current, lang));
    }
  }

  if (policy.logAware && estimate(current) > policy.logFilter) {
    if (kind === 'test-log') apply(filterTestLog(current));
    else if (kind === 'build-log') apply(filterBuildLog(current));
  }

  if (estimate(current) > policy.truncateBudget) {
    // Earlier tiers (except strip-ansi) delete lines, so array positions no
    // longer correspond to file line numbers.
    const positionsAreFileLines = transforms.every((t) => t.id === 'strip-ansi');
    apply(truncateHeadTail(current, meta, policy, estimate, positionsAreFileLines));
  }

  return {
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
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}
