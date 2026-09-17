import test from 'node:test';
import assert from 'node:assert/strict';
import type { LedgerEvent } from '../../src/ledger/write.ts';
import {
  PROJECT_ROW_LIMIT,
  UNATTRIBUTED,
  aggregateSavings,
  chartRows,
  foldTail,
  renderSavingsHtml,
  savingsTotals,
  svgColumnChart,
  svgDonut,
  valuationHtml,
  windowLabel,
} from '../../src/ledger/report.ts';
import type { ValuationRate } from '../../src/ledger/valuation.ts';
import { valueSavings } from '../../src/ledger/valuation.ts';

// Pure-module contract for the extension surface (src/ledger/report.ts):
// aggregation math, totals, window labels, and the self-contained HTML
// renderer — all on hand-built events, no IO anywhere.

function event(overrides: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    ts: '2026-06-10T12:00:00.000Z',
    agent: 'claude-code',
    tool: 'bash',
    mode: 'slim',
    charsIn: 1000,
    charsOut: 300,
    estTokensIn: 286,
    estTokensOut: 86,
    transforms: ['dedupe-lines'],
    ...overrides,
  };
}

const handBuilt: LedgerEvent[] = [
  event({ ts: '2026-06-09T10:00:00.000Z', tool: 'read', mode: 'optimized', charsIn: 4000, charsOut: 1000, estTokensIn: 1143, estTokensOut: 286 }),
  event({ ts: '2026-06-09T11:00:00.000Z', tool: 'bash', mode: 'slim', charsIn: 1000, charsOut: 300, estTokensIn: 286, estTokensOut: 86 }),
  event({ ts: '2026-06-10T09:00:00.000Z', agent: 'vscode', tool: 'bash', mode: 'slim', charsIn: 700, charsOut: 200, estTokensIn: 200, estTokensOut: 58 }),
];

/** 1000 credits per 1M prompt tokens → $10.00 per million saved tokens. */
const rate: ValuationRate = {
  creditsPerMillionInput: 1000,
  models: ['gpt-5.2'],
  source: 'test catalog',
};

test('aggregateSavings by day: per-day sums, ascending date order', () => {
  assert.deepEqual(aggregateSavings(handBuilt, 'day'), [
    { label: '2026-06-09', savedChars: 3700, savedTokens: 1057, totalChars: 5000, totalTokens: 1429, events: 2 },
    { label: '2026-06-10', savedChars: 500, savedTokens: 142, totalChars: 700, totalTokens: 200, events: 1 },
  ]);
});

test('aggregateSavings by tool: sorted by saved tokens descending', () => {
  assert.deepEqual(aggregateSavings(handBuilt, 'tool'), [
    { label: 'read', savedChars: 3000, savedTokens: 857, totalChars: 4000, totalTokens: 1143, events: 1 },
    { label: 'bash', savedChars: 1200, savedTokens: 342, totalChars: 1700, totalTokens: 486, events: 2 },
  ]);
});

test('aggregateSavings by mode: sorted by saved tokens descending', () => {
  assert.deepEqual(aggregateSavings(handBuilt, 'mode'), [
    { label: 'optimized', savedChars: 3000, savedTokens: 857, totalChars: 4000, totalTokens: 1143, events: 1 },
    { label: 'slim', savedChars: 1200, savedTokens: 342, totalChars: 1700, totalTokens: 486, events: 2 },
  ]);
});

test('aggregateSavings of no events is empty', () => {
  assert.deepEqual(aggregateSavings([], 'day'), []);
});

test('savingsTotals sums chars, tokens, and the event count', () => {
  assert.deepEqual(savingsTotals(handBuilt), {
    savedChars: 4200,
    savedTokens: 1199,
    events: 3,
  });
  assert.deepEqual(savingsTotals([]), { savedChars: 0, savedTokens: 0, events: 0 });
});

test('windowLabel humanizes --since values', () => {
  assert.equal(windowLabel('all'), 'all time');
  assert.equal(windowLabel('30d'), 'last 30 days');
  assert.equal(windowLabel('7d'), 'last 7 days');
  assert.equal(windowLabel('1d'), 'last 1 day');
});

