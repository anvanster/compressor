import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import type { LedgerEvent } from '../../src/ledger/write.ts';
import {
  aggregateSavings,
  parseSince,
  renderEmpty,
  renderSavings,
  renderSavingsHtml,
  runSavings,
  windowLabel,
} from '../../src/cli/commands/savings.ts';

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
  event({ ts: '2026-06-10T09:00:00.000Z', tool: 'bash', mode: 'slim', charsIn: 700, charsOut: 200, estTokensIn: 200, estTokensOut: 58 }),
];

test('aggregateSavings by day: per-day sums in ascending order', () => {
  const rows = aggregateSavings(handBuilt, 'day');
  assert.deepEqual(rows, [
    { label: '2026-06-09', savedChars: 3700, savedTokens: 1057, events: 2 },
    { label: '2026-06-10', savedChars: 500, savedTokens: 142, events: 1 },
  ]);
});

test('aggregateSavings by tool: sorted by savings descending', () => {
  const rows = aggregateSavings(handBuilt, 'tool');
  assert.deepEqual(rows, [
    { label: 'read', savedChars: 3000, savedTokens: 857, events: 1 },
    { label: 'bash', savedChars: 1200, savedTokens: 342, events: 2 },
  ]);
});

test('aggregateSavings by mode', () => {
  const rows = aggregateSavings(handBuilt, 'mode');
  assert.deepEqual(rows, [
    { label: 'optimized', savedChars: 3000, savedTokens: 857, events: 1 },
    { label: 'slim', savedChars: 1200, savedTokens: 342, events: 2 },
  ]);
});

test('terminal rendering labels estimates and draws bars', () => {
  const out = renderSavings(handBuilt, 'day', '/tmp/ledger-dir', 'last 30 days');
  assert.ok(out.includes('saved 4,200 chars (exact)'), 'exact chars total');
  assert.ok(out.includes('≈ 1,199 tokens'), 'estimated tokens total');
  assert.ok(out.includes('estimated — cheap estimator, not billable counts'));
  assert.ok(out.includes('events: 3'));
  assert.ok(out.includes('█'), 'ANSI block bars');
  assert.ok(out.includes('2026-06-09'));
  assert.ok(out.includes('2026-06-10'));
  assert.ok(out.includes('compressor benchmark'), 'points at measured savings');
  assert.ok(out.includes('/tmp/ledger-dir'), 'shows the ledger dir');
  assert.ok(out.includes('COMPRESSOR_NO_LEDGER=1'), 'kill-switch hint');
});

// Regression: totals never stated their lookback window — the default is
// --since 30d, so an unqualified headline silently reads as all-time.
test('terminal totals state the lookback window', () => {
  const out = renderSavings(handBuilt, 'day', '/tmp/ledger-dir', 'last 30 days');
  const headline = out.split('\n')[0] ?? '';
  assert.ok(headline.includes('last 30 days'), `headline must carry the window: ${headline}`);
  assert.ok(out.includes('events: 3 (last 30 days)'));
  const allTime = renderSavings(handBuilt, 'day', '/tmp/ledger-dir', 'all time');
  assert.ok((allTime.split('\n')[0] ?? '').includes('all time'));
});

test('windowLabel: humanizes --since values', () => {
  assert.equal(windowLabel('all'), 'all time');
  assert.equal(windowLabel('30d'), 'last 30 days');
  assert.equal(windowLabel('7d'), 'last 7 days');
  assert.equal(windowLabel('1d'), 'last 1 day');
});

test('empty-ledger message explains the hook and the kill switch', () => {
  const out = renderEmpty('/tmp/empty-ledger', 'last 30 days');
  assert.ok(out.includes('no ledger events yet'));
  assert.ok(out.includes('/tmp/empty-ledger'));
  assert.ok(out.includes('hook'), 'mentions the hook populating it');
  assert.ok(out.includes('agent session'));
  assert.ok(out.includes('COMPRESSOR_NO_LEDGER=1'));
});

// Regression: "no events in the window" must not misdirect the user toward
// reinstalling a working hook ("run compressor init") when the ledger simply
// has no events INSIDE the window.
test('empty-window message distinguishes window from truly empty ledger', () => {
  const out = renderEmpty('/tmp/ledger-dir', 'last 1 day', 42);
  assert.ok(out.includes('no ledger events in the last 1 day window'));
  assert.ok(out.includes('42 events outside this window'));
  assert.ok(out.includes('--since all'), 'suggests widening the window');
  assert.ok(!out.includes('compressor init'), 'must not suggest reinstalling');
});

