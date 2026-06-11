import type { Mode, Policy } from './types.ts';

export function policyFor(mode: Mode): Policy {
  switch (mode) {
    case 'full':
      return {
        structural: false,
        codeAware: false,
        logAware: false,
        // 'plain' everywhere for now: the marker-style experiment (bench
        // hookArgs --marker-style) varies this per arm and picks the winner.
        markerStyle: 'plain',
        touch: Infinity,
        truncateBudget: Infinity,
        commentStrip: Infinity,
        skeleton: Infinity,
        logFilter: Infinity,
      };
    // PLAN.md: optimized = tier 1 + comment-strip; lossy tier-3 log filtering
    // is reserved for slim.
    case 'optimized':
      return {
        structural: true,
        codeAware: true,
        logAware: false,
        markerStyle: 'plain',
        touch: 600,
        truncateBudget: 5000,
        commentStrip: 2000,
        skeleton: Infinity,
        logFilter: Infinity,
      };
    case 'slim':
      return {
        structural: true,
        codeAware: true,
        logAware: true,
        markerStyle: 'plain',
        touch: 300,
        // measured (bench-20260610-114234/-123102): a 2,500 budget pushed the
        // model into offset/limit pagination — targeted reads pass through, so
        // recovery re-reads nullified all savings (worst cell exceeded the
        // uncompressed baseline). 5,000 stays under the recovery trigger.
        truncateBudget: 5000,
        commentStrip: 1000,
        skeleton: 6000,
        logFilter: 800,
      };
  }
}
