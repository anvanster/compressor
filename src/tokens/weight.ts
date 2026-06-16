// Cost-weight token counts by cache tier so headline figures stop overstating
// dollars. A raw token count that lumps cache-read with regular input overstates
// the dollar impact up to ~10x, because a cache-read token costs ~0.1x of base
// input. PURE: no IO, no process, no console.
//
// The weights are RATIOS to the base input price (Anthropic Claude 4.x family,
// as of 2026), so a weighted total is dollar-PROPORTIONAL within a model — it is
// NOT an absolute dollar figure. The bench report's authoritative $ comes from
// Claude's reported total_cost_usd and stays the ground truth; this module never
// computes absolute dollars.
//
// Source: Anthropic Claude 4.x pricing tiers (2026-06). cacheCreation defaults
// to the 5-minute write (1.25x); 1-hour writes (2x) aren't distinguishable in
// transcripts and 5m is the default, so 1.25 is correct here.

/** A usage record by tier. A missing tier is treated as 0; undefined/NaN coerce to 0. */
export type UsageLike = {
  input?: number;
  output?: number;
  cacheCreation?: number;
  cacheRead?: number;
};

/**
 * Per-tier price ratios relative to base input (= 1.0). Dollar-proportional,
 * NOT absolute $. Anthropic Claude 4.x family, 2026-06:
 *   input         1.0x   (regular input — the reference)
 *   cacheCreation 1.25x  (5-minute cache write; 1h writes are 2x but indistinguishable in transcripts)
 *   cacheRead     0.1x   (cache hit — the tier raw counts overstate ~10x)
 *   output        5.0x   (the priciest tier)
 * Single source of truth — override here (or import + spread) to retune.
 */
export const TIER_WEIGHTS = {
  input: 1,
  cacheCreation: 1.25,
  cacheRead: 0.1,
  output: 5,
} as const;

/** Short one-line legend for terminal surfaces. */
export const WEIGHT_LEGEND =
  'cost-weighted: input 1x, cache-write 1.25x, cache-read 0.1x, output 5x — $-proportional, not absolute $';

/** Unit label for a cost-weighted total: everything expressed in base-input-token equivalents. */
export const EFFECTIVE_UNIT = 'input-equiv tok';

/** Coerce a possibly-undefined/NaN tier value to a finite number (0 otherwise). */
function num(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Cost-weighted total across ALL FOUR tiers → input-equivalent tokens
 * (= input*1 + cacheCreation*1.25 + cacheRead*0.1 + output*5). Pure, total,
 * NaN-safe. Dollar-proportional, not absolute $.
 */
export function weightedTokens(u: UsageLike): number {
  return (
    num(u.input) * TIER_WEIGHTS.input +
    num(u.cacheCreation) * TIER_WEIGHTS.cacheCreation +
    num(u.cacheRead) * TIER_WEIGHTS.cacheRead +
    num(u.output) * TIER_WEIGHTS.output
  );
}

/**
 * Cost-weighted INPUT-SIDE context only (NO output) → input-equivalent tokens
 * (= input*1 + cacheCreation*1.25 + cacheRead*0.1). This is the honest
 * replacement for a face-value (input + cacheCreation + cacheRead) sum, which
 * counted cache-read 1:1 despite it costing 0.1x. Pure, total, NaN-safe.
 */
export function costWeightedContext(u: UsageLike): number {
  return (
    num(u.input) * TIER_WEIGHTS.input +
    num(u.cacheCreation) * TIER_WEIGHTS.cacheCreation +
    num(u.cacheRead) * TIER_WEIGHTS.cacheRead
  );
}
