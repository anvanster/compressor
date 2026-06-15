import type {
  CompressMeta,
  CompressResult,
  CompressStats,
  MarkerStyle,
  Mode,
  ToolKind,
} from '../engine/types.ts';
import { OMISSION_MARKER } from '../engine/types.ts';
import { compress, policyFor } from '../engine/index.ts';
import { cheapEstimator } from '../tokens/estimate.ts';
import type { LedgerEvent } from '../ledger/write.ts';
import { appendLedger } from '../ledger/write.ts';
import { ccrDisabled, stashChunk } from './ccr.ts';
import {
  noteRecoveryRead,
  noteTruncation,
  recoveryBudget,
  recoveryBudgetExceeded,
  recoveryDisabled,
} from './recovery.ts';

// Protocol-independent hook core shared by the Claude Code (PostToolUse),
// Copilot (postToolUse), and OpenCode (tool.execute.after) protocol layers.
// Payload field names, tool-name
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

/**
 * The descriptive recovery clause substituted for any CCR placeholder that
 * could NOT be turned into a real handle (stash disabled/failed/partial, or a
 * stray token from a malformed result). It is exactly the plain non-file
 * re-run hint the engine emits when CCR is off, so the model still has a
 * working recovery path. INVARIANT B's defensive backstop: after this runs, no
 * ENGINE-MINTED `⟦ccr:N⟧` can remain in the content the model sees (a model-
 * supplied literal of the same shape in kept content is left untouched).
 */
const CCR_FALLBACK_CLAUSE = '— re-run with a narrower filter (grep, --quiet, head) to retrieve';

/**
 * Turn the engine's placeholder-bearing content into model-safe content
 * (INVARIANT B). When CCR is enabled AND the stash actually persisted (usable
 * sessionId): for each collected omission, stash the exact bytes and replace
 * its unique placeholder with a real retrieve instruction. Then DEFENSIVELY
 * replace any placeholder THE ENGINE MINTED IN THIS RESULT that still survives
 * — a lingering token (kill switch / unwritten stash) — with the descriptive
 * fallback clause, so a stash miss/disable degrades to today's working re-run
 * hint and a raw `⟦ccr:N⟧` can never reach the model. Throws propagate to
 * compressCall, which fails open to the ORIGINAL uncompressed text.
 *
 * SCOPING (model-literal safety): the backstop only sweeps the EXACT tokens
 * this result's omissions carry — never the open-ended `⟦ccr:\d+⟧` pattern —
 * so a model-supplied literal `⟦ccr:N⟧` in KEPT content is left untouched
 * (it was never an engine token; rewriting it would corrupt kept output). The
 * engine owns only `result.omissions`; nothing outside that set is ours to
 * replace.
 *
 * The kill switch (COMPRESSOR_NO_CCR=1) and a non-persisting stash (empty/
 * unusable sessionId) both short-circuit the stash loop entirely: no writes,
 * no `compressor retrieve` markers that would only ever miss — every minted
 * placeholder falls straight through to the descriptive fallback.
 */
function swapPlaceholders(content: string, result: CompressResult, sessionId: string): string {
  let swapped = content;
  const omissions = result.omissions ?? [];
  // Stash only when CCR is on AND the write can actually land: an empty/unusable
  // sessionId never persists a chunk (sessionDir() rejects it), so emitting a
  // `compressor retrieve <handle>` marker for it would be a guaranteed miss.
  // Treat it like the kill switch — let the placeholder fall through to the
  // defensive fallback (today's working re-run hint).
  if (!ccrDisabled() && sessionId !== '') {
    for (const omission of omissions) {
      // stashChunk is fail-open: it always returns a handle (even if writing
      // fails); a later retrieve miss degrades to the re-run hint. The handle is
      // deterministic (hash of text) so the swapped marker is byte-stable for a
      // given input — prompt-cache friendly.
      const handle = stashChunk(sessionId, omission.text);
      swapped = swapped
        .split(omission.placeholder)
        .join(`— retrieve: compressor retrieve ${handle}`);
    }
  }
  // Defensive backstop, SCOPED to engine-minted tokens: replace only the exact
  // placeholders this result carries. A token left here means its stash was
  // skipped (kill switch / unusable sessionId) — degrade it to the re-run hint.
  // Model-supplied `⟦ccr:N⟧` literals in kept content are NOT in this set and
  // are preserved verbatim.
  for (const omission of omissions) {
    swapped = swapped.split(omission.placeholder).join(CCR_FALLBACK_CLAUSE);
  }
  return swapped;
}

