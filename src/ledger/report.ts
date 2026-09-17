import type { LedgerEvent } from './write.ts';
import type { Valuation } from './valuation.ts';
import { formatUsd } from './valuation.ts';

// Pure aggregation + rendering over ledger events, shared by the CLI
// (`compressor savings`, src/cli/commands/savings.ts) and library consumers
// (the VS Code extension renders the same report in a webview). PURE on
// purpose: no fs, no process, no console — callers own all IO. Numbers are
// chars (exact) and tokens (cheap estimator, NOT billable counts); the
// measured ground truth lives in `compressor benchmark`.

export type SavingsDimension = 'day' | 'tool' | 'mode' | 'agent' | 'project';

/**
 * Label for events with no project: other writers, and everything recorded
 * before the field existed. Exported so every consumer groups them the same
 * way — a second spelling would silently split the same bucket in two.
 */
export const UNATTRIBUTED = 'unattributed';

/**
 * Most projects to chart before the rest are folded into one row. The bar
 * chart is a fixed-height-per-row SVG, so an unbounded project count would
 * produce an unbounded image.
 */
export const PROJECT_ROW_LIMIT = 12;

// Friendly agent labels for the 'by agent' view: the raw ledger values are
// terse and 'vscode' vs 'copilot' is non-obvious (both are Copilot surfaces —
// the VS Code extension's tools vs the Copilot CLI hook). Unknown agents fall
// back to their raw value.
const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  copilot: 'Copilot CLI',
  vscode: 'Copilot (VS Code)',
  opencode: 'OpenCode',
};

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
    case 'agent':
      return AGENT_LABELS[event.agent] ?? event.agent;
    case 'project':
      return event.project ?? UNATTRIBUTED;
  }
}

/**
 * Keep the largest rows and fold the tail into one, preserving the totals so
 * the chart still adds up to the headline figure.
 */
