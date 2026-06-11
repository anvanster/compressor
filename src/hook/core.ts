import type { CompressMeta, CompressStats, MarkerStyle, Mode, ToolKind } from '../engine/types.ts';
import { OMISSION_MARKER } from '../engine/types.ts';
import { compress, policyFor } from '../engine/index.ts';
import { cheapEstimator } from '../tokens/estimate.ts';
import { appendLedger } from '../ledger/write.ts';

// Protocol-independent hook core shared by the Claude Code (PostToolUse) and
// Copilot (postToolUse) protocol layers. Payload field names, tool-name
// mapping, and response envelopes stay in the protocol layers; this module
// only knows how to find compressible text in an unknown value and run the
// engine with the hook's savings floor. Hot path: cheapEstimator only.

export interface CompressibleCall {
  toolKind: ToolKind;
  filePath?: string;
  targeted: boolean;
  text: string;
}

export interface CompressedCall {
  text: string;
  /** false = leave the tool output alone (below floor, marker present, throw) */
  worthwhile: boolean;
  /** engine stats for the worthwhile case (ledger needs tokens/transforms) */
  stats?: CompressStats;
}

/** Below either floor the rewrite is noise: don't churn the context. */
const MIN_SAVED_CHARS = 200;
const MIN_SAVED_RATIO = 0.1;

/**
 * Length of the compressed output EXCLUDING marker lines, mirroring the
 * engine's decide() filter (engine/index.ts). The floors must be measured
 * against content only: marker text is the marker-style experiment's
 * treatment (informative/deterrent markers run ~50-120 chars longer than
 * plain, multiplied by one marker per skeleton gap), so a marker-inclusive
 * `saved` lets arms flip between compressed and full passthrough near either
 * floor — the arms would then differ in WHAT the model sees, not just in
 * marker phrasing, and the treatment marker would be absent exactly when
 * phrasing is being compared.
 */
function lengthSansMarkers(text: string): number {
  if (!text.includes(OMISSION_MARKER)) {
    return text.length;
  }
  return text
    .split('\n')
    .filter((line) => !line.includes(OMISSION_MARKER))
    .join('\n').length;
}

export function compressCall(
  call: CompressibleCall,
  mode: Mode,
  markerStyle?: MarkerStyle,
): CompressedCall {
  try {
    const meta: CompressMeta = { tool: call.toolKind, mode, targeted: call.targeted };
    if (call.filePath !== undefined) {
      meta.filePath = call.filePath;
    }
    const base = policyFor(mode);
    const policy = markerStyle === undefined ? base : { ...base, markerStyle };
    const result = compress(call.text, meta, policy, cheapEstimator);
    // marker-stripped so worthwhileness is style-invariant (see above)
    const saved = call.text.length - lengthSansMarkers(result.content);
    if (saved < MIN_SAVED_CHARS || saved < call.text.length * MIN_SAVED_RATIO) {
      return { text: call.text, worthwhile: false };
    }
    return { text: result.content, worthwhile: true, stats: result.stats };
  } catch {
    // FAIL-OPEN: a broken hook must never break the user's agent.
    return { text: call.text, worthwhile: false };
  }
}

/**
 * Fire-and-forget ledger entry for a worthwhile compression. Called by the
 * protocol layers (they know which agent they serve). Never awaited on the
 * hot path; the hook entries settle pending writes (capped at 250ms) before
 * exiting. Privacy: sizes and transform ids only — no paths, no content.
 */
export function recordCompression(
  agent: 'claude-code' | 'copilot',
  call: CompressibleCall,
  compressed: CompressedCall,
  mode: Mode,
): void {
  try {
    if (!compressed.worthwhile) {
      return;
    }
    void appendLedger({
      ts: new Date().toISOString(),
      agent,
      tool: call.toolKind,
      mode,
      charsIn: call.text.length,
      charsOut: compressed.text.length,
      estTokensIn: compressed.stats?.estTokensIn ?? cheapEstimator(call.text),
      estTokensOut: compressed.stats?.estTokensOut ?? cheapEstimator(compressed.text),
      transforms: compressed.stats?.transforms.map((t) => t.id) ?? [],
    }).catch(() => {});
  } catch {
    // FAIL-OPEN: the ledger must never break the hook.
  }
}

export type LeafPath = ReadonlyArray<string | number>;

export interface Leaf {
  path: LeafPath;
  text: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function longestStringLeaf(value: unknown, path: LeafPath, best: Leaf | null): Leaf | null {
  if (typeof value === 'string') {
    return best === null || value.length > best.text.length ? { path, text: value } : best;
  }
  if (Array.isArray(value)) {
    return value.reduce<Leaf | null>(
      (acc, item, i) => longestStringLeaf(item, [...path, i], acc),
      best,
    );
  }
  if (isRecord(value)) {
    return Object.entries(value).reduce<Leaf | null>(
      (acc, [key, item]) => longestStringLeaf(item, [...path, key], acc),
      best,
    );
  }
  return best;
}

/**
 * Find the single string worth compressing in a tool response of unknown
 * shape: a bare string directly, a bash stdout field when present, otherwise
 * the longest string leaf anywhere in the structure.
 */
export function pickLeaf(toolResponse: unknown, tool: ToolKind): Leaf | null {
  if (typeof toolResponse === 'string') {
    return { path: [], text: toolResponse };
  }
  if (tool === 'bash' && isRecord(toolResponse) && typeof toolResponse['stdout'] === 'string') {
    return { path: ['stdout'], text: toolResponse['stdout'] };
  }
  if (isRecord(toolResponse) || Array.isArray(toolResponse)) {
    return longestStringLeaf(toolResponse, [], null);
  }
  return null;
}

/** Shape-preserving rewrite: clone the response with only the leaf replaced. */
export function rebuildWithLeaf(toolResponse: unknown, path: LeafPath, text: string): unknown {
  if (path.length === 0) {
    return text;
  }
  const clone: unknown = structuredClone(toolResponse);
  let cursor: unknown = clone;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (Array.isArray(cursor) && typeof key === 'number') {
      cursor = cursor[key];
    } else if (isRecord(cursor) && typeof key === 'string') {
      cursor = cursor[key];
    } else {
      throw new Error('leaf path mismatch');
    }
  }
  const last = path[path.length - 1];
  if (Array.isArray(cursor) && typeof last === 'number') {
    cursor[last] = text;
  } else if (isRecord(cursor) && typeof last === 'string') {
    cursor[last] = text;
  } else {
    throw new Error('leaf path mismatch');
  }
  return clone;
}
