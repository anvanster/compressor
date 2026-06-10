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

/** All thresholds are estimated tokens. Content below `touch` is never modified. */
export interface Policy {
  structural: boolean;
  codeAware: boolean;
  logAware: boolean;
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

export interface CompressResult {
  content: string;
  stats: CompressStats;
}

/**
 * Marker wrapped around every omission so the model can recover what was cut.
 * Content already containing this marker is never re-compressed (idempotency).
 */
export const OMISSION_MARKER = '[compressor:';