export function foldTail(rows: readonly SavingsRow[], limit: number, noun: string): SavingsRow[] {
  if (rows.length <= limit) {
    return [...rows];
  }
  const kept = rows.slice(0, limit - 1);
  const tail = rows.slice(limit - 1);
  const folded = tail.reduce(
    (acc, row) => ({
      label: acc.label,
      savedChars: acc.savedChars + row.savedChars,
      savedTokens: acc.savedTokens + row.savedTokens,
      totalChars: acc.totalChars + row.totalChars,
      totalTokens: acc.totalTokens + row.totalTokens,
      events: acc.events + row.events,
    }),
    { label: `other (${tail.length} ${noun})`, savedChars: 0, savedTokens: 0, totalChars: 0, totalTokens: 0, events: 0 },
  );
  return [...kept, folded];
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

/**
 * The rows a chart shows for a dimension: aggregation plus the one folding
 * policy. Both surfaces (the terminal chart and the HTML report) call this
 * instead of folding themselves, so the cap cannot drift between them — the
 * agreement is structural rather than a convention two files keep in step.
 */
export function chartRows(
  events: readonly LedgerEvent[],
  by: SavingsDimension,
): SavingsRow[] {
  const rows = aggregateSavings(events, by);
  return by === 'project' ? foldTail(rows, PROJECT_ROW_LIMIT, 'projects') : rows;
}

// NO cache-tier weighting here: this is the CROSS-AGENT surface (claude-code,
// copilot, opencode, vscode) and the ledger records only the agent, not the
// model — so the per-token $ value is unknowable (Anthropic caching is
// 1.25x write / 0.1x read, OpenAI ~0.5x read, a no-cache model 1x). Reporting
// raw estimated tokens with the "not billable" caveat is the honest floor;
// cache-tier weighting lives only on the Claude-only stats/report surfaces.
// A money figure appears only when a caller supplies the missing half from
// outside the ledger — see src/ledger/valuation.ts.
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
  const barMax = 300;
  const barH = 16;
  const gap = 14;
  const charW = 7.5; // ui-monospace advance at 12px; over-reserve is harmless
  // labelW fits the longest label: agent labels like "Copilot (VS Code)" are
  // wider than day/tool/mode, and the labels are right-aligned at labelW-10, so
  // a fixed width would clip them off the left edge of the SVG.
  const labelW = Math.max(
    120,
    Math.ceil(Math.max(...rows.map((r) => r.label.length)) * charW) + 16,
  );
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

// ── dashboard primitives ───────────────────────────────────────────────────
// Static SVG and CSS only: the webview runs with scripts disabled and the
// standalone artifact is meant to survive being emailed, so no library, no
// runtime, no requests. Colors come from VS Code chart variables with browser
// fallbacks, so one document reads correctly in both places.

const PALETTE = [
  'var(--vscode-charts-blue, #4c9aff)',
  'var(--vscode-charts-green, #3fb950)',
  'var(--vscode-charts-purple, #a371f7)',
  'var(--vscode-charts-orange, #db6d28)',
  'var(--vscode-charts-yellow, #d29922)',
  'var(--vscode-charts-red, #f85149)',
];

export interface Kpi {
  value: string;
  label: string;
  /** small print under the label, e.g. a caveat the number needs */
  hint?: string;
}

/** The headline row: a few big numbers, each with its unit and any caveat. */
export function kpiHtml(items: readonly Kpi[]): string {
  if (items.length === 0) {
    return '';
  }
  const cards = items
    .map(
      (kpi) =>
        '<div class="kpi">' +
        `<div class="kpi-value">${escapeHtml(kpi.value)}</div>` +
        `<div class="kpi-label">${escapeHtml(kpi.label)}</div>` +
        (kpi.hint === undefined ? '' : `<div class="kpi-hint">${escapeHtml(kpi.hint)}</div>`) +
        '</div>',
    )
    .join('');
  return `<div class="kpis">${cards}</div>`;
}

/** One titled card in the grid. */
export function cardHtml(title: string, body: string, wide = false): string {
  return `<section class="card${wide ? ' wide' : ''}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

/**
 * Time series as vertical columns, the shape a reader expects for "per day".
 *
 * Two-tone like the horizontal bars: the full column is the original token
 * total and the accent portion is what compressor removed, so a tall pale
 * column is a day it barely helped and a tall solid one is a day it did.
 */
export function svgColumnChart(rows: readonly SavingsRow[]): string {
  if (rows.length === 0) {
    return '<p class="empty">no events in this window</p>';
  }
  const colW = Math.max(6, Math.min(26, Math.floor(620 / rows.length)));
  const gap = Math.max(2, Math.round(colW / 4));
  const plotH = 170;
  const axisW = 58;
  const top = 8;
  const width = axisW + rows.length * (colW + gap) + 12;
  const height = plotH + 46;
  const max = Math.max(...rows.map((r) => r.totalTokens), 1);
  // At most ~8 x labels: a 30-day window would otherwise overlap into mush.
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8));
  const gridlines = [0, 0.5, 1]
    .map((f) => {
      const y = top + plotH - f * plotH;
      return (
        `<line x1="${axisW}" y1="${y}" x2="${width - 12}" y2="${y}" class="grid"/>` +
        `<text x="${axisW - 8}" y="${y + 4}" text-anchor="end" class="axis">${escapeHtml(fmt(max * f))}</text>`
      );
    })
    .join('');
  const columns = rows
    .map((row, i) => {
      const x = axisW + i * (colW + gap);
      const totalH =
        row.totalTokens <= 0 ? 0 : Math.max(1, Math.round((row.totalTokens / max) * plotH));
      const savedH =
        row.savedTokens <= 0 ? 0 : Math.min(totalH, Math.round((row.savedTokens / max) * plotH));
      const title =
        `${row.label}: saved ≈${fmt(row.savedTokens)} of ≈${fmt(row.totalTokens)} tok · ` +
        `${fmt(row.events)} events`;
      // labels are YYYY-MM-DD and the year is constant across a window
      const label =
        i % labelEvery === 0
          ? `<text x="${x + colW / 2}" y="${top + plotH + 18}" text-anchor="middle" class="axis">${escapeHtml(row.label.slice(5))}</text>`
          : '';
      return (
        `<g><title>${escapeHtml(title)}</title>` +
        `<rect x="${x}" y="${top + plotH - totalH}" width="${colW}" height="${totalH}" rx="2" class="bar-total"/>` +
        (savedH > 0
          ? `<rect x="${x}" y="${top + plotH - savedH}" width="${colW}" height="${savedH}" rx="2" class="bar-saved"/>`
          : '') +
        `</g>${label}`
      );
    })
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">` +
    `${gridlines}${columns}</svg>`
  );
}

