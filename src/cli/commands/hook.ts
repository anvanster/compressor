import process from 'node:process';
import type { Mode } from '../../engine/types.ts';
import { handlePostToolUse } from '../../hook/post-tool-use.ts';
import { readStdin } from './compress.ts';

export interface HookCliOptions {
  mode?: string;
}

function parseMode(value: string): Mode {
  return value === 'full' || value === 'optimized' || value === 'slim' ? value : 'optimized';
}

export async function runHookPostToolUse(opts: HookCliOptions): Promise<void> {
  const payload = await readStdin();
  const result = handlePostToolUse(payload, parseMode(opts.mode ?? 'optimized'));
  if (result.output !== null) {
    process.stdout.write(result.output);
  }
}
