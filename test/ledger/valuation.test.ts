import test from 'node:test';
import assert from 'node:assert/strict';
import type { LedgerEvent } from '../../src/ledger/write.ts';
import type { ValuationRate } from '../../src/ledger/valuation.ts';
import { COPILOT_AGENTS, formatUsd, valueSavings } from '../../src/ledger/valuation.ts';

// Pure-module contract for pricing ledger savings: agent partitioning, the
// daily series, and the refusal to price agents the rate does not cover.

function event(overrides: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    ts: '2026-06-10T12:00:00.000Z',
    agent: 'vscode',
    tool: 'read',
    mode: 'optimized',
    charsIn: 4000,
    charsOut: 1000,
    estTokensIn: 1_000_000,
    estTokensOut: 0,
    transforms: ['skeleton'],
    ...overrides,
  };
}

/** 100 credits per 1M prompt tokens → $1.00 per million saved tokens. */
const rate: ValuationRate = {
  creditsPerMillionInput: 100,
  models: ['gpt-5.2'],
  source: 'account catalog',
};

test('valueSavings: saved tokens priced at the input rate', () => {
  const valuation = valueSavings([event()], rate);
  assert.deepEqual(valuation.valued, { tokens: 1_000_000, events: 1, credits: 100, usd: 1 });
  assert.deepEqual(valuation.unvalued, { tokens: 0, events: 0, byAgent: [] });
});

test('valueSavings: a cache-read rate makes the total a range', () => {
  const valuation = valueSavings([event()], { ...rate, cachedCreditsPerMillionInput: 10 });
  assert.equal(valuation.valued.usd, 1, 'the headline stays the ceiling');
  assert.equal(valuation.valued.creditsLow, 10);
  assert.equal(valuation.valued.usdLow, 0.1);
});

test('valueSavings: savings are net of the compressed output', () => {
  const valuation = valueSavings([event({ estTokensIn: 1_000_000, estTokensOut: 250_000 })], rate);
  assert.equal(valuation.valued.tokens, 750_000);
  assert.equal(valuation.valued.credits, 75);
});

test('valueSavings: agents outside the rate are reported, never priced', () => {
  const valuation = valueSavings(
    [
      event({ agent: 'vscode' }),
      event({ agent: 'copilot' }),
      event({ agent: 'claude-code', estTokensIn: 500_000 }),
      event({ agent: 'opencode', estTokensIn: 200_000 }),
    ],
    rate,
  );
  assert.equal(valuation.valued.events, 2);
  assert.equal(valuation.valued.credits, 200);
  assert.equal(valuation.unvalued.events, 2);
  assert.equal(valuation.unvalued.tokens, 700_000);
  assert.deepEqual(valuation.unvalued.byAgent, [
    { agent: 'claude-code', tokens: 500_000, events: 1 },
    { agent: 'opencode', tokens: 200_000, events: 1 },
  ]);
});

test('COPILOT_AGENTS covers both Copilot surfaces and nothing else', () => {
  assert.deepEqual([...COPILOT_AGENTS].sort(), ['copilot', 'vscode']);
});

test('valueSavings: an explicit agent set overrides the default', () => {
  const valuation = valueSavings([event({ agent: 'claude-code' })], {
    ...rate,
    source: 'anthropic rates',
    agents: new Set<LedgerEvent['agent']>(['claude-code']),
  });
  assert.equal(valuation.valued.events, 1);
  assert.equal(valuation.unvalued.events, 0);
});

test('valueSavings: daily series is ascending and covers valued events only', () => {
  const valuation = valueSavings(
    [
      event({ ts: '2026-06-11T09:00:00.000Z', estTokensIn: 400_000 }),
      event({ ts: '2026-06-09T10:00:00.000Z', estTokensIn: 100_000 }),
      event({ ts: '2026-06-09T23:59:59.000Z', estTokensIn: 100_000 }),
      event({ ts: '2026-06-10T10:00:00.000Z', agent: 'claude-code', estTokensIn: 900_000 }),
    ],
    rate,
  );
  assert.deepEqual(valuation.byDay, [
    { date: '2026-06-09', tokens: 200_000, credits: 20, usd: 0.2 },
    { date: '2026-06-11', tokens: 400_000, credits: 40, usd: 0.4 },
  ]);
});

test('valueSavings: empty window yields zeros, not NaN', () => {
  const valuation = valueSavings([], rate);
  assert.deepEqual(valuation.valued, { tokens: 0, events: 0, credits: 0, usd: 0 });
  assert.deepEqual(valuation.byDay, []);
});

test('formatUsd: sub-cent totals are not rounded away to $0.00', () => {
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(0.004), '<$0.01');
  assert.equal(formatUsd(1234.5), '$1,234.50');
});

test('valuation + pricing symbols reach the PACKAGE ROOT barrel (two-barrel rule)', async () => {
  // The VS Code extension imports from '@astudioplus/compressor', so a
  // local-barrel-only export is unreachable to the only consumer that needs it.
  const root = (await import('../../src/index.ts')) as Record<string, unknown>;
  for (const name of [
    'valueSavings',
    'formatUsd',
    'COPILOT_AGENTS',
    'valuationHtml',
    'parseCopilotCatalog',
    'blendInputRate',
    'normalizeModelId',
    'creditsForTokens',
    'creditsToUsd',
    'AI_CREDIT_USD',
  ]) {
    assert.ok(root[name] !== undefined, `${name} must be exported from src/index.ts`);
  }
});