/**
 * Composition as a donut, drawn with dash offsets on one circle per slice
 * rather than arc paths — fewer places for floating-point drift to open a
 * visible seam between segments.
 */
export function svgDonut(rows: readonly SavingsRow[], centerLabel: string): string {
  const total = rows.reduce((acc, row) => acc + row.savedTokens, 0);
  if (rows.length === 0 || total <= 0) {
    return '<p class="empty">no events in this window</p>';
  }
  const size = 168;
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = rows
    .map((row, i) => {
      const fraction = row.savedTokens / total;
      const length = fraction * circumference;
      const segment =
        `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" ` +
        `stroke="${PALETTE[i % PALETTE.length]}" stroke-width="26" ` +
        `stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}">` +
        `<title>${escapeHtml(`${row.label}: ${fmt(row.savedTokens)} tok (${(fraction * 100).toFixed(1)}%)`)}</title>` +
        '</circle>';
      offset += length;
      return segment;
    })
    .join('');
  const legend = rows
    .map(
      (row, i) =>
        `<li><span class="swatch" style="background:${PALETTE[i % PALETTE.length]}"></span>` +
        `${escapeHtml(row.label)} <span class="footer">${((row.savedTokens / total) * 100).toFixed(1)}%</span></li>`,
    )
    .join('');
  return (
    '<div class="donut-row">' +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">` +
    `<g transform="rotate(-90 ${size / 2} ${size / 2})">${segments}</g>` +
    `<text x="${size / 2}" y="${size / 2 + 5}" text-anchor="middle" class="donut-center">${escapeHtml(centerLabel)}</text>` +
    '</svg>' +
    `<ul class="legend">${legend}</ul></div>`
  );
}

/**
 * Single-tone daily bars for the valued series. Separate from svgBarChart on
 * purpose: that chart's two tones mean "saved within total", which has no
 * counterpart here — a day has one value, and the only comparison worth making
 * is between days.
 */
