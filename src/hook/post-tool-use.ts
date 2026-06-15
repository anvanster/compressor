import type { MarkerStyle, Mode, ToolKind } from '../engine/types.ts';
import type { CompressibleCall } from './core.ts';
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

// Claude Code PostToolUse protocol layer. Reads the snake_case payload
// (tool_name/tool_input/tool_response), compresses via the shared core, and
// replies with the hookSpecificOutput.updatedToolOutput envelope. No-op:
// output null (emit nothing). FAIL-OPEN everywhere.

export interface HookResult {
  output: string | null;
}

/**
 * In-process enforcement of the matcher the claude-code adapter installs
 * ('Read|Bash|Grep|Glob' — src/adapters/claude-code.ts). Per
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
 * Design consequence: MCP/unknown tools no longer hit the generic leaf path
 * in THIS layer. That path remains available via the copilot layer (whose
 * toolName filtering differs), and can be revisited deliberately if unknown
 * claude-code tool outputs should compress again.
 */
const MATCHER_TOOLS: ReadonlySet<string> = new Set(['Read', 'Bash', 'Grep', 'Glob']);

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
    // Cross-host matcher guard (see MATCHER_TOOLS above): anything outside the
    // installed matcher — VS Code tool names, MCP tools, future built-ins —
    // no-ops immediately: no compression, no ledger, no recovery notes.
    if (!MATCHER_TOOLS.has(toolName)) {
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

    // CCR passthrough guard (§3): the output of `compressor retrieve <handle>`
    // is an exact original slice being pulled back; never re-compress it (that
    // would re-cut and re-stash what the model just deliberately retrieved).
    // Best-effort per layer — Claude Code's Bash command lives in
    // tool_input.command.
    if (tool === 'bash' && isCompressorRetrieve(toolInput['command'])) {
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

    const compressed = compressCall(call, mode, markerStyle, sessionId);
    if (!compressed.worthwhile) {
      return { output: null };
    }
    noteTruncationIfCut(sessionId, call, compressed);
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
