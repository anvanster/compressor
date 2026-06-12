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
    { label: '2026-06-09', savedChars: 3700, savedTokens: 1057, events: 2 },
    { label: '2026-06-10', savedChars: 500, savedTokens: 142, events: 1 },
  ]);
});

test('aggregateSavings by tool: sorted by saved tokens descending', () => {
  assert.deepEqual(aggregateSavings(handBuilt, 'tool'), [
    { label: 'read', savedChars: 3000, savedTokens: 857, events: 1 },
    { label: 'bash', savedChars: 1200, savedTokens: 342, events: 2 },
  ]);
});

test('aggregateSavings by mode: sorted by saved tokens descending', () => {
  assert.deepEqual(aggregateSavings(handBuilt, 'mode'), [
    { label: 'optimized', savedChars: 3000, savedTokens: 857, events: 1 },
    { label: 'slim', savedChars: 1200, savedTokens: 342, events: 2 },
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
  assert.equal(html.match(/<svg/g)?.length, 3, 'by day + by tool + by mode');
  assert.ok(html.includes('estimated — cheap estimator, not billable counts'));
  assert.ok(html.includes('last 30 days'), 'carries the window label');
  assert.ok(html.includes('4,200 chars'), 'totals rendered');
  assert.ok(!html.includes('<script'), 'no JS — self-contained artifact');
});
