import test from 'node:test';
import assert from 'node:assert/strict';
import type { LlmRequest } from '../../src/copilot/debug-log.ts';
import type { LedgerEvent } from '../../src/ledger/write.ts';
import {
  aggregateCopilotUsage,
  cacheHitRate,
  effectivePromptCreditsPerMillion,
  savingsShare,
  usageAiu,
  usageModelWeights,
} from '../../src/copilot/usage.ts';

// Aggregation contract for real Copilot usage, and the savings/usage join.
// Hand-built records only; the reader that produces them is tested separately.

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    ts: Date.UTC(2026, 8, 10, 12),
    sessionId: 'session-a',
    model: 'gpt-5.2',
    inputTokens: 1000,
    outputTokens: 200,
    durationMs: 1500,
    status: 'ok',
    ...overrides,
  };
}

function event(overrides: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    ts: '2026-09-10T12:00:00.000Z',
    agent: 'vscode',
    tool: 'read',
    mode: 'optimized',
    charsIn: 4000,
    charsOut: 1000,
    estTokensIn: 1000,
    estTokensOut: 0,
    transforms: ['skeleton'],
    ...overrides,
  };
}

test('aggregateUsage: totals, sessions and errors', () => {
  const summary = aggregateCopilotUsage([
    request(),
    request({ sessionId: 'session-b', inputTokens: 500, outputTokens: 100 }),
    request({ sessionId: 'session-b', status: 'error', inputTokens: 10, outputTokens: 0 }),
  ]);
  assert.equal(summary.totals.requests, 3);
  assert.equal(summary.totals.inputTokens, 1510);
  assert.equal(summary.totals.outputTokens, 300);
  assert.equal(summary.sessions, 2);
  assert.equal(summary.errors, 1);
});

test('aggregateUsage: unreported counters are counted, never summed as zero', () => {
  const summary = aggregateCopilotUsage([
    request({ inputTokens: 1000, outputTokens: undefined }),
    request({ inputTokens: undefined, outputTokens: 50 }),
  ]);
  assert.equal(summary.totals.inputTokens, 1000, 'the total is a floor over 2 requests');
  assert.equal(summary.totals.inputUnknown, 1);
  assert.equal(summary.totals.outputUnknown, 1);
  assert.equal(summary.totals.requests, 2);
});

test('aggregateUsage: by model, heaviest input first', () => {
  const summary = aggregateCopilotUsage([
    request({ model: 'gpt-5-mini', inputTokens: 100 }),
    request({ model: 'claude-sonnet-4.5', inputTokens: 900 }),
    request({ model: 'gpt-5-mini', inputTokens: 300 }),
  ]);
  assert.deepEqual(summary.byModel.map((m) => [m.model, m.inputTokens, m.requests]), [
    ['claude-sonnet-4.5', 900, 1],
    ['gpt-5-mini', 400, 2],
  ]);
});

test('aggregateUsage: by day, ascending and grouped in UTC like the ledger', () => {
  const summary = aggregateCopilotUsage([
    request({ ts: Date.UTC(2026, 8, 11, 1), inputTokens: 5 }),
    request({ ts: Date.UTC(2026, 8, 10, 23, 59), inputTokens: 7 }),
  ]);
  assert.deepEqual(summary.byDay.map((d) => [d.date, d.inputTokens]), [
    ['2026-09-10', 7],
    ['2026-09-11', 5],
  ]);
  assert.equal(summary.firstTs, Date.UTC(2026, 8, 10, 23, 59));
  assert.equal(summary.lastTs, Date.UTC(2026, 8, 11, 1));
});

test('aggregateUsage: empty input is zeros, not NaN or undefined totals', () => {
  const summary = aggregateCopilotUsage([]);
  assert.equal(summary.totals.requests, 0);
  assert.equal(summary.totals.inputTokens, 0);
  assert.equal(summary.totals.nanoAiu, 0);
  assert.deepEqual(summary.byDay, []);
  assert.equal(summary.firstTs, undefined);
});

test('usageModelWeights: weights by real input tokens, skipping unidentified models', () => {
  const summary = aggregateCopilotUsage([
    request({ model: 'gpt-5.2', inputTokens: 900 }),
    request({ model: 'unknown', inputTokens: 500 }),
    request({ model: 'gpt-5-mini', inputTokens: 100 }),
  ]);
  assert.deepEqual(usageModelWeights(summary), [
    { modelId: 'gpt-5.2', weight: 900 },
    { modelId: 'gpt-5-mini', weight: 100 },
  ]);
});

