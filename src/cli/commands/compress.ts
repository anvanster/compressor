import process from 'node:process';
import { compress, policyFor } from '../../engine/index.ts';
import type { CompressMeta, Mode, ToolKind } from '../../engine/types.ts';
import { tiktokenEstimator } from '../../tokens/estimate.ts';

export interface CompressOptions {
  mode?: string;
  kind?: string;
  filePath?: string;
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseMode(value: string): Mode {
  if (value === 'full' || value === 'optimized' || value === 'slim') {
    return value;
  }
  throw new Error(`unknown mode '${value}' (expected full|optimized|slim)`);
}

function parseKind(value: string): ToolKind {
  if (value === 'read' || value === 'bash' || value === 'search' || value === 'other') {
    return value;
  }
  throw new Error(`unknown kind '${value}' (expected read|bash|search|other)`);
}

export async function runCompress(opts: CompressOptions): Promise<void> {
  const mode = parseMode(opts.mode ?? 'optimized');
  const meta: CompressMeta = { tool: parseKind(opts.kind ?? 'other'), mode };
  if (opts.filePath !== undefined) {
    meta.filePath = opts.filePath;
  }
  const text = await readStdin();
  const result = compress(text, meta, policyFor(mode), tiktokenEstimator());
  process.stdout.write(result.content);
  const { estTokensIn, estTokensOut, kind, transforms } = result.stats;
  const pct =
    estTokensIn === 0 ? 0 : Math.round(((estTokensIn - estTokensOut) / estTokensIn) * 100);
  const ids = transforms.map((t) => t.id).join(',');
  process.stderr.write(
    `kind=${kind} ~${estTokensIn} → ~${estTokensOut} est tokens (estimated; -${pct}%) transforms=${ids}\n`,
  );
}
