import { writeFile } from 'node:fs/promises';
import type { LedgerEvent } from '../../ledger/write.ts';
import { resolveLedgerDir } from '../../ledger/write.ts';
import { readLedger } from '../../ledger/read.ts';

// `compressor savings` — visualize the hook's live ledger. Numbers here are
// chars (exact) and tokens (cheap estimator, NOT billable counts); the
// measured ground truth lives in `compressor benchmark`.

export type SavingsDimension = 'day' | 'tool' | 'mode';

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

export interface SavingsRow {
  label: string;
  savedChars: number;
  savedTokens: number;
  events: number;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

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

/**
 * Human label for the lookback window. Totals MUST state their window:
 * the default is 30d, and an unqualified headline (especially in the
 * shareable HTML artifact) reads as all-time.
 */
export function windowLabel(since: string): string {
  if (since === 'all') {
    return 'all time';
  }
  const days = /^(\d+)d$/.exec(since)?.[1];
  if (days === undefined) {
    return since;
  }
  return Number(days) === 1 ? 'last 1 day' : `last ${days} days`;
}

function labelFor(event: LedgerEvent, by: SavingsDimension): string {
  switch (by) {
    case 'day':
      return event.ts.slice(0, 10);
    case 'tool':
      return event.tool;
    case 'mode':
      return event.mode;
  }
}

/** Group savings by dimension. Days sort ascending; tool/mode by size. */
export function aggregateSavings(
  events: readonly LedgerEvent[],
  by: SavingsDimension,
): SavingsRow[] {
  const groups = new Map<string, SavingsRow>();
  for (const event of events) {
    const label = labelFor(event, by);
    const row = groups.get(label) ?? { label, savedChars: 0, savedTokens: 0, events: 0 };
    row.savedChars += event.charsIn - event.charsOut;
    row.savedTokens += event.estTokensIn - event.estTokensOut;
    row.events += 1;
    groups.set(label, row);
  }
  const rows = [...groups.values()];
  return by === 'day'
    ? rows.sort((a, b) => a.label.localeCompare(b.label))
    : rows.sort((a, b) => b.savedTokens - a.savedTokens);
}

const BAR_WIDTH = 40;

function bar(value: number, max: number): string {
  if (value <= 0 || max <= 0) {
    return '';
  }
  return '█'.repeat(Math.max(1, Math.round((value / max) * BAR_WIDTH)));
}

function chartLines(rows: readonly SavingsRow[]): string[] {
  const max = Math.max(...rows.map((r) => r.savedTokens), 1);
  const labelWidth = Math.max(...rows.map((r) => r.label.length), 0);
  return rows.map(
    (r) => `  ${r.label.padEnd(labelWidth)}  ${bar(r.savedTokens, max).padEnd(BAR_WIDTH)}  ≈ ${fmt(r.savedTokens)} tok`,
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
  const savedChars = events.reduce((acc, e) => acc + (e.charsIn - e.charsOut), 0);
  const savedTokens = events.reduce((acc, e) => acc + (e.estTokensIn - e.estTokensOut), 0);
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

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function svgBarChart(rows: readonly SavingsRow[]): string {
  if (rows.length === 0) {
    return '<p class="empty">no events in this window</p>';
  }
  const rowH = 26;
  const labelW = 120;
  const barMax = 420;
  const valueW = 140;
  const width = labelW + barMax + valueW;
  const height = rows.length * rowH + 10;
  const max = Math.max(...rows.map((r) => r.savedTokens), 1);
  const parts = rows.map((r, i) => {
    const y = 5 + i * rowH;
    const w = r.savedTokens <= 0 ? 0 : Math.max(2, Math.round((r.savedTokens / max) * barMax));
    return [
      `<text x="${labelW - 10}" y="${y + 17}" text-anchor="end" class="label">${escapeHtml(r.label)}</text>`,
      `<rect x="${labelW}" y="${y + 4}" width="${w}" height="16" rx="3" class="bar"/>`,
      `<text x="${labelW + w + 8}" y="${y + 17}" class="value">≈ ${fmt(r.savedTokens)} tok (${fmt(r.savedChars)} chars)</text>`,
    ].join('');
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${parts.join('')}</svg>`;
}

export function renderSavingsHtml(
  events: readonly LedgerEvent[],
  dir: string,
  window: string,
): string {
  const savedChars = events.reduce((acc, e) => acc + (e.charsIn - e.charsOut), 0);
  const savedTokens = events.reduce((acc, e) => acc + (e.estTokensIn - e.estTokensOut), 0);
  const sections = (['day', 'tool', 'mode'] as const)
    .map((by) => `<h2>by ${by}</h2>\n${svgBarChart(aggregateSavings(events, by))}`)
    .join('\n');
  // Self-contained on purpose: inline CSS, static SVG, no JS, no requests.
  // The window label is mandatory: this artifact is shared standalone and an
  // unqualified headline would read as all-time.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>compressor savings</title>
<style>
body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem auto; max-width: 760px; color: #1f2328; }
h1 { font-size: 1.3rem; } h2 { font-size: 1rem; margin-top: 1.6rem; }
.totals { font-size: 0.95rem; } .footer, .empty { color: #57606a; font-size: 0.8rem; }
svg .label, svg .value { font-size: 12px; fill: #1f2328; }
svg .bar { fill: #4c9aff; }
</style>
</head>
<body>
<h1>compressor savings <span class="footer">(${escapeHtml(window)})</span></h1>
<p class="totals">saved ${fmt(savedChars)} chars (exact) ≈ ${fmt(savedTokens)} tokens (estimated — cheap estimator, not billable counts) · ${fmt(events.length)} events · ${escapeHtml(window)}</p>
${sections}
<p class="footer">measured savings come from <code>compressor benchmark</code> — this view is the live estimated ledger.<br>
ledger: ${escapeHtml(dir)} · disable recording with COMPRESSOR_NO_LEDGER=1</p>
</body>
</html>
`;
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
