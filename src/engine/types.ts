/** Operating mode. 'full' = no optimization anywhere. */
export type Mode = 'full' | 'optimized' | 'slim';

/** What produced the content being compressed. */
export type ToolKind = 'read' | 'bash' | 'search' | 'other';

/** Detected content kind, used to pick transforms. */
export type ContentKind = 'code' | 'test-log' | 'build-log' | 'generic';

export interface CompressMeta {
  tool: ToolKind;
  mode: Mode;
  /** Source file path when known (drives code detection by extension). */
  filePath?: string;
  /**
   * True when the model explicitly requested a range (Read offset/limit).
   * Targeted reads always pass through untouched.
   */
  targeted?: boolean;
}

/**
 * Token estimator injected by the caller (engine stays dependency-free and
 * pure). Estimates are used ONLY for threshold decisions, never reported as
 * savings.
 */
export type Estimator = (text: string) => number;

/**
 * Omission-marker phrasing. Measured (bench-20260610-114234): the plain
 * recovery affordance invites whole-file pagination via targeted reads,
 * nullifying savings on ~half of cells. 'deterrent' frames recovery as
 * conditional; 'informative' additionally reports what the omitted region
 * contains (failure-pattern scan) so the model can skip or retrieve
 * surgically.
 */
export type MarkerStyle = 'plain' | 'deterrent' | 'informative';

/** All thresholds are estimated tokens. Content below `touch` is never modified. */
export interface Policy {
  structural: boolean;
  codeAware: boolean;
  logAware: boolean;
  markerStyle: MarkerStyle;
  /** below this, return input unchanged */
  touch: number;
  /** head/tail truncation budget for a single tool result */
  truncateBudget: number;
  /** strip comment-only/blank lines in code above this */
  commentStrip: number;
  /** skeleton view (imports + signatures) above this; Infinity = never */
  skeleton: number;
  /** apply test/build log filtering above this; Infinity = never */
  logFilter: number;
}

export interface AppliedTransform {
  /** e.g. 'strip-ansi', 'dedupe-lines', 'truncate', 'comment-strip', 'skeleton', 'log-filter' */
  id: string;
  charsSaved: number;
}

export interface CompressStats {
  bytesIn: number;
  bytesOut: number;
  estTokensIn: number;
  estTokensOut: number;
  kind: ContentKind;
  transforms: AppliedTransform[];
}

/**
 * One omitted NON-FILE chunk collected when CCR omission-collection is enabled
 * (compress(..., { collectOmissions: true }) — the hook path only). The engine
 * emits `placeholder` (a unique CCR token) inside the marker's recovery clause
 * and carries the exact omitted `text` out as DATA; the impure hook layer
 * (compressCall) stashes the text and swaps the placeholder for a real retrieve
 * handle. The engine never hashes or writes — it only collects. File-read cuts
 * produce NO omission (they keep today's offset/limit re-read marker; §7/B).
 */
export interface Omission {
  /** Unique CCR placeholder token embedded in the marker (e.g. `⟦ccr:0⟧`). */
  placeholder: string;
  /** The exact omitted bytes the hook will stash, keyed by hash(text). */
  text: string;
}

/**
 * Options that change WHAT the engine collects (never how it decides). The sole
 * option, `collectOmissions`, is OPT-IN and default OFF: every existing caller
 * (CLI `compress`, the engine tests) renders today's descriptive markers with
 * NO placeholders and NO omissions — byte-identical to pre-CCR behavior. Only
 * the hook (compressCall) turns it on, so a raw placeholder can never leak to a
 * non-hook caller.
 */
export interface CompressOptions {
  collectOmissions?: boolean;
}

export interface CompressResult {
  content: string;
  stats: CompressStats;
  /**
   * NON-FILE omitted chunks, present only when CCR omission-collection was
   * enabled AND a non-file cutting transform fired. Absent (undefined) on every
   * OFF-path call and whenever nothing was collected, so non-hook callers and
   * existing tests see exactly today's shape.
   */
  omissions?: Omission[];
}

/**
 * Marker wrapped around every omission so the model can recover what was cut.
 * Content already containing this marker is never re-compressed (idempotency).
 */
export const OMISSION_MARKER = '[compressor:';

/**
 * Builds the unique CCR placeholder token for the Nth omission within one
 * compress() result (e.g. `⟦ccr:0⟧`). Distinct from OMISSION_MARKER and from
 * any text the model could plausibly emit. INVARIANT B: this token is internal
 * — compressCall MUST replace every one (with a real retrieve handle on stash
 * success, or today's descriptive fallback clause otherwise) before returning a
 * worthwhile result; a raw `⟦ccr:N⟧` reaching the model is a P0 bug.
 */
export function ccrPlaceholder(index: number): string {
  return `⟦ccr:${index}⟧`;
}

/** Matches any CCR placeholder token; used for the defensive leftover swap. */
export const CCR_PLACEHOLDER_RE = /⟦ccr:\d+⟧/g;
