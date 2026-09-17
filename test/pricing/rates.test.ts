import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_CREDIT_USD,
  blendInputRate,
  creditsForTokens,
  creditsToUsd,
  normalizeModelId,
  parseCopilotCatalog,
} from '../../src/pricing/rates.ts';

// Pure-module contract for rate resolution: id normalization, the catalog
// shape VS Code's Copilot Chat writes, and mix blending. No IO anywhere —
// catalogs are fixture strings.

test('normalizeModelId: strips a vendor prefix and normalizes separators', () => {
  assert.equal(normalizeModelId('  Copilot/GPT-5 mini '), 'gpt-5-mini');
  assert.equal(normalizeModelId('GPT_5_MINI'), 'gpt-5-mini');
  assert.equal(normalizeModelId('gpt-5-mini'), 'gpt-5-mini');
});

test('normalizeModelId: a trailing version pair collapses to a decimal', () => {
  assert.equal(normalizeModelId('gpt-5-2'), 'gpt-5.2');
  assert.equal(normalizeModelId('gpt-5.2'), 'gpt-5.2');
  assert.equal(normalizeModelId('claude-sonnet-4-5'), 'claude-sonnet-4.5');
  // not a trailing pair: a suffixed variant keeps its shape
  assert.equal(normalizeModelId('gpt-5.2-codex'), 'gpt-5.2-codex');
});

const CATALOG = JSON.stringify([
  {
    id: 'gpt-5.2',
    capabilities: { family: 'gpt-5.2' },
    is_chat_default: true,
    billing: {
      token_prices: { default: { input_price: 175, output_price: 1400, cache_read_price: 17 } },
    },
  },
  {
    id: 'claude-sonnet-4.5',
    capabilities: { family: 'claude-sonnet-4-5' },
    billing: {
      token_prices: { default: { input_price: 300, output_price: 1500, cache_read_price: 30 } },
    },
  },
]);

test('parseCopilotCatalog: rates are read as credits per million, under both keys', () => {
  const { rates } = parseCopilotCatalog(CATALOG);
  assert.deepEqual(rates.get('gpt-5.2'), {
    inputPerMillion: 175,
    outputPerMillion: 1400,
    cachedInputPerMillion: 17,
  });
  // the entry's family spells the version with a dash; both resolve to one key
  assert.deepEqual(rates.get('claude-sonnet-4.5'), {
    inputPerMillion: 300,
    outputPerMillion: 1500,
    cachedInputPerMillion: 30,
  });
  assert.equal(rates.size, 2);
});

test('parseCopilotCatalog: the catalog names its own default model', () => {
  assert.equal(parseCopilotCatalog(CATALOG).defaultModelId, 'gpt-5.2');
  // no flag set is an absent default, never a guessed one
  assert.equal(parseCopilotCatalog(JSON.stringify([
    { id: 'a', billing: { token_prices: { default: { input_price: 1, output_price: 2 } } } },
  ])).defaultModelId, undefined);
});

test('parseCopilotCatalog: fails open on anything unexpected', () => {
  assert.equal(parseCopilotCatalog('not json').rates.size, 0);
  assert.equal(parseCopilotCatalog('{"models":[]}').rates.size, 0);
  assert.equal(parseCopilotCatalog('[null, 3, "x"]').rates.size, 0);
});

test('parseCopilotCatalog: an entry without usable prices is skipped, not fatal', () => {
  const { rates } = parseCopilotCatalog(
    JSON.stringify([
      { id: 'no-billing' },
      { id: 'bad-price', billing: { token_prices: { default: { input_price: 'free', output_price: 1 } } } },
      { id: 'negative', billing: { token_prices: { default: { input_price: -5, output_price: 1 } } } },
      { id: 'ok', billing: { token_prices: { default: { input_price: 10, output_price: 20 } } } },
    ]),
  );
  assert.deepEqual([...rates.keys()], ['ok']);
});

test('blendInputRate: weighted average of the input side only', () => {
  const { rates } = parseCopilotCatalog(CATALOG);
  const blended = blendInputRate(
    [
      { modelId: 'gpt-5.2', weight: 3 },
      { modelId: 'claude-sonnet-4.5', weight: 1 },
    ],
    rates,
  );
  assert.equal(blended?.creditsPerMillionInput, (3 * 175 + 1 * 300) / 4);
  assert.equal(blended?.cachedCreditsPerMillionInput, (3 * 17 + 1 * 30) / 4);
  assert.deepEqual(blended?.models, ['gpt-5.2', 'claude-sonnet-4.5']);
});

test('blendInputRate: a cache-read bound needs every model to state one', () => {
  const { rates } = parseCopilotCatalog(
    JSON.stringify([
      { id: 'cached', billing: { token_prices: { default: { input_price: 100, output_price: 1, cache_read_price: 10 } } } },
      { id: 'uncached', billing: { token_prices: { default: { input_price: 100, output_price: 1 } } } },
    ]),
  );
  const blended = blendInputRate(
    [{ modelId: 'cached', weight: 1 }, { modelId: 'uncached', weight: 1 }],
    rates,
  );
  assert.equal(blended?.creditsPerMillionInput, 100);
  assert.equal(blended?.cachedCreditsPerMillionInput, undefined, 'a partial blend would mix meanings');
});

test('blendInputRate: unpriced models are dropped and the rest renormalized', () => {
  const { rates } = parseCopilotCatalog(CATALOG);
  const blended = blendInputRate(
    [
      { modelId: 'gpt-5.2', weight: 1 },
      { modelId: 'some-model-we-cannot-price', weight: 99 },
    ],
    rates,
  );
  // the unpriced model must not drag the average toward zero
  assert.equal(blended?.creditsPerMillionInput, 175);
  assert.deepEqual(blended?.models, ['gpt-5.2']);
});

test('blendInputRate: nothing priceable yields undefined, not a zero rate', () => {
  assert.equal(blendInputRate([{ modelId: 'unknown', weight: 1 }], new Map()), undefined);
  assert.equal(blendInputRate([], parseCopilotCatalog(CATALOG).rates), undefined);
  assert.equal(
    blendInputRate([{ modelId: 'gpt-5.2', weight: 0 }], parseCopilotCatalog(CATALOG).rates),
    undefined,
  );
});

test('credits convert to USD at one cent each', () => {
  assert.equal(AI_CREDIT_USD, 0.01);
  assert.equal(creditsForTokens(2_000_000, 175), 350);
  assert.equal(creditsToUsd(350), 3.5);
});
