import type { CompressMeta, Mode, ToolKind } from '../engine/types.ts';
import { compress, policyFor } from '../engine/index.ts';
import { cheapEstimator } from '../tokens/estimate.ts';

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
}

/** Below either floor the rewrite is noise: don't churn the context. */
const MIN_SAVED_CHARS = 200;
const MIN_SAVED_RATIO = 0.1;

export function compressCall(call: CompressibleCall, mode: Mode): CompressedCall {
  try {
    const meta: CompressMeta = { tool: call.toolKind, mode, targeted: call.targeted };
    if (call.filePath !== undefined) {
      meta.filePath = call.filePath;
    }
    const result = compress(call.text, meta, policyFor(mode), cheapEstimator);
    const saved = call.text.length - result.content.length;
    if (saved < MIN_SAVED_CHARS || saved < call.text.length * MIN_SAVED_RATIO) {
      return { text: call.text, worthwhile: false };
    }
    return { text: result.content, worthwhile: true };
  } catch {
    // FAIL-OPEN: a broken hook must never break the user's agent.
    return { text: call.text, worthwhile: false };
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
