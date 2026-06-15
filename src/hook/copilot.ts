import type { MarkerStyle, Mode, ToolKind } from '../engine/types.ts';
import type { CompressibleCall, Leaf } from './core.ts';
import {
  applyRecoveryBudget,
  compressCall,
  isCompressorRetrieve,
  isRecord,
  noteTruncationIfCut,
  pickLeaf,
  rebuildWithLeaf,
  recordCompression,
} from './core.ts';

// GitHub Copilot postToolUse protocol layer — the Copilot CLI / cloud agent
// COMMAND hooks (.github/hooks/*.json), NOT the Copilot SDK in-process hooks,
// which use different tool names (read_file/shell) and a freeform result.
//
// stdin payload (camelCase format; event registered as `postToolUse`):
//   { sessionId, timestamp, cwd, toolName, toolArgs,
//     toolResult: { resultType: "success", textResultForLlm } }
// stdout replacement (docs: "The postToolUse hook can modify the tool result
// ... by writing a JSON object to stdout"):
//   { modifiedResult: { resultType: "success", textResultForLlm } }
// No-op convention: emit nothing (output null), exit 0.
// postToolUse fires only after SUCCESSFUL tool calls and has no matcher, so
// this layer filters by toolName/shape itself and FAILS OPEN everywhere.

export interface CopilotHookResult {
  output: string | null;
}

/** Copilot CLI / cloud-agent built-in tool names → engine ToolKind. */
function toolKindFor(toolName: string): ToolKind {
  switch (toolName) {
    case 'view':
      return 'read';
    case 'bash':
    case 'powershell':
      return 'bash';
    case 'grep':
    case 'glob':
      return 'search';
    default:
      return 'other';
  }
}

// `toolArgs` is documented only as `unknown`, so the view tool's argument
// names are sniffed liberally and fail open: no match means no filePath /
// not targeted, which only ever makes compression more conservative.
const FILE_PATH_KEYS = ['path', 'filePath', 'file_path', 'file'] as const;

/**
 * The reference page types toolArgs as `unknown`, but the CLI docs' only
 * concrete payload example shows it as a JSON-ENCODED STRING
 * ("toolArgs":"{\"command\":\"ls\"}"). Accept both forms: object as-is,
 * string via JSON.parse. Anything else (or unparseable) falls back to {} —
 * fail open: no filePath, not targeted, compression stays conservative.
 */
function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      // fall through to {}
    }
  }
  return {};
}
const RANGE_KEYS = [
  'offset',
  'limit',
  'startLine',
  'endLine',
  'start_line',
  'end_line',
  'range',
  'viewRange',
  'view_range',
] as const;

function filePathFrom(args: Record<string, unknown>): string | undefined {
  for (const key of FILE_PATH_KEYS) {
    const value = args[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}

function isTargeted(args: Record<string, unknown>): boolean {
  return RANGE_KEYS.some((key) => args[key] != null);
}

export function handleCopilotPostToolUse(
  payloadJson: string,
  mode: Mode,
  markerStyle?: MarkerStyle,
): CopilotHookResult {
  try {
    if (mode === 'full') {
      return { output: null };
    }
    const payload: unknown = JSON.parse(payloadJson);
    if (!isRecord(payload)) {
      return { output: null };
    }
    const toolName = typeof payload['toolName'] === 'string' ? payload['toolName'] : '';
    const toolArgs = parseToolArgs(payload['toolArgs']);
    const tool = toolKindFor(toolName);
    const sessionId =
      typeof payload['sessionId'] === 'string' ? payload['sessionId'] : undefined;
    const toolResult = payload['toolResult'];

    // postToolUse is success-only; if a non-success result ever arrives,
    // emitting modifiedResult (which forces resultType "success") would
    // rewrite a failure into a success. Never do that.
    if (
      isRecord(toolResult) &&
      toolResult['resultType'] !== undefined &&
      toolResult['resultType'] !== 'success'
    ) {
      return { output: null };
    }

    // CCR passthrough guard (§3): never re-compress the output of a
    // `compressor retrieve` command — that slice was deliberately pulled back
    // in full. Copilot's bash command lives in the (sniffed) toolArgs.
    if (tool === 'bash' && isCompressorRetrieve(toolArgs['command'])) {
      return { output: null };
    }

    // Documented shape: the text the model sees is toolResult.textResultForLlm.
    // Unknown shapes fall back to the generic longest-string-leaf walk.
    let text: string | null = null;
    let genericLeaf: Leaf | null = null;
    if (isRecord(toolResult) && typeof toolResult['textResultForLlm'] === 'string') {
      text = toolResult['textResultForLlm'];
    } else {
      genericLeaf = pickLeaf(toolResult, tool);
      if (genericLeaf === null) {
        return { output: null };
      }
      text = genericLeaf.text;
    }

    const raw: CompressibleCall = {
      toolKind: tool,
      targeted: tool === 'read' && isTargeted(toolArgs),
      text,
    };
    const filePath = tool === 'read' ? filePathFrom(toolArgs) : undefined;
    if (filePath !== undefined) {
      raw.filePath = filePath;
    }
    // Recovery-read budget: a targeted read past the session's budget for a
    // previously-truncated file is demoted to untargeted (compressed).
    const call = applyRecoveryBudget(raw, sessionId);

    const compressed = compressCall(call, mode, markerStyle, sessionId);
    if (!compressed.worthwhile) {
      return { output: null };
    }
    noteTruncationIfCut(sessionId, call, compressed);
    recordCompression('copilot', call, compressed, mode);

    // The replacement schema carries exactly one string. Documented shape (or
    // a bare-string result): the compressed text IS the replacement. Unknown
    // structured shapes: rebuild the structure with only the big leaf
    // rewritten (siblings preserved) and render it as JSON.
    const replacement =
      genericLeaf === null || genericLeaf.path.length === 0
        ? compressed.text
        : JSON.stringify(rebuildWithLeaf(toolResult, genericLeaf.path, compressed.text));

    return {
      output: JSON.stringify({
        modifiedResult: {
          resultType: 'success',
          textResultForLlm: replacement,
        },
      }),
    };
  } catch {
    return { output: null };
  }
}
