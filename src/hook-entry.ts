import process from 'node:process';
import { handlePostToolUse } from './hook/post-tool-use.ts';

// PostToolUse hook entry, bundled to dist/hook.js. Fail-open: any failure
// means emit nothing and exit 0 so the original tool output passes through.

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
  return handlePostToolUse(payload, parseMode(process.argv)).output;
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