test('renderSavingsHtml: SVG charts per dimension, estimated label, window label', () => {
  const html = renderSavingsHtml(handBuilt, '/tmp/ledger-dir', 'last 30 days');
  assert.ok(html.includes('<svg'), 'inline SVG charts');
  assert.equal(html.match(/<svg/g)?.length, 4, 'by day + by agent + by tool + by mode');
  assert.ok(html.includes('<h2>by agent</h2>'), 'agent breakdown section');
  assert.ok(html.includes('Copilot (VS Code)'), 'friendly agent label for vscode events');
  assert.ok(html.includes('estimated — cheap estimator, not billable counts'));
  assert.ok(html.includes('last 30 days'), 'carries the window label');
  assert.ok(html.includes('4,200 chars'), 'totals rendered');
  assert.ok(!html.includes('<script'), 'no JS — self-contained artifact');
});

test('renderSavingsHtml: label column widens for long labels (no left clip)', () => {
  // Horizontal bar charts right-align labels at labelW-10, so a fixed width
  // clipped long ones off the left edge. Only the bar-chart dimensions can
  // regress this way — 'day' is a column chart and 'agent'/'tool' are donuts.
  const longLabel = '#a-very-long-project-label-indeed';
  const html = renderSavingsHtml(
    [event({ project: longLabel }), event({ project: '#b' })],
    '/tmp/ledger-dir',
    'last 30 days',
  );
  const widthFor = (dim: string): number => {
    const m = new RegExp(`<h2>by ${dim}</h2>\\s*<svg[^>]*viewBox="0 0 (\\d+)`).exec(html);
    return m === null ? 0 : Number(m[1]);
  };
  assert.ok(
    widthFor('project') > widthFor('mode'),
    `project width ${widthFor('project')} must exceed mode width ${widthFor('mode')}`,
  );
});