test('html report is self-contained with one SVG chart per dimension', () => {
  const html = renderSavingsHtml(handBuilt, '/tmp/ledger-dir', 'last 30 days');
  assert.ok(html.includes('<svg'), 'inline SVG charts');
  assert.equal(html.match(/<svg/g)?.length, 3, 'by day + by tool + by mode');
  assert.ok(html.includes('by day') && html.includes('by tool') && html.includes('by mode'));
  assert.ok(html.includes('2026-06-09') && html.includes('read') && html.includes('slim'));
  assert.ok(html.includes('estimated — cheap estimator, not billable counts'));
  assert.ok(!html.includes('http://') || !html.includes('src='), 'no external requests');
  assert.ok(!html.includes('<script'), 'no JS required');
});

test('html totals state the lookback window (shareable artifact)', () => {
  const html = renderSavingsHtml(handBuilt, '/tmp/ledger-dir', 'last 30 days');
  assert.ok(html.includes('3 events · last 30 days'), 'headline carries the window');
  const allTime = renderSavingsHtml(handBuilt, '/tmp/ledger-dir', 'all time');
  assert.ok(allTime.includes('3 events · all time'));
});

test('parseSince: windows and the all keyword', () => {
  const sevenDays = parseSince('7d');
  assert.ok(sevenDays instanceof Date);
  const delta = Date.now() - sevenDays.getTime();
  assert.ok(Math.abs(delta - 7 * 86_400_000) < 5_000);
  assert.equal(parseSince('all'), undefined);
  assert.throws(() => parseSince('yesterday'));
});

test('runSavings end-to-end: terminal output plus --html file', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-savings-'));
  const lines = handBuilt.map((e) => JSON.stringify(e)).join('\n');
  await writeFile(path.join(dir, '2026-06.jsonl'), `${lines}\n`, 'utf8');
  const htmlPath = path.join(dir, 'report.html');

  const logs: string[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });

  await runSavings({ since: 'all', by: 'tool', html: htmlPath, ledgerDir: dir });

  const terminal = logs.join('\n');
  assert.ok(terminal.includes('estimated'), 'terminal output labels estimates');
  assert.ok(terminal.includes('by tool:'));
  assert.ok(terminal.includes('bash'));

  const html = await readFile(htmlPath, 'utf8');
  assert.ok(html.includes('<svg'));
  assert.ok(html.includes('by mode'));
});

test('runSavings on an empty ledger prints the friendly message', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-savings-empty-'));
  const logs: string[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });

  await runSavings({ ledgerDir: dir });

  const terminal = logs.join('\n');
  assert.ok(terminal.includes('no ledger events yet'));
  assert.ok(terminal.includes('COMPRESSOR_NO_LEDGER=1'));
});

test('runSavings: events older than the window yield the window-specific empty state', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-savings-window-'));
  // events safely older than any 1-day window regardless of when tests run
  const stale = [
    event({ ts: '2020-01-01T00:00:00.000Z' }),
    event({ ts: '2020-01-02T00:00:00.000Z' }),
    event({ ts: '2020-01-03T00:00:00.000Z' }),
  ];
  const lines = stale.map((e) => JSON.stringify(e)).join('\n');
  await writeFile(path.join(dir, '2020-01.jsonl'), `${lines}\n`, 'utf8');

  const logs: string[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });

  await runSavings({ since: '1d', ledgerDir: dir });

  const terminal = logs.join('\n');
  assert.ok(terminal.includes('no ledger events in the last 1 day window'), terminal);
  assert.ok(terminal.includes('3 events outside this window'));
  assert.ok(!terminal.includes('compressor init'), 'hook works — must not suggest reinstalling');
});

test('runSavings output and html carry the window label', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-savings-label-'));
  const lines = handBuilt.map((e) => JSON.stringify(e)).join('\n');
  await writeFile(path.join(dir, '2026-06.jsonl'), `${lines}\n`, 'utf8');
  const htmlPath = path.join(dir, 'report.html');

  const logs: string[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });

  await runSavings({ since: 'all', by: 'day', html: htmlPath, ledgerDir: dir });

  const terminal = logs.join('\n');
  assert.ok(terminal.includes('all time'), 'terminal window label');
  const html = await readFile(htmlPath, 'utf8');
  assert.ok(html.includes('all time'), 'html window label');
});
