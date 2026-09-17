// Credit rates for GitHub Copilot models.
//
// GitHub meters Copilot usage in "AI credits", where one credit is $0.01 of
// token cost. The per-model rates are not a table this project maintains: VS
// Code's Copilot Chat writes the user's own catalog (models.json) alongside its
// debug logs, and that catalog's token prices are ALREADY denominated in
// credits per 1,000,000 tokens. Reading them back is both more accurate than a
// vendored price list and immune to going stale — so when the catalog is
// missing, this module reports nothing rather than guessing.
//
// PURE: no fs, no process, no console. The caller hands over file contents.

/** USD value of one AI credit. */
export const AI_CREDIT_USD = 0.01;

const TOKENS_PER_UNIT = 1_000_000;

/** Credits per 1,000,000 tokens, split by the sides GitHub prices. */
export interface CreditRate {
  inputPerMillion: number;
  outputPerMillion: number;
  /**
   * Cache-read price, when the catalog states one. Saved prompt tokens that
   * would have been a cache hit are worth this instead of the full input rate,
   * which is what turns the valuation into a range rather than a single number
   * with a disclaimer attached.
   */
  cachedInputPerMillion?: number;
}

/** Normalized model id → rate. */
export type RateTable = ReadonlyMap<string, CreditRate>;

/** A parsed catalog: the rates plus the model the catalog marks as default. */
export interface CatalogRates {
  rates: RateTable;
  /** normalized id of the entry flagged is_chat_default, when present */
  defaultModelId?: string;
}

/**
 * Lenient key for matching model ids that reach us from different places. The
 * catalog, the model picker and the session logs spell the same model three
 * ways: a vendor prefix may or may not be present ('copilot/GPT-5 mini'), words
 * may be spaced or underscored, and a trailing version pair is written with a
 * dash in one place and a dot in the other ('gpt-5-2' vs 'gpt-5.2').
 */
export function normalizeModelId(raw: string): string {
  const lowered = raw.trim().toLowerCase();
  const bare = lowered.slice(lowered.lastIndexOf('/') + 1);
  return bare.replace(/[\s_]+/g, '-').replace(/-(\d+)-(\d+)$/, '-$1.$2');
}

function isUsableRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Parse a Copilot chat model catalog into a rate table.
 *
 * Shape consumed (everything else in the entry is ignored):
 *   [{ id, is_chat_default, capabilities: { family }, billing: { token_prices:
 *      { default: { input_price, output_price, cache_read_price } } } }]
 *
 * FAIL-OPEN, like every other read on the reporting path: malformed JSON, an
 * unexpected top-level shape, or an entry missing prices yields no rate rather
 * than an error. A report that silently drops one model is recoverable; one
 * that throws while the user is looking at their savings is not.
 */
export function parseCopilotCatalog(raw: string): CatalogRates {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { rates: new Map() };
  }
  if (!Array.isArray(parsed)) {
    return { rates: new Map() };
  }
  const rates = new Map<string, CreditRate>();
  let defaultModelId: string | undefined;
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const billing = record['billing'] as Record<string, unknown> | undefined;
    const prices = (billing?.['token_prices'] as Record<string, unknown> | undefined)?.['default'] as
      | Record<string, unknown>
      | undefined;
    const inputPerMillion = prices?.['input_price'];
    const outputPerMillion = prices?.['output_price'];
    if (!isUsableRate(inputPerMillion) || !isUsableRate(outputPerMillion)) {
      continue;
    }
    const cachedInputPerMillion = prices?.['cache_read_price'];
    const rate: CreditRate = { inputPerMillion, outputPerMillion };
    if (isUsableRate(cachedInputPerMillion)) {
      rate.cachedInputPerMillion = cachedInputPerMillion;
    }
    const capabilities = record['capabilities'] as Record<string, unknown> | undefined;
    // Keyed under both spellings: an id resolved from a session log and one
    // picked in the UI are often the entry's id and its family respectively.
    for (const key of [record['id'], capabilities?.['family']]) {
      if (typeof key === 'string' && key.trim() !== '') {
        const id = normalizeModelId(key);
        rates.set(id, rate);
        if (record['is_chat_default'] === true && defaultModelId === undefined) {
          defaultModelId = id;
        }
      }
    }
  }
  return defaultModelId === undefined ? { rates } : { rates, defaultModelId };
}

/** One model's share of a window's usage; weights need not sum to 1. */
export interface ModelWeight {
  modelId: string;
  weight: number;
}

export interface BlendedRate {
  /** credits per 1,000,000 prompt tokens across the mix */
  creditsPerMillionInput: number;
  /**
   * The same blend at cache-read prices, when every priced model states one.
   * Absent rather than approximated: a partial blend would mix two different
   * meanings into one number.
   */
  cachedCreditsPerMillionInput?: number;
  /** normalized ids that carried a rate, heaviest first */
  models: readonly string[];
}

/**
 * Weighted input rate across a model mix.
 *
 * Models the table cannot price are dropped and the remaining weights are
 * renormalized, so an unpriced model shifts the blend toward the models we DO
 * know rather than silently pulling the average toward zero. Returns undefined
 * when nothing in the mix can be priced — the caller must then report "rates
 * unavailable" instead of a number.
 */
export function blendInputRate(
  mix: readonly ModelWeight[],
  table: RateTable,
): BlendedRate | undefined {
  const priced: { modelId: string; weight: number; rate: CreditRate }[] = [];
  for (const { modelId, weight } of mix) {
    const rate = table.get(normalizeModelId(modelId));
    if (rate === undefined || !Number.isFinite(weight) || weight <= 0) {
      continue;
    }
    priced.push({ modelId: normalizeModelId(modelId), weight, rate });
  }
  const totalWeight = priced.reduce((acc, entry) => acc + entry.weight, 0);
  if (totalWeight <= 0) {
    return undefined;
  }
  priced.sort((a, b) => b.weight - a.weight);
  const blended: BlendedRate = {
    creditsPerMillionInput: priced.reduce(
      (acc, entry) => acc + (entry.weight / totalWeight) * entry.rate.inputPerMillion,
      0,
    ),
    models: priced.map((entry) => entry.modelId),
  };
  if (priced.every((entry) => entry.rate.cachedInputPerMillion !== undefined)) {
    blended.cachedCreditsPerMillionInput = priced.reduce(
      (acc, entry) => acc + (entry.weight / totalWeight) * entry.rate.cachedInputPerMillion!,
      0,
    );
  }
  return blended;
}

/** Credits for a token count at a given per-million rate. */
export function creditsForTokens(tokens: number, creditsPerMillion: number): number {
  return (tokens / TOKENS_PER_UNIT) * creditsPerMillion;
}

export function creditsToUsd(credits: number): number {
  return credits * AI_CREDIT_USD;
}
