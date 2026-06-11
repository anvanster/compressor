import type { MarkerStyle, Mode } from '../../engine/types.ts';
import { handleCopilotPostToolUse } from '../../hook/copilot.ts';
import { settleThenExit } from '../../hook/exit.ts';
import { handlePostToolUse } from '../../hook/post-tool-use.ts';
import { readStdin } from './compress.ts';

export interface HookCliOptions {
  mode?: string;
  markerStyle?: string;
}

function parseMode(value: string): Mode {
  return value === 'full' || value === 'optimized' || value === 'slim' ? value : 'optimized';
}

/** Fail-open (hook hot path): unknown style falls back to the policy default. */
function parseMarkerStyle(value: string | undefined): MarkerStyle | undefined {
  return value === 'plain' || value === 'deterrent' || value === 'informative'
    ? value
    : undefined;
}

// Both actions are documented protocol surfaces a user can wire into
// .claude/settings.json or .github/hooks, so they need the SAME hot-path
// bound as the bundles: settleThenExit writes stdout first, caps the ledger
// settle at 250ms, and force-terminates on timeout. Without it the process
// exits only when the event loop drains — i.e. after the fire-and-forget
// ledger append completes, which is unbounded on a slow disk and infinite on
// a stuck one. These functions therefore never return.

export async function runHookPostToolUse(opts: HookCliOptions): Promise<void> {
  const payload = await readStdin();
  const result = handlePostToolUse(
    payload,
    parseMode(opts.mode ?? 'optimized'),
    parseMarkerStyle(opts.markerStyle),
  );
  await settleThenExit(result.output);
}

export async function runHookCopilotPostToolUse(opts: HookCliOptions): Promise<void> {
  const payload = await readStdin();
  const result = handleCopilotPostToolUse(
    payload,
    parseMode(opts.mode ?? 'optimized'),
    parseMarkerStyle(opts.markerStyle),
  );
  await settleThenExit(result.output);
}
