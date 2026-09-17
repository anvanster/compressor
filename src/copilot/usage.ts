import type { LlmRequest } from './debug-log.ts';
import type { LedgerEvent } from '../ledger/write.ts';
import { COPILOT_AGENTS } from '../ledger/valuation.ts';

// Aggregation over the model calls read from chat debug logs, and the one
// comparison that needs both halves: how much of what Copilot would have sent
// compressor removed before it was sent.
//
// PURE: no fs, no process.

/**
 * Token totals with their own confidence. `inputUnknown` counts requests whose
 * counter the provider never reported: totals are a FLOOR whenever it is
 * non-zero, and every renderer must say so rather than presenting a sum that
 * silently omits an unknown number of requests.
 */
export interface UsageCounters {
  requests: number;
  inputTokens: number;
  /** subset of inputTokens served from the provider's cache */
  cachedTokens: number;
  outputTokens: number;
  /** AI Units billed by the provider, in nano units */
  nanoAiu: number;
  inputUnknown: number;
  cachedUnknown: number;
  outputUnknown: number;
  aiuUnknown: number;
}

export interface ModelUsage extends UsageCounters {
  model: string;
}

export interface DailyUsage extends UsageCounters {
  /** YYYY-MM-DD (UTC), matching the ledger report's day grouping */
  date: string;
}

export interface UsageSummary {
  totals: UsageCounters;
  sessions: number;
  /** heaviest input first */
  byModel: ModelUsage[];
  /** ascending */
  byDay: DailyUsage[];
  /** requests the log marked as failed */
  errors: number;
  firstTs?: number;
  lastTs?: number;
}

function emptyCounters(): UsageCounters {
  return {
    requests: 0,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    nanoAiu: 0,
    inputUnknown: 0,
    cachedUnknown: 0,
    outputUnknown: 0,
    aiuUnknown: 0,
  };
}

function add(counters: UsageCounters, request: LlmRequest): void {
  counters.requests += 1;
  if (request.inputTokens === undefined) {
    counters.inputUnknown += 1;
  } else {
    counters.inputTokens += request.inputTokens;
  }
  if (request.cachedTokens === undefined) {
    counters.cachedUnknown += 1;
  } else {
    counters.cachedTokens += request.cachedTokens;
  }
  if (request.outputTokens === undefined) {
    counters.outputUnknown += 1;
  } else {
    counters.outputTokens += request.outputTokens;
  }
  if (request.nanoAiu === undefined) {
    counters.aiuUnknown += 1;
  } else {
    counters.nanoAiu += request.nanoAiu;
  }
}

/** UTC day, so a day bucket means the same thing here and in the ledger report. */
function dayOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function aggregateCopilotUsage(requests: readonly LlmRequest[]): UsageSummary {
  const totals = emptyCounters();
  const models = new Map<string, ModelUsage>();
  const days = new Map<string, DailyUsage>();
  const sessions = new Set<string>();
  let errors = 0;
  let firstTs: number | undefined;
  let lastTs: number | undefined;

  for (const request of requests) {
    add(totals, request);
    sessions.add(request.sessionId);
    if (request.status === 'error') {
      errors += 1;
    }
    if (firstTs === undefined || request.ts < firstTs) {
      firstTs = request.ts;
    }
    if (lastTs === undefined || request.ts > lastTs) {
      lastTs = request.ts;
    }

    const model = models.get(request.model) ?? { model: request.model, ...emptyCounters() };
    add(model, request);
    models.set(request.model, model);

    const date = dayOf(request.ts);
    const day = days.get(date) ?? { date, ...emptyCounters() };
    add(day, request);
    days.set(date, day);
  }

  const summary: UsageSummary = {
    totals,
    sessions: sessions.size,
    byModel: [...models.values()].sort((a, b) => b.inputTokens - a.inputTokens),
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    errors,
  };
  if (firstTs !== undefined) {
    summary.firstTs = firstTs;
  }
  if (lastTs !== undefined) {
    summary.lastTs = lastTs;
  }
  return summary;
}

