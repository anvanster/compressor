import type { LedgerEvent } from './write.ts';
import type { BlendedRate } from '../pricing/rates.ts';
import { creditsForTokens, creditsToUsd } from '../pricing/rates.ts';

// Money value of ledger savings.
//
// src/ledger/report.ts deliberately stops at tokens, because the ledger records
// the AGENT but never the model, which leaves the per-token value unknowable
// from the ledger alone. This module does not repeal that; it requires the
// caller to supply the missing half — a rate, derived from the user's own model
// catalog and their model mix — and prices only the agents that rate covers.
// Everything else is reported as an explicitly unvalued remainder rather than
// folded in at a rate that does not apply to it.
//
// PURE: no fs, no process. Figures are estimated tokens times published rates,
// not an invoice.

/** Ledger agents billed through a GitHub Copilot subscription. */
export const COPILOT_AGENTS: ReadonlySet<LedgerEvent['agent']> = new Set(['copilot', 'vscode']);

export interface ValuationRate extends BlendedRate {
  /**
   * Where the rate came from, rendered verbatim beside every figure it
   * produces. A money number with no stated origin invites more trust than
   * this estimate can carry.
   */
  source: string;
  /** agents this rate is allowed to price (default: the Copilot surfaces) */
  agents?: ReadonlySet<LedgerEvent['agent']>;
}

export interface ValuedTotals {
  tokens: number;
  events: number;
  credits: number;
  usd: number;
  /** the same savings at cache-read prices, when the rate states one */
  creditsLow?: number;
  usdLow?: number;
}

export interface ValuedDay {
  /** YYYY-MM-DD, as grouped by report.ts */
  date: string;
  tokens: number;
  credits: number;
  usd: number;
}

export interface UnvaluedAgent {
  agent: LedgerEvent['agent'];
  tokens: number;
  events: number;
}

export interface Valuation {
  rate: ValuationRate;
  /** savings the rate applies to */
  valued: ValuedTotals;
  /** savings from other agents — shown separately, never priced at this rate */
  unvalued: {
    tokens: number;
    events: number;
    byAgent: readonly UnvaluedAgent[];
  };
  /** valued savings per day, ascending; days with no valued events are absent */
  byDay: readonly ValuedDay[];
}

/** Saved prompt tokens for one event, matching report.ts (unclamped). */
function savedTokens(event: LedgerEvent): number {
  return event.estTokensIn - event.estTokensOut;
}

/**
 * Price a window's savings.
 *
 * Saved tokens are prompt-side, so they are valued at a prompt rate. Which
 * prompt rate is the whole question: measured against a real request, pricing
 * every prompt token at the rate card's `input_price` overstated the bill 8.6x,
 * because 99.3% of that prompt was served from cache at a tenth of the rate.
 * So the rate handed in should come from observed usage where it is available
 * (see effectivePromptCreditsPerMillion), and the cache-read bound below is
 * the floor when it is not — the truth sits between them, nearer the floor the
 * longer a session runs.
 */
export function valueSavings(
  events: readonly LedgerEvent[],
  rate: ValuationRate,
): Valuation {
  const agents = rate.agents ?? COPILOT_AGENTS;
  const valued: ValuedTotals = { tokens: 0, events: 0, credits: 0, usd: 0 };
  const unvaluedByAgent = new Map<LedgerEvent['agent'], UnvaluedAgent>();
  let unvaluedTokens = 0;
  let unvaluedEvents = 0;
  const days = new Map<string, ValuedDay>();

  for (const event of events) {
    const tokens = savedTokens(event);
    if (!agents.has(event.agent)) {
      const entry = unvaluedByAgent.get(event.agent) ?? { agent: event.agent, tokens: 0, events: 0 };
      entry.tokens += tokens;
      entry.events += 1;
      unvaluedByAgent.set(event.agent, entry);
      unvaluedTokens += tokens;
      unvaluedEvents += 1;
      continue;
    }
    const credits = creditsForTokens(tokens, rate.creditsPerMillionInput);
    valued.tokens += tokens;
    valued.events += 1;
    valued.credits += credits;
    valued.usd += creditsToUsd(credits);

    const date = event.ts.slice(0, 10);
    const day = days.get(date) ?? { date, tokens: 0, credits: 0, usd: 0 };
    day.tokens += tokens;
    day.credits += credits;
    day.usd += creditsToUsd(credits);
    days.set(date, day);
  }

  if (rate.cachedCreditsPerMillionInput !== undefined) {
    valued.creditsLow = creditsForTokens(valued.tokens, rate.cachedCreditsPerMillionInput);
    valued.usdLow = creditsToUsd(valued.creditsLow);
  }

  return {
    rate,
    valued,
    unvalued: {
      tokens: unvaluedTokens,
      events: unvaluedEvents,
      byAgent: [...unvaluedByAgent.values()].sort((a, b) => b.tokens - a.tokens),
    },
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** en-US currency, with sub-cent totals shown as such rather than as $0.00. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) {
    return '<$0.01';
  }
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
