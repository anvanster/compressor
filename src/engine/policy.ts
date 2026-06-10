import type { Mode, Policy } from './types.ts';

export function policyFor(mode: Mode): Policy {
  switch (mode) {
    case 'full':
      return {
        structural: false,
        codeAware: false,
        logAware: false,
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
        touch: 300,
        truncateBudget: 2500,
        commentStrip: 1000,
        skeleton: 6000,
        logFilter: 800,
      };
  }
}
