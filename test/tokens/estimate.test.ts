import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheapEstimator, tiktokenEstimator, estimateTokens } from '../../src/tokens/estimate.ts';
import { countTokensExact } from '../../src/tokens/exact.ts';

const LONG_CODE = `
export function readSessionUsage(file: string): Promise<SessionUsage> {
  const turns = new Map<string, Turn>();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
  }
  return { sessionId, file, turns: turns.size, totals, byModel, sidechain };
}
`.repeat(3);

test('cheapEstimator is deterministic and matches the chars/3.5 formula', () => {
  const input = 'some representative tool output text';
  assert.equal(cheapEstimator(input), cheapEstimator(input));
  assert.equal(cheapEstimator(input), Math.ceil(input.length / 3.5));
  assert.equal(cheapEstimator(''), 0);
});

test('cheapEstimator is monotonic in input length', () => {
  let prev = 0;
  for (const len of [1, 2, 10, 50, 200, 1000, 5000]) {
    const est = cheapEstimator('x'.repeat(len));
    assert.ok(est >= prev, `estimate for len=${len} (${est}) >= previous (${prev})`);
    prev = est;
  }
});

test('tiktokenEstimator returns plausible counts', () => {
  const estimate = tiktokenEstimator();
  const hello = estimate('hello world');
  assert.ok(hello >= 1 && hello <= 5, `"hello world" = ${hello} tokens, expected 1..5`);
  const code = estimate(LONG_CODE);
  assert.ok(code > 50, `long code string = ${code} tokens, expected > 50`);
});

test('tiktokenEstimator caches: repeated calls produce identical results', () => {
  const a = tiktokenEstimator();
  const b = tiktokenEstimator();
  for (const input of ['hello world', LONG_CODE, '', 'naïve — emoji 🎉 text']) {
    assert.equal(a(input), b(input));
  }
  assert.equal(estimateTokens(LONG_CODE), a(LONG_CODE));
});

test('countTokensExact throws a clear error without ANTHROPIC_API_KEY', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(
      countTokensExact('hello world'),
      /ANTHROPIC_API_KEY required for --exact counts; estimated counts work without it/,
    );
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});