test('renderSavingsHtml: dashboard shell — KPI row and cards, still no JS', () => {
  const html = renderSavingsHtml(handBuilt, '/tmp/ledger-dir', 'last 30 days');
  assert.match(html, /class="kpis"/, 'headline numbers');
  assert.match(html, /class="kpi-value">4,200<\/div>/, 'chars removed KPI');
  assert.match(html, /class="card/, 'charts live in cards');
  assert.match(html, /<h2>savings over time<\/h2>/);
  assert.match(html, /class="donut-row"/, 'composition charts');
  assert.ok(!html.includes('<script'), 'no JS — self-contained artifact');
  // the only http: string may be the SVG namespace, which is an identifier and
  // never fetched — anything else would be a request from a shared artifact
  assert.equal(
    html.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '').match(/https?:\/\//g),
    null,
    'no network requests',
  );
});

test('svgColumnChart: two-tone columns, thinned x labels, tooltips', () => {
  const days = Array.from({ length: 30 }, (_, i) =>
    event({ ts: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }));
  const svg = svgColumnChart(chartRows(days, 'day'));
  assert.match(svg, /class="bar-total"/);
  assert.match(svg, /class="bar-saved"/);
  assert.match(svg, /<title>/);
  // 30 columns must not print 30 x labels on top of each other
  const labels = svg.match(/class="axis"/g)?.length ?? 0;
  assert.ok(labels < 30 && labels > 3, `${labels} axis labels for 30 days`);
  assert.equal(svgColumnChart([]), '<p class="empty">no events in this window</p>');
});

test('svgDonut: slices sum to the circumference and carry a legend', () => {
  const rows = chartRows(handBuilt, 'agent');
  const svg = svgDonut(rows, 'agents');
  assert.match(svg, /class="legend"/);
  assert.match(svg, /Claude Code/);
  assert.match(svg, /stroke-dashoffset="-?\d/);
  // percentages are shown and must add to 100
  const percents = [...svg.matchAll(/>(\d+\.\d)%</g)].map((m) => Number(m[1]));
  assert.ok(Math.abs(percents.reduce((a, b) => a + b, 0) - 100) < 0.2, `${percents}`);
  assert.equal(svgDonut([], 'x'), '<p class="empty">no events in this window</p>');
});

test('svgDonut: a hostile label cannot break out of the legend or a tooltip', () => {
  const svg = svgDonut(chartRows([event({ project: '<img src=x onerror=1>' })], 'project'), 'p');
  assert.ok(!svg.includes('<img'), 'escaped in both legend and title');
  assert.match(svg, /&lt;img/);
});

test('aggregateSavings by agent: friendly labels, sorted by saved tokens', () => {
  assert.deepEqual(aggregateSavings(handBuilt, 'agent'), [
    { label: 'Claude Code', savedChars: 3700, savedTokens: 1057, totalChars: 5000, totalTokens: 1429, events: 2 },
    { label: 'Copilot (VS Code)', savedChars: 500, savedTokens: 142, totalChars: 700, totalTokens: 200, events: 1 },
  ]);
});

test('renderSavingsHtml: two-tone bars (total track + saved overlay), no truncation', () => {
  const html = renderSavingsHtml(handBuilt, '/tmp/ledger-dir', 'last 30 days');
  assert.ok(html.includes('class="bar-total"'), 'total-token track');
  assert.ok(html.includes('class="bar-saved"'), 'saved-portion overlay');
  // value shows saved of total, the visual prop the bar encodes
  assert.ok(html.includes('saved ≈857 / 1,143 tok'), 'read row: saved-of-total value');
  assert.ok(html.includes('<title>'), 'hover detail with chars breakdown');
  // The value column sits at a FIXED x sized into the SVG width — assert each
  // chart's widest value string fits inside its declared viewBox width.
  for (const svg of html.match(/<svg[^>]*viewBox="0 0 (\d+)[^>]*>[\s\S]*?<\/svg>/g) ?? []) {
    const vbWidth = Number(/viewBox="0 0 (\d+)/.exec(svg)?.[1] ?? '0');
    const valueXs = [...svg.matchAll(/<text x="(\d+)" y="\d+" class="value"/g)].map((m) =>
      Number(m[1]),
    );
    for (const x of valueXs) {
      assert.ok(x < vbWidth, `value text x=${x} must start inside viewBox width ${vbWidth}`);
    }
  }
});

test('by project groups unlabelled events under one shared sentinel', () => {
  const rows = aggregateSavings(
    [
      event({ project: '#aaa', estTokensIn: 300, estTokensOut: 100 }),
      event({ project: '#aaa', estTokensIn: 200, estTokensOut: 150 }),
      event({ project: '#bbb', estTokensIn: 500, estTokensOut: 100 }),
      event(), // no label
    ],
    'project',
  );
  assert.deepEqual(rows.map((r) => r.label), ['#bbb', '#aaa', UNATTRIBUTED]);
  assert.equal(rows.find((r) => r.label === '#aaa')?.events, 2);
  assert.equal(rows.find((r) => r.label === '#aaa')?.savedTokens, 250);
});

test('the project section appears only once something carries a label', () => {
  const plain = renderSavingsHtml([event(), event()], '/tmp/l', 'last 30 days');
  assert.ok(!plain.includes('by project'), 'no pointless single-bar chart');

  const labelled = renderSavingsHtml([event({ project: '#aaa' }), event()], '/tmp/l', 'last 30 days');
  assert.ok(labelled.includes('<h2>by project</h2>'));
  assert.ok(labelled.includes('#aaa'));
  assert.ok(labelled.includes(UNATTRIBUTED), 'the unlabelled event is still counted');
});

test('a project label is escaped: clear-text mode puts folder names in the report', () => {
  const html = renderSavingsHtml([event({ project: '<img src=x onerror=1>' })], '/tmp/l', 'all time');
  assert.ok(!html.includes('<img src=x'), 'never rendered as markup');
  assert.ok(html.includes('&lt;img src=x onerror=1&gt;'));
});

test('foldTail caps the chart without losing totals', () => {
  const rows = aggregateSavings(
    Array.from({ length: 20 }, (_, i) =>
      event({ project: `#p${i}`, estTokensIn: 1000, estTokensOut: 1000 - (20 - i) })),
    'project',
  );
  const folded = foldTail(rows, PROJECT_ROW_LIMIT, 'projects');
  assert.equal(folded.length, PROJECT_ROW_LIMIT);
  assert.match(folded.at(-1)!.label, /^other \(9 projects\)$/);

  const sum = (list: readonly { savedTokens: number; events: number }[]) => ({
    savedTokens: list.reduce((a, r) => a + r.savedTokens, 0),
    events: list.reduce((a, r) => a + r.events, 0),
  });
  assert.deepEqual(sum(folded), sum(rows), 'the chart still adds up to the headline');
});

test('chartRows is the single fold policy both surfaces chart', () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    event({ project: `#p${i}`, estTokensIn: 1000, estTokensOut: 1000 - (20 - i) }));
  assert.deepEqual(
    chartRows(many, 'project'),
    foldTail(aggregateSavings(many, 'project'), PROJECT_ROW_LIMIT, 'projects'),
  );
  // only the project dimension folds: days must not collapse into 'other'
  const days = Array.from({ length: 20 }, (_, i) =>
    event({ ts: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }));
  assert.deepEqual(chartRows(days, 'day'), aggregateSavings(days, 'day'));
});

test('foldTail is a no-op at or below the limit', () => {
  const rows = aggregateSavings([event({ project: '#a' }), event({ project: '#b' })], 'project');
  assert.deepEqual(foldTail(rows, PROJECT_ROW_LIMIT, 'projects'), rows);
});

test('valuationHtml: absent or unpriced valuation renders nothing', () => {
  assert.equal(valuationHtml(undefined), '');
  assert.equal(
    valuationHtml(valueSavings([event({ agent: 'claude-code' })], rate)),
    '',
    'a window with nothing the rate covers must not print a $0.00 headline',
  );
});

test('valuationHtml: every figure carries its rate, its source and the caveats', () => {
  const html = valuationHtml(valueSavings([event({ agent: 'vscode', estTokensIn: 1_000_000, estTokensOut: 0 })], rate));
  assert.match(html, /\$10\.00/);
  assert.match(html, /test catalog/, 'provenance is stated');
  assert.match(html, /1M prompt tokens/, 'the rate itself is stated');
  assert.match(html, /estimated, not billable counts/);
  assert.match(html, /Premium-request quotas are unaffected/);
  assert.match(html, /<h2>value by day<\/h2>/);
});

test('valuationHtml: a cache-read rate is shown as a range, not a bare ceiling', () => {
  const html = valuationHtml(
    valueSavings([event({ agent: 'vscode', estTokensIn: 1_000_000, estTokensOut: 0 })], {
      ...rate,
      cachedCreditsPerMillionInput: 100,
    }),
  );
  assert.match(html, /\$1\.00 – \$10\.00/);
  assert.match(html, /cache-read rate/);
});

test('valuationHtml: the unpriced remainder is named, not silently dropped', () => {
  const html = valuationHtml(
    valueSavings([event({ agent: 'vscode' }), event({ agent: 'claude-code', estTokensIn: 900_000 })], rate),
  );
  assert.match(html, /not priced/);
  assert.match(html, /Claude Code/, 'the friendly agent label, as elsewhere in the report');
});

test('renderSavingsHtml: the valued section is opt-in and escaped', () => {
  assert.doesNotMatch(renderSavingsHtml(handBuilt, '/tmp/l', '30d'), /estimated value/);
  const valued = renderSavingsHtml(handBuilt, '/tmp/l', '30d', valueSavings(handBuilt, {
    ...rate,
    source: '<script>alert(1)</script>',
  }));
  assert.match(valued, /<h2>estimated value<\/h2>/);
  assert.doesNotMatch(valued, /<script>/, 'the source string is untrusted display text');
});

test('project symbols are exported from the PACKAGE ROOT barrel (two-barrel rule)', async () => {
  // Same trap as the 0.3.2 weight bug: the VS Code extension imports from
  // '@astudioplus/compressor', so a local-barrel-only export is unreachable.
  const root = (await import('../../src/index.ts')) as Record<string, unknown>;
  assert.equal(root['UNATTRIBUTED'], 'unattributed', 'one spelling for both consumers');
  assert.equal(typeof root['PROJECT_LABEL_MAX'], 'number');
  assert.equal(typeof root['PROJECT_ROW_LIMIT'], 'number');
  assert.equal(typeof root['foldTail'], 'function');
  assert.equal(typeof root['chartRows'], 'function');
});