function svgValueChart(days: Valuation['byDay']): string {
  if (days.length === 0) {
    return '<p class="empty">no priced events in this window</p>';
  }
  const rowH = 22;
  const barMax = 300;
  const barH = 12;
  const gap = 14;
  const charW = 7.5;
  const labelW = 100;
  const maxUsd = Math.max(...days.map((d) => d.usd), Number.EPSILON);
  const valueW = Math.ceil(Math.max(...days.map((d) => formatUsd(d.usd).length)) * charW) + 8;
  const width = labelW + barMax + gap + valueW;
  const height = days.length * rowH + 10;
  const parts = days.map((day, i) => {
    const y = 5 + i * rowH;
    const cy = y + 13;
    const barW = day.usd <= 0 ? 0 : Math.max(2, Math.round((day.usd / maxUsd) * barMax));
    const title = `${day.date}: ≈${formatUsd(day.usd)} (${fmt(day.credits)} credits) from ≈${fmt(day.tokens)} saved tokens`;
    return (
      `<g><title>${escapeHtml(title)}</title>` +
      [
        `<text x="${labelW - 10}" y="${cy}" text-anchor="end" class="label">${escapeHtml(day.date)}</text>`,
        `<rect x="${labelW}" y="${y + 2}" width="${barW}" height="${barH}" rx="3" class="bar-saved"/>`,
        `<text x="${labelW + barMax + gap}" y="${cy}" class="value">${escapeHtml(formatUsd(day.usd))}</text>`,
      ].join('') +
      `</g>`
    );
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${parts.join('')}</svg>`;
}

/**
 * The valued view: headline, the daily series, and the unvalued remainder.
 *
 * Every figure states its rate and where the rate came from. The remainder is
 * not decoration — without it a reader would take the priced total for the
 * whole window, when it covers only the agents the rate applies to.
 */
export function valuationHtml(valuation: Valuation | undefined): string {
  if (valuation === undefined || valuation.valued.events === 0) {
    return '';
  }
  const { rate, valued, unvalued } = valuation;
  const models = rate.models.length === 0 ? 'unknown model' : rate.models.join(', ');
  // A range when the catalog prices cache reads: saved prompt tokens that would
  // have been a cache hit are worth the lower figure, and which of the two a
  // given prompt would have hit is not knowable from the ledger.
  const headline =
    valued.usdLow === undefined
      ? `≈ ${formatUsd(valued.usd)} (${fmt(valued.credits)} AI credits)`
      : `${formatUsd(valued.usdLow)} – ${formatUsd(valued.usd)} ` +
        `(${fmt(valued.creditsLow ?? 0)} – ${fmt(valued.credits)} AI credits)`;
  const rateNote =
    valued.usdLow === undefined
      ? `priced at ≈${fmt(rate.creditsPerMillionInput)} credits per 1M prompt tokens`
      : `priced between the cache-read rate (≈${fmt(rate.cachedCreditsPerMillionInput ?? 0)}) and ` +
        `the standard input rate (≈${fmt(rate.creditsPerMillionInput)} credits per 1M prompt tokens)`;  const remainder =
    unvalued.events === 0
      ? ''
      : `<p class="footer">not priced: ≈${fmt(unvalued.tokens)} saved tokens from ` +
        `${unvalued.byAgent.map((a) => escapeHtml(AGENT_LABELS[a.agent] ?? a.agent)).join(', ')} — ` +
        'those agents are not billed at this rate, so their savings are excluded rather than ' +
        'converted.</p>';
  return (
    '<div class="grid">' +
    cardHtml(
      'estimated value',
      `<p class="totals">${escapeHtml(headline)}</p>\n` +
        `<p class="footer">from ≈${fmt(valued.tokens)} saved prompt tokens across ` +
        `${fmt(valued.events)} events. ${escapeHtml(rateNote)} for ${escapeHtml(models)}, from ` +
        `${escapeHtml(rate.source)}. Saved tokens are estimated, not billable counts. ` +
        'In a warm agent session almost the whole prompt is a cache read, so the low end of this ' +
        'range is much closer to the truth than the high end. ' +
        'Premium-request quotas are unaffected by compression — on a request-metered plan the ' +
        'cash effect is smaller than this figure.</p>\n' +
        remainder,
    ) +
    cardHtml('value by day', svgValueChart(valuation.byDay)) +
    '</div>'
  );
}

export function renderSavingsHtml(
  events: readonly LedgerEvent[],
  dir: string,
  window: string,
  /** optional money view; omitted when no rate could be resolved */
  valuation?: Valuation,
): string {
  const { savedChars, savedTokens } = savingsTotals(events);
  const totalTokens = events.reduce((acc, e) => acc + e.estTokensIn, 0);
  const kpis: Kpi[] = [
    { value: fmt(savedChars), label: 'chars removed', hint: 'exact' },
    { value: fmt(savedTokens), label: 'tokens removed', hint: 'estimated' },
    {
      value: totalTokens <= 0 ? '—' : `${((savedTokens / totalTokens) * 100).toFixed(0)}%`,
      label: 'of tool output',
      hint: 'gross reduction',
    },
    { value: fmt(events.length), label: 'events', hint: escapeHtml(window) },
  ];
  if (valuation !== undefined && valuation.valued.events > 0) {
    kpis.push({
      value:
        valuation.valued.usdLow === undefined
          ? formatUsd(valuation.valued.usd)
          : `${formatUsd(valuation.valued.usdLow)}–${formatUsd(valuation.valued.usd)}`,
      label: 'estimated value',
      hint: 'Copilot agents',
    });
  }
  // 'by project' only once something carries a label: otherwise every existing
  // ledger gains a chart with a single "unattributed" bar, which says nothing.
  const cards = [
    cardHtml('savings over time', svgColumnChart(chartRows(events, 'day')), true),
    cardHtml('by tool', svgDonut(chartRows(events, 'tool'), 'tools')),
    cardHtml('by agent', svgDonut(chartRows(events, 'agent'), 'agents')),
    cardHtml('by mode', svgBarChart(chartRows(events, 'mode')), true),
  ];
  if (events.some((event) => event.project !== undefined)) {
    cards.push(cardHtml('by project', svgBarChart(chartRows(events, 'project')), true));
  }
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
:root { --card-bg: var(--vscode-editorWidget-background, #f6f8fa); --card-br: var(--vscode-widget-border, #d0d7de); --accent: var(--vscode-charts-blue, #4c9aff); }
body { font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); margin: 0 auto; padding: 1.6rem; max-width: 1080px; color: var(--vscode-foreground, #1f2328); background: var(--vscode-editor-background, #ffffff); line-height: 1.5; }
h1 { font-size: 1.35rem; font-weight: 600; margin: 0 0 0.2rem; }
h2 { font-size: 0.8rem; font-weight: 600; margin: 0 0 0.9rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vscode-descriptionForeground, #57606a); }
.sub { color: var(--vscode-descriptionForeground, #57606a); font-size: 0.85rem; margin: 0 0 1.2rem; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.7rem; margin-bottom: 1rem; }
.kpi { background: var(--card-bg); border: 1px solid var(--card-br); border-radius: 8px; padding: 0.9rem 1rem; }
.kpi-value { font-size: 1.6rem; font-weight: 650; line-height: 1.15; }
.kpi-label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground, #57606a); margin-top: 0.15rem; }
.kpi-hint { font-size: 0.72rem; color: var(--vscode-descriptionForeground, #57606a); opacity: 0.85; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.8rem; }
.card { background: var(--card-bg); border: 1px solid var(--card-br); border-radius: 8px; padding: 1rem 1.1rem; overflow-x: auto; }
.card.wide { grid-column: 1 / -1; }
.totals { font-size: 0.95rem; margin: 0.2rem 0; }
.footer, .empty { color: var(--vscode-descriptionForeground, #57606a); font-size: 0.8rem; }
table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
th { text-align: left; font-weight: 600; color: var(--vscode-descriptionForeground, #57606a); }
th, td { padding: 0.32rem 0.6rem 0.32rem 0; border-bottom: 1px solid var(--card-br); }
.donut-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.legend { list-style: none; margin: 0; padding: 0; font-size: 0.82rem; }
.legend li { margin-bottom: 0.25rem; white-space: nowrap; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 0.45rem; }
.donut-center { font-size: 12px; fill: var(--vscode-descriptionForeground, #57606a); }
svg .label, svg .value { font-size: 12px; fill: var(--vscode-foreground, #1f2328); }
svg .axis { font-size: 11px; fill: var(--vscode-descriptionForeground, #57606a); }
svg .grid { stroke: var(--vscode-foreground, #1f2328); opacity: 0.12; }
svg .bar-total { fill: var(--vscode-foreground, #1f2328); opacity: 0.16; }
svg .bar-saved { fill: var(--vscode-charts-blue, #4c9aff); }
@media (max-width: 720px) { .grid { grid-template-columns: minmax(0, 1fr); } }
</style>
</head>
<body>
<h1>compressor savings <span class="footer">(${escapeHtml(window)})</span></h1>
<p class="sub">saved ${fmt(savedChars)} chars (exact) ≈ ${fmt(savedTokens)} tokens (estimated — cheap estimator, not billable counts) · ${fmt(events.length)} events · ${escapeHtml(window)}</p>
${kpiHtml(kpis)}
${valuationHtml(valuation)}
<div class="grid">
${cards.join('\n')}
</div>
<p class="footer">measured savings come from <code>compressor benchmark</code> — this view is the live estimated ledger.<br>
ledger: ${escapeHtml(dir)} · disable recording with COMPRESSOR_NO_LEDGER=1</p>
</body>
</html>
`;
}
