import { createRequire } from 'node:module';
import type { Tiktoken } from 'js-tiktoken';
import type { Estimator } from '../engine/types.ts';

/** Zero-cost estimator for the hook hot path. */
export const cheapEstimator: Estimator = (text) => Math.ceil(text.length / 3.5);

let encoder: Tiktoken | undefined;

/**
 * NOTE: cl100k_base undercounts Claude tokens by ~15-20%. Estimates are for
 * thresholds/UX only, NEVER reported as savings.
 *
 * js-tiktoken (~5.6MB of inlined ranks) is loaded lazily via createRequire so
 * that importing `cheapEstimator` from the bundled hook never pulls it in.
 */
export function tiktokenEstimator(): Estimator {
  if (encoder === undefined) {
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire('js-tiktoken') as typeof import('js-tiktoken');
    encoder = mod.getEncoding('cl100k_base');
  }
  const enc = encoder;
  return (text) => enc.encode(text).length;
}

export function estimateTokens(text: string): number {
  return tiktokenEstimator()(text);
}
