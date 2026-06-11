import type { MarkerStyle, Mode, ToolKind } from '../engine/types.ts';
import type { CompressibleCall } from './core.ts';
import { compressCall, isRecord, pickLeaf, rebuildWithLeaf, recordCompression } from './core.ts';

// Claude Code PostToolUse protocol layer. Reads the snake_case payload
// (tool_name/tool_input/tool_response), compresses via the shared core, and
// replies with the hookSpecificOutput.updatedToolOutput envelope. No-op:
// output null (emit nothing). FAIL-OPEN everywhere.

export interface HookResult {
  output: string | null;
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

export function handlePostToolUse(
  payloadJson: string,
  mode: Mode,
  markerStyle?: MarkerStyle,
): HookResult {
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
    const tool = toolKindFor(toolName);

    const leaf = pickLeaf(payload['tool_response'], tool);
    if (leaf === null) {
      return { output: null };
    }

    const call: CompressibleCall = {
      toolKind: tool,
      targeted:
        tool === 'read' && (toolInput['offset'] != null || toolInput['limit'] != null),
      text: leaf.text,
    };
    if (tool === 'read' && typeof toolInput['file_path'] === 'string') {
      call.filePath = toolInput['file_path'];
    }

    const compressed = compressCall(call, mode, markerStyle);
    if (!compressed.worthwhile) {
      return { output: null };
    }
    recordCompression('claude-code', call, compressed, mode);

    const updatedToolOutput = rebuildWithLeaf(payload['tool_response'], leaf.path, compressed.text);
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
