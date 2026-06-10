import type { CompressMeta, Mode, ToolKind } from '../engine/types.ts';
import { compress, policyFor } from '../engine/index.ts';
import { cheapEstimator } from '../tokens/estimate.ts';

export interface HookResult {
  output: string | null;
}

/** Below either floor the rewrite is noise: don't churn the context. */
const MIN_SAVED_CHARS = 200;
const MIN_SAVED_RATIO = 0.1;

type LeafPath = ReadonlyArray<string | number>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolKindFor(toolName: string): ToolKind {
  switch (toolName) {
    case 'Read':
      return 'read';
    case 'Bash':
      return 'bash';
    case 'Grep':
    case 'Glob':
      return 'search';
    default:
      return 'other';
  }
}

function metaFor(
  toolName: string,
  toolInput: Record<string, unknown>,
  mode: Mode,
): CompressMeta {
  const tool = toolKindFor(toolName);
  const meta: CompressMeta = { tool, mode };
  if (tool === 'read') {
    if (typeof toolInput['file_path'] === 'string') {
      meta.filePath = toolInput['file_path'];
    }
    meta.targeted = toolInput['offset'] != null || toolInput['limit'] != null;
  }
  return meta;
}

interface Leaf {
  path: LeafPath;
  text: string;
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

function pickLeaf(toolResponse: unknown, tool: ToolKind): Leaf | null {
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

function rebuildWithLeaf(toolResponse: unknown, path: LeafPath, text: string): unknown {
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

export function handlePostToolUse(payloadJson: string, mode: Mode): HookResult {
  try {
    if (mode === 'full') {
      return { output: null };
    }
    const payload: unknown = JSON.parse(payloadJson);
    if (!isRecord(payload)) {
      return { output: null };
    }
    const toolName = typeof payload['tool_name'] === 'string' ? payload['tool_name'] : '';
    const toolInput = isRecord(payload['tool_input']) ? payload['tool_input'] : {};
    const meta = metaFor(toolName, toolInput, mode);

    const leaf = pickLeaf(payload['tool_response'], meta.tool);
    if (leaf === null) {
      return { output: null };
    }

    const result = compress(leaf.text, meta, policyFor(mode), cheapEstimator);
    const saved = leaf.text.length - result.content.length;
    if (saved < MIN_SAVED_CHARS || saved < leaf.text.length * MIN_SAVED_RATIO) {
      return { output: null };
    }

    const updatedToolOutput = rebuildWithLeaf(payload['tool_response'], leaf.path, result.content);
    return {
      output: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          updatedToolOutput,
        },
      }),
    };
  } catch {
    return { output: null };
  }
}
