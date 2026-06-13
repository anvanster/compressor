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
  /** total original chars (charsIn) — the bar's full length encodes this */
  totalChars: number;
  /** total original tokens (estTokensIn), estimated */
  totalTokens: number;
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
    const row =
      groups.get(label) ??
      { label, savedChars: 0, savedTokens: 0, totalChars: 0, totalTokens: 0, events: 0 };
    row.savedChars += event.charsIn - event.charsOut;
    row.savedTokens += event.estTokensIn - event.estTokensOut;
    row.totalChars += event.charsIn;
    row.totalTokens += event.estTokensIn;
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

/** Compact per-row value: saved of total tokens (the bar shows the proportion). */
function barValue(row: SavingsRow): string {
  return `saved ≈${fmt(row.savedTokens)} / ${fmt(row.totalTokens)} tok`;
}

/**
 * Two-tone stacked bars: the full bar length encodes the TOTAL original tokens
 * (estTokensIn) so rows are comparable by magnitude, and the accent segment is
 * the saved portion within it — a visual "how much of this did compressor
 * remove". The value column sits at a FIXED x (after the bar track) and the
 * SVG is sized to fit the longest value string, so labels never truncate
 * (the old layout floated the value after a variable-width bar and clipped it).
 */
function svgBarChart(rows: readonly SavingsRow[]): string {
  if (rows.length === 0) {
    return '<p class="empty">no events in this window</p>';
  }
  const rowH = 30;
  const labelW = 120;
  const barMax = 300;
  const barH = 16;
  const gap = 14;
  const charW = 7.5; // ui-monospace advance at 12px; over-reserve is harmless
  const maxTotal = Math.max(...rows.map((r) => r.totalTokens), 1);
  const valueW = Math.ceil(Math.max(...rows.map((r) => barValue(r).length)) * charW) + 8;
  const width = labelW + barMax + gap + valueW;
  const height = rows.length * rowH + 10;
  const parts = rows.map((r, i) => {
    const y = 5 + i * rowH;
    const cy = y + 17;
    const totalW =
      r.totalTokens <= 0 ? 0 : Math.max(2, Math.round((r.totalTokens / maxTotal) * barMax));
    const savedW =
      r.savedTokens <= 0 ? 0 : Math.min(totalW, Math.round((r.savedTokens / maxTotal) * barMax));
    const title =
      `${r.label}: saved ≈${fmt(r.savedTokens)} tok (${fmt(r.savedChars)} chars) ` +
      `of ≈${fmt(r.totalTokens)} tok (${fmt(r.totalChars)} chars) total · ${fmt(r.events)} events`;
    return (
      `<g><title>${escapeHtml(title)}</title>` +
      [
        `<text x="${labelW - 10}" y="${cy}" text-anchor="end" class="label">${escapeHtml(r.label)}</text>`,
        `<rect x="${labelW}" y="${y + 4}" width="${totalW}" height="${barH}" rx="3" class="bar-total"/>`,
        savedW > 0
          ? `<rect x="${labelW}" y="${y + 4}" width="${savedW}" height="${barH}" rx="3" class="bar-saved"/>`
          : '',
        `<text x="${labelW + barMax + gap}" y="${cy}" class="value">${escapeHtml(barValue(r))}</text>`,
      ].join('') +
      `</g>`
    );
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
  //
  // Colors/font are driven by VS Code theme variables with the standalone
  // (browser) values as fallbacks: in a webview the --vscode-* vars resolve to
  // the active color scheme (readable on light AND dark themes); opened in a
  // browser the vars are undefined and the fallbacks render exactly as before.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>compressor savings</title>
<style>
body { font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace); margin: 2rem auto; max-width: 760px; color: var(--vscode-foreground, #1f2328); background: var(--vscode-editor-background, #ffffff); }
h1 { font-size: 1.3rem; } h2 { font-size: 1rem; margin-top: 1.6rem; }
.totals { font-size: 0.95rem; } .footer, .empty { color: var(--vscode-descriptionForeground, #57606a); font-size: 0.8rem; }
svg .label, svg .value { font-size: 12px; fill: var(--vscode-foreground, #1f2328); }
svg .bar-total { fill: var(--vscode-foreground, #1f2328); opacity: 0.16; }
svg .bar-saved { fill: var(--vscode-charts-blue, #4c9aff); }
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
