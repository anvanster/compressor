import type { MarkerStyle, Mode, ToolKind } from '../engine/types.ts';
import type { CompressibleCall } from './core.ts';
import {
  applyRecoveryBudget,
  compressCall,
  isRecord,
  noteTruncationIfCut,
  pickLeaf,
  rebuildWithLeaf,
  recordCompression,
} from './core.ts';

// Claude Code PostToolUse protocol layer. Reads the snake_case payload
// (tool_name/tool_input/tool_response), compresses via the shared core, and
// replies with the hookSpecificOutput.updatedToolOutput envelope. No-op:
// output null (emit nothing). FAIL-OPEN everywhere.

export interface HookResult {
  output: string | null;
}

/**
 * In-process enforcement of the matcher the claude-code adapter installs
 * ('Read|Bash|Grep|Glob|mcp__.*' — src/adapters/claude-code.ts). Per
 * internal/VSCODE-HOOKS-VERIFICATION.md V3, VS Code agent mode executes hooks
 * from the SAME config files our adapters write (.claude/settings.local.json,
 * .claude/settings.json) and "Currently, VS Code ignores matcher values" — so
 * this hook also runs under VS Code on EVERY tool. VS Code's payload is
 * snake_case like Claude Code's with a STRING tool_response and its own tool
 * names (editFiles, createFile, runTerminalCommand, deleteFile, pushToGitHub);
 * without this set, such a payload rides the bare-string/generic leaf path,
 * and while VS Code ignores our replacement output (harmless), the compression
 * would still be LEDGERED — a phantom savings event for a rewrite that was
 * never applied. Enforcing the matcher's promise in-process makes phantom
 * ledger events impossible regardless of which host runs the config file.
 *
 * Design consequence: MCP tools (mcp__*) ARE admitted to the leaf path in THIS
 * layer via the OR clause in the guard below (the regex matcher 'mcp__.*' makes
 * PostToolUse fire for them, and the JSON minify tier reaches their JSON
 * output). VS Code tool names and unknown/future built-ins still no-op
 * immediately — no compression, no ledger — keeping the cross-host guard
 * intact. This aligns with the inline guard comment further down.
 */
const MATCHER_TOOLS: ReadonlySet<string> = new Set(['Read', 'Bash', 'Grep', 'Glob']);

function toolKindFor(toolName: string): ToolKind {
  // MCP tool names are namespaced 'mcp__<server>__<tool>'; all map to 'mcp'.
  if (toolName.startsWith('mcp__')) {
    return 'mcp';
  }
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
    // Cross-host matcher guard (see MATCHER_TOOLS above): allow the installed
    // matcher's built-ins AND MCP tools ('mcp__*', installed via the regex
    // matcher 'mcp__.*'). The PostToolUse hook fires for MCP tools, and the JSON
    // minify tier finally reaches their JSON output. Anything else — VS Code
    // tool names, future built-ins — no-ops immediately: no compression, no
    // ledger, no recovery notes (cross-host guard intact).
    if (!MATCHER_TOOLS.has(toolName) && !toolName.startsWith('mcp__')) {
      return { output: null };
    }
    const toolInput = isRecord(payload['tool_input']) ? payload['tool_input'] : {};
    const tool = toolKindFor(toolName);
    const sessionId =
      typeof payload['session_id'] === 'string' ? payload['session_id'] : undefined;

    const leaf = pickLeaf(payload['tool_response'], tool);
    if (leaf === null) {
      return { output: null };
    }

    const raw: CompressibleCall = {
      toolKind: tool,
      targeted:
        tool === 'read' && (toolInput['offset'] != null || toolInput['limit'] != null),
      text: leaf.text,
    };
    if (tool === 'read' && typeof toolInput['file_path'] === 'string') {
      raw.filePath = toolInput['file_path'];
    }
    // Recovery-read budget: a targeted read past the session's budget for a
    // previously-truncated file is demoted to untargeted (compressed).
    const call = applyRecoveryBudget(raw, sessionId);

    const compressed = compressCall(call, mode, markerStyle);
    if (!compressed.worthwhile) {
      return { output: null };
    }
    noteTruncationIfCut(sessionId, call, compressed);
    recordCompression('claude-code', call, compressed, mode);

    // For MCP, pickLeaf('mcp') finds the JSON text in the content-block array
    // ([{type:'text',text:'<json>'}]) via the longest-string-leaf and
    // rebuildWithLeaf replaces it shape-preservingly. updatedToolOutput is the
    // UNIFIED, current replacement field (works for all tools incl. MCP as of
    // v2.1.121+); updatedMCPToolOutput is the deprecated MCP-only fallback we do
    // NOT emit. If the MCP shape is unrecognized, pickLeaf returned null above
    // and we already no-opped = FAIL OPEN.
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