export function compressCall(
  call: CompressibleCall,
  mode: Mode,
  markerStyle?: MarkerStyle,
  sessionId?: string,
): CompressedCall {
  try {
    const meta: CompressMeta = { tool: call.toolKind, mode, targeted: call.targeted };
    if (call.filePath !== undefined) {
      meta.filePath = call.filePath;
    }
    const base = policyFor(mode);
    const policy = markerStyle === undefined ? base : { ...base, markerStyle };
    // CCR omission-collection is ON only here (the hook path): the engine emits
    // placeholder tokens for non-file cuts and carries the omitted bytes out as
    // data. Every other caller leaves it OFF and sees today's markers verbatim.
    const result = compress(call.text, meta, policy, cheapEstimator, { collectOmissions: true });
    // marker-stripped so worthwhileness is style-invariant (see above). The
    // placeholder lives INSIDE a `[compressor: …]` marker line, so the floor —
    // which already excludes marker lines — stays content-only with or without
    // CCR; computing it before the swap is therefore identical to after.
    const saved = call.text.length - lengthSansMarkers(result.content);
    if (saved < MIN_SAVED_CHARS || saved < call.text.length * MIN_SAVED_RATIO) {
      // Below floor ⇒ original returned ⇒ no placeholders were ever in scope and
      // no stash writes happen (the swap is skipped) — no waste, nothing leaks.
      return { text: call.text, worthwhile: false };
    }
    // Worthwhile ⇒ make the content model-safe: stash + placeholder→handle, then
    // the defensive sweep. INVARIANT B: a raw placeholder must never leave here.
    const text = swapPlaceholders(result.content, result, sessionId ?? '');
    return { text, worthwhile: true, stats: result.stats };
  } catch {
    // FAIL-OPEN: a broken hook (incl. any error in the stash/swap path) must
    // never break the user's agent — return the ORIGINAL uncompressed text.
    return { text: call.text, worthwhile: false };
  }
}

/**
 * Recovery-read budget (the structural pagination fix — see
 * src/hook/recovery.ts). For a targeted READ of a file this session
 * previously truncated, count the read against the budget and — once the
 * budget is exhausted — demote the call to untargeted, so the engine
 * compresses it under the normal policy. The marker inside the compressed
 * result still tells the model what was omitted: degraded, not blinded.
 *
 * No session id (or kill switch, or non-read, or untargeted, or unknown
 * file path) returns the call unchanged — exactly today's behavior. Reads of
 * never-truncated files are not counted (noteRecoveryRead no-ops without a
 * live truncation record), so ordinary ranged reads cost nothing.
 */
export function applyRecoveryBudget(
  call: CompressibleCall,
  sessionId: string | undefined,
): CompressibleCall {
  try {
    if (sessionId === undefined || sessionId === '' || recoveryDisabled()) {
      return call;
    }
    if (call.toolKind !== 'read' || !call.targeted || call.filePath === undefined) {
      return call;
    }
    // Check first, then count: the synchronous check must not see this very
    // read, so budget N means reads 1..N pass through and read N+1 compresses.
    const exceeded = recoveryBudgetExceeded(sessionId, call.filePath, recoveryBudget());
    noteRecoveryRead(sessionId, call.filePath);
    return exceeded ? { ...call, targeted: false } : call;
  } catch {
    // FAIL-OPEN: budget trouble must never block recovery itself.
    return call;
  }
}

/** Transforms that actually CUT content (vs. lossless dedupe/ansi cleanup). */
const CUTTING_TRANSFORMS: ReadonlySet<string> = new Set(['truncate', 'skeleton']);

/**
 * Fire-and-forget truncation note for the recovery budget: records that a
 * worthwhile READ compression cut content (truncate/skeleton ran), so later
 * targeted reads of the same file count as recovery. Transform ids come from
 * the engine stats already carried on CompressedCall.
 */
export function noteTruncationIfCut(
  sessionId: string | undefined,
  call: CompressibleCall,
  compressed: CompressedCall,
): void {
  try {
    if (sessionId === undefined || sessionId === '' || recoveryDisabled()) {
      return;
    }
    if (call.toolKind !== 'read' || call.filePath === undefined || !compressed.worthwhile) {
      return;
    }
    const cut = compressed.stats?.transforms.some((t) => CUTTING_TRANSFORMS.has(t.id)) ?? false;
    if (cut) {
      noteTruncation(sessionId, call.filePath);
    }
  } catch {
    // FAIL-OPEN: the budget must never break the hook.
  }
}

/**
 * Fire-and-forget ledger entry for a worthwhile compression. Called by the
 * protocol layers (they know which agent they serve). Never awaited on the
 * hot path; the hook entries settle pending writes (capped at 250ms) before
 * exiting. Privacy: sizes and transform ids only — no paths, no content.
 */
export function recordCompression(
  agent: LedgerEvent['agent'],
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

/**
 * CCR passthrough detector (§3): true when a value is a bash/command string
 * that invokes `compressor retrieve`. The output of such a command is an exact
 * original slice the model deliberately pulled back from the stash; re-running
 * compression on it would re-cut and re-stash content that is, by definition,
 * wanted in full — so each protocol layer treats a positive match as a no-op.
 *
 * Robust + best-effort: accepts any whitespace between the words (so
 * `compressor   retrieve`, a leading path like `npx compressor retrieve`, or a
 * pipeline still matches), case-insensitively. A non-string input is not a
 * command and returns false — the caller then compresses normally (fail-safe:
 * the worst case is compressing a retrieved slice, never a crash).
 */
export function isCompressorRetrieve(command: unknown): boolean {
  return typeof command === 'string' && /\bcompressor\s+retrieve\b/i.test(command);
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
