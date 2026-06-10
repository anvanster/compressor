import { readFile } from 'node:fs/promises';

export interface CountOptions {
  exact?: boolean;
  model?: string;
}

export async function runCount(files: string[], opts: CountOptions): Promise<void> {
  const model = opts.model ?? 'claude-sonnet-4-6';
  let total = 0;
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (opts.exact === true) {
      const { countTokensExact } = await import('../../tokens/exact.ts');
      const n = await countTokensExact(text, model);
      total += n;
      console.log(`${file}: ${n} tokens (exact, ${model})`);
    } else {
      const { estimateTokens } = await import('../../tokens/estimate.ts');
      const n = estimateTokens(text);
      total += n;
      console.log(`${file}: ~${n} tokens (estimated)`);
    }
  }
  if (files.length > 1) {
    console.log(
      opts.exact === true
        ? `total: ${total} tokens (exact, ${model})`
        : `total: ~${total} tokens (estimated)`,
    );
  }
}
