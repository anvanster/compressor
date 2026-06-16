import process from 'node:process';
import type { MarkerStyle } from './engine/types.ts';
import { applyCcrArg } from './hook/ccr.ts';
import { settleThenExit } from './hook/exit.ts';
import { handlePostToolUse } from './hook/post-tool-use.ts';
import { applyRecoveryBudgetArg } from './hook/recovery.ts';

// PostToolUse hook entry, bundled to dist/hook.js. Fail-open: any failure
// means emit nothing and exit 0 so the original tool output passes through.

function parseMode(argv: readonly string[]): 'full' | 'optimized' | 'slim' {
  const idx = argv.indexOf('--mode');
  const value = idx === -1 ? undefined : argv[idx + 1];
  return value === 'full' || value === 'optimized' || value === 'slim' ? value : 'optimized';
}

/** Fail-open: unknown or missing style falls back to the policy default. */
function parseMarkerStyle(argv: readonly string[]): MarkerStyle | undefined {
  const idx = argv.indexOf('--marker-style');
  const value = idx === -1 ? undefined : argv[idx + 1];
  return value === 'plain' || value === 'deterrent' || value === 'informative'
    ? value
    : undefined;
}

async function main(): Promise<string | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const payload = Buffer.concat(chunks).toString('utf8');
  applyRecoveryBudgetArg(process.argv);
  applyCcrArg(process.argv);
  return handlePostToolUse(payload, parseMode(process.argv), parseMarkerStyle(process.argv))
    .output;
}

// Exit path shared with the copilot entry and the CLI subcommands
// (src/hook/exit.ts): stdout first, state settle (ledger + recovery budget)
// capped at 250ms, SIGKILL on timeout so a stuck filesystem can never hang
// the agent.
main().then(
  (output) => {
    settleThenExit(output).catch(() => process.exit(0));
  },
  () => {
    settleThenExit(null).catch(() => process.exit(0));
  },
);
