import process from 'node:process';
import { handleCopilotPostToolUse } from './hook/copilot.ts';

// Copilot postToolUse hook entry, bundled to dist/copilot-hook.js. Fail-open:
// any failure means emit nothing and exit 0 so the original tool result
// passes through (Copilot parses stdout as the hook output JSON only when
// present; empty stdout = no-op).

function parseMode(argv: readonly string[]): 'full' | 'optimized' | 'slim' {
  const idx = argv.indexOf('--mode');
  const value = idx === -1 ? undefined : argv[idx + 1];
  return value === 'full' || value === 'optimized' || value === 'slim' ? value : 'optimized';
}

async function main(): Promise<string | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const payload = Buffer.concat(chunks).toString('utf8');
  return handleCopilotPostToolUse(payload, parseMode(process.argv)).output;
}

main().then(
  (output) => {
    if (output !== null) {
      process.stdout.write(output, () => process.exit(0));
    } else {
      process.exit(0);
    }
  },
  () => process.exit(0),
);
