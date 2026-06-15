import type { Mode, ToolKind } from '../engine/types.ts';
import type { CompressibleCall } from './core.ts';
import {
  applyRecoveryBudget,
  compressCall,
  isCompressorRetrieve,
  isRecord,
  noteTruncationIfCut,
  recordCompression,
} from './core.ts';

// OpenCode tool.execute.after protocol layer — runs IN-PROCESS inside
// OpenCode's plugin runtime (no subprocess, no stdin/stdout envelope, no
// settle/exit dance: OpenCode is long-lived, so the fire-and-forget ledger
// and recovery-budget writes flush naturally).
//
// Hook signature verified verbatim from the plugin package source
// (sst/opencode packages/plugin/src/index.ts, fetched 2026-06-12):
//
//   "tool.execute.after"?: (
//     input: { tool: string; sessionID: string; callID: string; args: any },
//     output: { title: string; output: string; metadata: any },
//   ) => Promise<void>
//
// `output` is MUTABLE — output.output is the string the model sees, and the
// loader (packages/opencode/src/plugin/index.ts) passes the same object to
// every hook and back to the caller, so assigning output.output IS the
// replacement mechanism. FAIL-OPEN everywhere: the host must never see an
// exception from this hook.

/**
 * OpenCode built-in tool ids verified from https://opencode.ai/docs/tools/
 * (fetched 2026-06-12): bash, edit, write, read, grep, glob, lsp, apply_patch,
 * skill, todowrite, webfetch, websearch, question. Only the output-heavy ones
 * get a specific ToolKind; everything else is 'other' (conservative policy).
 */
function toolKindFor(toolName: string): ToolKind {
  switch (toolName) {
    case 'read':
      return 'read';
    case 'bash':
      return 'bash';
    case 'grep':
    case 'glob':
      return 'search';
    default:
      return 'other';
  }
}

/**
 * Handle one tool.execute.after invocation: compress output.output in place
 * when worthwhile, leave everything else untouched. Both parameters are
 * treated as unknown and validated field-by-field — garbage shapes are a
 * silent no-op, never a throw.
 *
 * Read-tool argument names verified from the tool schema
 * (sst/opencode packages/opencode/src/tool/read.ts, fetched 2026-06-12):
 * filePath (absolute path), offset (1-indexed start line, optional),
 * limit (max lines, optional). offset/limit present = targeted read.
 */
export function handleToolExecuteAfter(input: unknown, output: unknown, mode: Mode): void {
  try {
    if (mode === 'full') {
      return;
    }
    if (!isRecord(input) || !isRecord(output)) {
      return;
    }
    const text = output['output'];
    if (typeof text !== 'string') {
      return;
    }
    const toolName = typeof input['tool'] === 'string' ? input['tool'] : '';
    const tool = toolKindFor(toolName);
    const sessionId =
      typeof input['sessionID'] === 'string' ? input['sessionID'] : undefined;
    const args = isRecord(input['args']) ? input['args'] : {};

    // CCR passthrough guard (§3): never re-compress the output of a
    // `compressor retrieve` command — that slice was deliberately pulled back
    // in full. OpenCode's bash command lives in input.args.command.
    if (tool === 'bash' && isCompressorRetrieve(args['command'])) {
      return;
    }

    const raw: CompressibleCall = {
      toolKind: tool,
      targeted: tool === 'read' && (args['offset'] != null || args['limit'] != null),
      text,
    };
    if (tool === 'read' && typeof args['filePath'] === 'string') {
      raw.filePath = args['filePath'];
    }
    // Recovery-read budget: a targeted read past the session's budget for a
    // previously-truncated file is demoted to untargeted (compressed).
    const call = applyRecoveryBudget(raw, sessionId);

    // markerStyle stays default (undefined) for OpenCode; sessionId scopes the
    // CCR stash so retrieve handles point at this session's chunks.
    const compressed = compressCall(call, mode, undefined, sessionId);
    if (!compressed.worthwhile) {
      return;
    }
    noteTruncationIfCut(sessionId, call, compressed);
    recordCompression('opencode', call, compressed, mode);

    // MUTABLE by protocol: this assignment is the output replacement.
    output['output'] = compressed.text;
  } catch {
    // FAIL-OPEN: a broken hook must never break the user's agent.
  }
}

/**
 * The hooks object a plugin instance returns. Parameters are typed unknown on
 * purpose: this layer validates everything itself, so a host-side type drift
 * degrades to a no-op instead of a crash.
 */
export interface OpencodeHooks {
  'tool.execute.after': (input: unknown, output: unknown) => Promise<void>;
}

/**
 * Plugin shape verified from https://opencode.ai/docs/plugins/ (fetched
 * 2026-06-12) — a plugin file exports an async function receiving the plugin
 * context and returning a hooks object:
 *
 *   export const MyPlugin = async ({ project, client, $, directory, worktree }) => {
 *     return {
 *       // Hook implementations
 *     }
 *   }
 *
 * The loader calls every module export as a plugin function (and throws on
 * non-function exports), so the bundle entry exports functions only.
 */
export type OpencodePlugin = (ctx?: unknown) => Promise<OpencodeHooks>;

function isMode(value: unknown): value is Mode {
  return value === 'full' || value === 'optimized' || value === 'slim';
}

/**
 * Plugin factory pinned to a mode. Junk mode falls back to 'optimized'
 * (mirrors the other hook entries' --mode parsing) — this also keeps the
 * factory harmless if OpenCode's loader ever invokes the factory EXPORT as a
 * plugin (its PluginInput argument is not a mode → default; the returned
 * value is a function the loader treats as a hookless plugin instance).
 */
export function createCompressorPlugin(mode: unknown): OpencodePlugin {
  const resolved: Mode = isMode(mode) ? mode : 'optimized';
  return async () => ({
    'tool.execute.after': async (input: unknown, output: unknown): Promise<void> => {
      handleToolExecuteAfter(input, output, resolved);
    },
  });
}