test('savingsShare: fraction of the counterfactual prompt that was removed', () => {
  const summary = aggregateCopilotUsage([request({ inputTokens: 3000 })]);
  const share = savingsShare([event({ estTokensIn: 1000, estTokensOut: 0 })], summary);
  assert.deepEqual(share, {
    savedTokens: 1000,
    sentInputTokens: 3000,
    share: 0.25,
    sentUnknownRequests: 0,
  });
});

test('savingsShare: only Copilot agents count toward the numerator', () => {
  const summary = aggregateCopilotUsage([request({ inputTokens: 1000 })]);
  const share = savingsShare(
    [
      event({ agent: 'vscode', estTokensIn: 500, estTokensOut: 0 }),
      event({ agent: 'copilot', estTokensIn: 500, estTokensOut: 0 }),
      event({ agent: 'claude-code', estTokensIn: 9000, estTokensOut: 0 }),
    ],
    summary,
  );
  assert.equal(share.savedTokens, 1000, 'Claude Code savings are not Copilot prompt savings');
  assert.equal(share.share, 0.5);
});

test('savingsShare: nothing to compare yields 0, not a division by zero', () => {
  assert.equal(savingsShare([], aggregateCopilotUsage([])).share, 0);
});

test('savingsShare: carries the unreported-request count so the ratio can be qualified', () => {
  const summary = aggregateCopilotUsage([request({ inputTokens: undefined }), request({ inputTokens: 1000 })]);
  assert.equal(savingsShare([event()], summary).sentUnknownRequests, 1);
});

test('usage symbols reach the PACKAGE ROOT barrel (two-barrel rule)', async () => {
  const root = (await import('../../src/index.ts')) as Record<string, unknown>;
  for (const name of ['aggregateCopilotUsage', 'usageModelWeights', 'savingsShare', 'readLlmRequests', 'probeDebugLog']) {
    assert.ok(root[name] !== undefined, `${name} must be exported from src/index.ts`);
  }
});

// Ground truth: one real claude-opus-5 request, as recorded on disk. The
// provider's own billed figure is 17.1085 AIU, which pins how a prompt token
// is actually priced — uncached input at cache_write, cached at cache_read.
const REAL = {
  inputTokens: 292_801,
  cachedTokens: 290_725,
  outputTokens: 510,
  nanoAiu: 17_108_500_000,
};
const OPUS = { cacheRead: 50, cacheWrite: 625, input: 500, output: 2500 };

test('billed AI Units match uncached-at-cache-write + cached-at-cache-read + output', () => {
  const uncached = REAL.inputTokens - REAL.cachedTokens;
  const predicted =
    (uncached * OPUS.cacheWrite + REAL.cachedTokens * OPUS.cacheRead + REAL.outputTokens * OPUS.output) /
    1_000_000;
  assert.ok(Math.abs(predicted - REAL.nanoAiu / 1e9) < 0.001, `predicted ${predicted}`);
});

test('pricing every prompt token at input_price overstates a real bill 8.6x', () => {
  const naive = (REAL.inputTokens * OPUS.input + REAL.outputTokens * OPUS.output) / 1_000_000;
  assert.ok(naive / (REAL.nanoAiu / 1e9) > 8, 'the rate-card model is not a tight upper bound');
});

test('cacheHitRate and usageAiu read the measured split', () => {
  const summary = aggregateCopilotUsage([request(REAL)]);
  assert.equal(Number(usageAiu(summary.totals).toFixed(4)), 17.1085);
  assert.equal(((cacheHitRate(summary.totals) ?? 0) * 100).toFixed(1), '99.3');
  assert.equal(cacheHitRate(aggregateCopilotUsage([]).totals), undefined);
});

test('effectivePromptCreditsPerMillion prices prompt tokens as actually billed', () => {
  const summary = aggregateCopilotUsage([request(REAL)]);
  const rate = effectivePromptCreditsPerMillion(summary.totals, OPUS.output);
  // prompt-side AIU / prompt Mtokens — an order of magnitude under input_price
  assert.ok(rate !== undefined && rate > 50 && rate < 65, `rate ${rate}`);
  assert.ok(rate! < OPUS.input / 8, 'a warm session is nowhere near the rate card');
});

test('effectivePromptCreditsPerMillion declines to guess without the inputs it needs', () => {
  const summary = aggregateCopilotUsage([request(REAL)]);
  assert.equal(effectivePromptCreditsPerMillion(summary.totals, undefined), undefined);
  assert.equal(effectivePromptCreditsPerMillion(aggregateCopilotUsage([]).totals, 2500), undefined);
  // output cost alone exceeding the bill would yield a nonsense negative rate
  assert.equal(effectivePromptCreditsPerMillion(summary.totals, 1_000_000), undefined);
});
