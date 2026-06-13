import { writeFile } from 'node:fs/promises';
import type { LedgerEvent } from '../../ledger/write.ts';
import { resolveLedgerDir } from '../../ledger/write.ts';
import { readLedger } from '../../ledger/read.ts';
import type { SavingsDimension, SavingsRow } from '../../ledger/report.ts';
import {
  aggregateSavings,
  fmt,
  renderSavingsHtml,
  savingsTotals,
  windowLabel,
} from '../../ledger/report.ts';

// `compressor savings` — visualize the hook's live ledger. Numbers here are
// chars (exact) and tokens (cheap estimator, NOT billable counts); the
// measured ground truth lives in `compressor benchmark`.
//
// This module owns ALL IO (ledger reading, file writing, console); the pure
// aggregation/rendering logic lives in src/ledger/report.ts so the VS Code
// extension can reuse it. Moved names are re-exported for compatibility.

export type { SavingsDimension, SavingsRow };
export { aggregateSavings, renderSavingsHtml, savingsTotals, windowLabel };

export interface SavingsOptions {
  /** lookback window: '7d', '30d', ... or 'all' */
  since?: string;
  /** aggregation dimension: day|tool|mode */
  by?: string;
  /** write a self-contained HTML report to this path */
  html?: string;
  /** ledger directory override */
  ledgerDir?: string;
}

export function parseSince(value: string): Date | undefined {
  if (value === 'all') {
    return undefined;
  }
  const days = /^(\d+)d$/.exec(value)?.[1];
  if (days === undefined) {
    throw new Error(`invalid --since '${value}' (expected e.g. 7d, 30d, or 'all')`);
  }
  return new Date(Date.now() - Number(days) * 86_400_000);
}

const BAR_WIDTH = 40;

/**
 * Two-tone bar: the full width encodes the row's TOTAL original tokens
 * (relative to the largest row); filled cells (█) are the saved portion,
 * shaded cells (░) the remainder. Reads as "this much of the total was saved".
 */
function bar(saved: number, total: number, max: number): string {
  if (total <= 0 || max <= 0) {
    return '';
  }
  const totalCells = Math.max(1, Math.round((total / max) * BAR_WIDTH));
  const savedCells = saved <= 0 ? 0 : Math.min(totalCells, Math.round((saved / max) * BAR_WIDTH));
  return '█'.repeat(savedCells) + '░'.repeat(totalCells - savedCells);
}

function chartLines(rows: readonly SavingsRow[]): string[] {
  const max = Math.max(...rows.map((r) => r.totalTokens), 1);
  const labelWidth = Math.max(...rows.map((r) => r.label.length), 0);
  return rows.map(
    (r) =>
      `  ${r.label.padEnd(labelWidth)}  ${bar(r.savedTokens, r.totalTokens, max).padEnd(BAR_WIDTH)}  ≈ ${fmt(r.savedTokens)} / ${fmt(r.totalTokens)} tok`,
  );
}

/**
 * Empty states must distinguish "no ledger at all" (hook not installed /
 * never fired — point at `compressor init`) from "no events INSIDE the
 * window" (the hook works fine; suggesting a reinstall would misdirect).
 * `eventsOutsideWindow` is the all-time count when the window filtered
 * everything out.
 */
export function renderEmpty(dir: string, window: string, eventsOutsideWindow = 0): string {
  if (eventsOutsideWindow > 0) {
    return [
      `no ledger events in the ${window} window (looked in ${dir})`,
      '',
      `the ledger holds ${fmt(eventsOutsideWindow)} events outside this window — the hook is`,
      'working; widen the window (e.g. --since all) to see them.',
    ].join('\n');
  }
  return [
    `no ledger events yet (looked in ${dir})`,
    '',
    'the compression hook records an event every time it shrinks tool output',
    'during a real agent session — run `compressor init`, use claude-code or',
    'copilot normally, then check back here.',
    '',
    'recording can be disabled with COMPRESSOR_NO_LEDGER=1 (kill switch).',
  ].join('\n');
}

export function renderSavings(
  events: readonly LedgerEvent[],
  by: SavingsDimension,
  dir: string,
  window: string,
): string {
  const { savedChars, savedTokens } = savingsTotals(events);
  const lines = [
    `saved ${fmt(savedChars)} chars (exact) ≈ ${fmt(savedTokens)} tokens (estimated — cheap estimator, not billable counts) · ${window}`,
    `events: ${fmt(events.length)} (${window})`,
    '',
    `by ${by}:`,
    ...chartLines(aggregateSavings(events, by)),
    '',
    'measured savings come from `compressor benchmark` — this view is the live estimated ledger',
    `ledger: ${dir} (disable recording with COMPRESSOR_NO_LEDGER=1)`,
  ];
  return lines.join('\n');
}

function parseBy(value: string): SavingsDimension {
  if (value === 'day' || value === 'tool' || value === 'mode') {
    return value;
  }
  throw new Error(`invalid --by '${value}' (expected day|tool|mode)`);
}

export async function runSavings(opts: SavingsOptions): Promise<void> {
  const sinceRaw = opts.since ?? '30d';
  const since = parseSince(sinceRaw);
  const window = windowLabel(sinceRaw);
  const by = parseBy(opts.by ?? 'day');
  const dir = opts.ledgerDir ?? resolveLedgerDir();
  const events = await readLedger(since === undefined ? { dir } : { dir, since });

  if (events.length === 0) {
    // distinguish a truly empty ledger from one whose events all fall
    // outside the window — the latter must not suggest reinstalling a hook
    // that works fine
    const allTime = since === undefined ? [] : await readLedger({ dir });
    console.log(renderEmpty(dir, window, allTime.length));
    return;
  }

  console.log(renderSavings(events, by, dir, window));

  if (opts.html !== undefined) {
    await writeFile(opts.html, renderSavingsHtml(events, dir, window), 'utf8');
    console.log(`\nhtml report written to ${opts.html}`);
  }
}