/** Model mix by input tokens, for pricing a blended rate against real usage. */
export function usageModelWeights(summary: UsageSummary): { modelId: string; weight: number }[] {
  return summary.byModel
    .filter((model) => model.inputTokens > 0 && model.model !== 'unknown')
    .map((model) => ({ modelId: model.model, weight: model.inputTokens }));
}

/** AI Units billed, from the nano units the provider reports. */
export function usageAiu(counters: UsageCounters): number {
  return counters.nanoAiu / 1_000_000_000;
}

/**
 * Share of prompt tokens the provider served from cache, or undefined when no
 * request reported the split. In a long agent session this approaches 1, and
 * it is the single biggest factor in what a prompt token costs.
 */
export function cacheHitRate(counters: UsageCounters): number | undefined {
  if (counters.inputTokens <= 0 || counters.cachedUnknown === counters.requests) {
    return undefined;
  }
  return counters.cachedTokens / counters.inputTokens;
}

/**
 * Credits per 1M prompt tokens as actually billed, derived from measured usage.
 *
 * Pricing removed tokens at the rate card's `input_price` is wrong by an order
 * of magnitude once a session is warm: on a real 292k-token request 99.3% of
 * the prompt was a cache read at 1/10th that rate, and the rate-card figure
 * overstated the bill 8.6x. This instead divides the prompt-side AI Units the
 * provider actually charged by the prompt tokens actually sent, so the user's
 * own cache behaviour is priced in rather than assumed away.
 *
 * Prompt-side AIU is the billed total minus the output side, which needs the
 * output rate; returns undefined when that is unavailable or when the result
 * would not be meaningful.
 */
export function effectivePromptCreditsPerMillion(
  counters: UsageCounters,
  outputCreditsPerMillion: number | undefined,
): number | undefined {
  if (counters.inputTokens <= 0 || counters.nanoAiu <= 0 || outputCreditsPerMillion === undefined) {
    return undefined;
  }
  const outputAiu = (counters.outputTokens / 1_000_000) * outputCreditsPerMillion;
  const promptAiu = usageAiu(counters) - outputAiu;
  if (promptAiu <= 0) {
    return undefined;
  }
  return promptAiu / (counters.inputTokens / 1_000_000);
}

export interface SavingsShare {
  /** estimated tokens compressor removed (ledger) */
  savedTokens: number;
  /** input tokens actually sent (debug logs) */
  sentInputTokens: number;
  /** savedTokens / (savedTokens + sentInputTokens), 0 when there is nothing to compare */
  share: number;
  /** the sent total omits this many requests whose counter was unreported */
  sentUnknownRequests: number;
}

/**
 * What fraction of the counterfactual prompt compressor removed.
 *
 * The denominator is sent + saved, i.e. what would have been sent had nothing
 * been compressed. MIXED UNITS by necessity: the numerator is this project's
 * cheap estimator, the denominator's sent half is the provider's own count, so
 * the result is an indication rather than a measurement.
 *
 * Callers MUST pass ledger events already restricted to the same scope as the
 * requests — same window, and the current project. A whole-machine ledger
 * against one workspace's usage would inflate the share without any visible
 * symptom.
 */
export function savingsShare(
  events: readonly LedgerEvent[],
  summary: UsageSummary,
): SavingsShare {
  const savedTokens = events
    .filter((event) => COPILOT_AGENTS.has(event.agent))
    .reduce((acc, event) => acc + (event.estTokensIn - event.estTokensOut), 0);
  const sentInputTokens = summary.totals.inputTokens;
  const counterfactual = savedTokens + sentInputTokens;
  return {
    savedTokens,
    sentInputTokens,
    share: counterfactual <= 0 ? 0 : savedTokens / counterfactual,
    sentUnknownRequests: summary.totals.inputUnknown,
  };
}
