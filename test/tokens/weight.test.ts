import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIER_WEIGHTS,
  WEIGHT_LEGEND,
  EFFECTIVE_UNIT,
  weightedTokens,
  costWeightedContext,
} from '../../src/tokens/weight.ts';

// Cost-weight tokens by tier so headline figures stop overstating dollars.
// Weights are RATIOS to base input (dollar-proportional, not absolute $).

test('TIER_WEIGHTS are the Anthropic 4.x ratios (input 1, cache-write 1.25, cache-read 0.1, output 5)', () => {
  assert.equal(TIER_WEIGHTS.input, 1);
  assert.equal(TIER_WEIGHTS.cacheCreation, 1.25);
  assert.equal(TIER_WEIGHTS.cacheRead, 0.1);
  assert.equal(TIER_WEIGHTS.output, 5);
});

test('weightedTokens sums all four tiers at their ratios', () => {
  // 1000*1 + 1000*1.25 + 1000*0.1 + 1000*5 = 1000 + 1250 + 100 + 5000 = 7350
  const u = { input: 1000, output: 1000, cacheCreation: 1000, cacheRead: 1000 };
  assert.equal(weightedTokens(u), 7350);
});

test('costWeightedContext is input-side only and EXCLUDES output', () => {
  // 1000*1 + 1000*1.25 + 1000*0.1 = 2350 (no output term)
  const u = { input: 1000, output: 1000, cacheCreation: 1000, cacheRead: 1000 };
  assert.equal(costWeightedContext(u), 2350);
  // output must not move the context number
  assert.equal(
    costWeightedContext({ input: 1000, cacheCreation: 1000, cacheRead: 1000 }),
    costWeightedContext({ input: 1000, cacheCreation: 1000, cacheRead: 1000, output: 999_999 }),
  );
});

test('cache-read collapses ~10x: a huge raw cacheRead barely moves the weighted total', () => {
  // 1,000,000 raw cache-read tokens weigh as only 100,000 input-equiv
  assert.equal(weightedTokens({ cacheRead: 1_000_000 }), 100_000);
  assert.equal(costWeightedContext({ cacheRead: 1_000_000 }), 100_000);
});

test('partial / missing tiers are treated as 0', () => {
  assert.equal(weightedTokens({ input: 500 }), 500);
  assert.equal(weightedTokens({ output: 10 }), 50);
  assert.equal(costWeightedContext({ cacheCreation: 100 }), 125);
  assert.equal(weightedTokens({}), 0);
  assert.equal(costWeightedContext({}), 0);
});

test('zero / undefined / NaN inputs yield finite numbers (NaN-safe, total)', () => {
  for (const u of [
    { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    { input: undefined, output: undefined, cacheCreation: undefined, cacheRead: undefined },
    { input: NaN, output: NaN, cacheCreation: NaN, cacheRead: NaN },
    { input: NaN, cacheRead: 100 },
  ]) {
    assert.ok(Number.isFinite(weightedTokens(u)), `weightedTokens finite for ${JSON.stringify(u)}`);
    assert.ok(
      Number.isFinite(costWeightedContext(u)),
      `costWeightedContext finite for ${JSON.stringify(u)}`,
    );
  }
  // a NaN in one tier must not poison the rest
  assert.equal(weightedTokens({ input: NaN, cacheRead: 100 }), 10);
});

test('labels are short, present, and carry the legend', () => {
  assert.equal(EFFECTIVE_UNIT, 'input-equiv tok');
  assert.match(WEIGHT_LEGEND, /input 1x/);
  assert.match(WEIGHT_LEGEND, /cache-read 0\.1x/);
  assert.match(WEIGHT_LEGEND, /output 5x/);
  assert.match(WEIGHT_LEGEND, /not absolute \$/);
});

test('weight.ts symbols are exported from the PACKAGE ROOT barrel (two-barrel rule)', async () => {
  // 0.3.2 bug: new public API exported from a local barrel but not src/index.ts,
  // so '@astudioplus/compressor' consumers (the VS Code extension) couldn't reach
  // it. Lock the package-root surface for the weight API.
  const root = await import('../../src/index.ts');
  const r = root as Record<string, unknown>;
  assert.equal(typeof r['weightedTokens'], 'function', 'root exports weightedTokens');
  assert.equal(typeof r['costWeightedContext'], 'function', 'root exports costWeightedContext');
  assert.equal(typeof r['TIER_WEIGHTS'], 'object', 'root exports TIER_WEIGHTS');
  assert.equal(typeof r['WEIGHT_LEGEND'], 'string', 'root exports WEIGHT_LEGEND');
  assert.equal(typeof r['EFFECTIVE_UNIT'], 'string', 'root exports EFFECTIVE_UNIT');
  // sanity: the root-imported fn computes the same arithmetic
  assert.equal(
    (r['weightedTokens'] as (u: unknown) => number)({
      input: 1000,
      output: 1000,
      cacheCreation: 1000,
      cacheRead: 1000,
    }),
    7350,
  );
});
