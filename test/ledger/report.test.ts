import test from 'node:test';
import assert from 'node:assert/strict';
import type { LedgerEvent } from '../../src/ledger/write.ts';
import {
  aggregateSavings,
  renderSavingsHtml,
  savingsTotals,
  windowLabel,
} from '../../src/ledger/report.ts';

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
  const html = renderSavingsHtml(handBuilt, '/tmp/ledger-dir', 'last 30 days');
  const widthFor = (dim: string): number => {
    const m = new RegExp(`<h2>by ${dim}</h2>\\s*<svg[^>]*viewBox="0 0 (\\d+)`).exec(html);
    return m === null ? 0 : Number(m[1]);
  };
  // "Copilot (VS Code)" is far longer than a date label, so the agent chart
  // must reserve a wider label column than the day chart (a fixed labelW
  // clipped the right-aligned agent labels off the left edge).
  assert.ok(
    widthFor('agent') > widthFor('day'),
    `agent width ${widthFor('agent')} must exceed day width ${widthFor('day')}`,
  );
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
