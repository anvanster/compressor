import type { LedgerEvent } from './write.ts';

// Pure aggregation + rendering over ledger events, shared by the CLI
// (`compressor savings`, src/cli/commands/savings.ts) and library consumers
// (the VS Code extension renders the same report in a webview). PURE on
// purpose: no fs, no process, no console — callers own all IO. Numbers are
// chars (exact) and tokens (cheap estimator, NOT billable counts); the
// measured ground truth lives in `compressor benchmark`.

export type SavingsDimension = 'day' | 'tool' | 'mode';

export interface SavingsRow {
  label: string;
  savedChars: number;
  savedTokens: number;
  events: number;
}

export interface SavingsTotals {
  savedChars: number;
  savedTokens: number;
  events: number;
}

/** en-US thousands grouping, shared by the terminal and HTML renderers. */
export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

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

/** Whole-window totals: exact chars, estimated tokens, event count. */
export function savingsTotals(events: readonly LedgerEvent[]): SavingsTotals {
  return {
    savedChars: events.reduce((acc, e) => acc + (e.charsIn - e.charsOut), 0),
    savedTokens: events.reduce((acc, e) => acc + (e.estTokensIn - e.estTokensOut), 0),
    events: events.length,
  };
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
  const { savedChars, savedTokens } = savingsTotals(events);
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
