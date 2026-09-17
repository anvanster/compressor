import test from 'node:test';
import assert from 'node:assert/strict';
import type { LlmRequest } from '../../src/copilot/debug-log.ts';
import { emptyProbe, probeDebugLog } from '../../src/copilot/debug-log.ts';
import { aggregateCopilotUsage, savingsShare } from '../../src/copilot/usage.ts';
import {
  savingsShareHtml,
  usageEmptyStateHtml,
  usageHtml,
} from '../../src/copilot/usage-report.ts';

const SETTING = 'github.copilot.chat.agentDebugLog.fileLogging.enabled';

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    ts: Date.UTC(2026, 8, 10, 12),
    sessionId: 'session-a',
    model: 'gpt-5.2',
    inputTokens: 1000,
    cachedTokens: 0,
    outputTokens: 200,
    nanoAiu: 1_000_000_000,
    durationMs: 1500,
    status: 'ok',
    ...overrides,
  };
}

const entry = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, ts: 1, dur: 0, sid: 's', type: 'session_start', name: 'n', spanId: 'x', status: 'ok', attrs: {}, ...over });

test('empty state: no logs at all points at the setting and says it is not retroactive', () => {
  const html = usageEmptyStateHtml(emptyProbe(), SETTING);
  assert.match(html, /Enable/);
  assert.match(html, /agentDebugLog\.fileLogging\.enabled/);
  assert.match(html, /not\s*\n?\s*retroactive/);
});

test('empty state: logs present but no requests reads differently from no logs', () => {
  const probe = probeDebugLog([entry(), entry()].join('\n'));
  const html = usageEmptyStateHtml(probe, SETTING);
  assert.match(html, /2 entries/);
  assert.doesNotMatch(html, /Enable/, 'logging is already on — telling them to enable it misdirects');
});

test('empty state: a schema move names the attributes that were actually there', () => {
  const probe = probeDebugLog(
    entry({ type: 'llm_request', attrs: { model: 'gpt-5.2', usage: '{}' } }),
  );
  const html = usageEmptyStateHtml(probe, SETTING);
  assert.match(html, /none reported token counts/);
  assert.match(html, /model, usage/, 'the observed attrs are shown so the drift is diagnosable');
});

test('empty state: a newer schema says compressor is the thing out of date', () => {
  const probe = probeDebugLog(entry({ v: 9, type: 'llm_request', attrs: { model: 'm' } }));
  assert.match(usageEmptyStateHtml(probe, SETTING), /compressor needs an update/);
});

test('usageHtml: totals, model table and the provenance line', () => {
  const summary = aggregateCopilotUsage([
    request(),
    request({ model: 'gpt-5-mini', inputTokens: 50, outputTokens: 10, nanoAiu: 0 }),
  ]);
  const html = usageHtml(summary, 'last 30 days');
  assert.match(html, /class="kpi-value">2<\/div>/, 'request count KPI');
  assert.match(html, /class="kpi-value">1,050<\/div>/, 'prompt token KPI');
  assert.match(html, /<td>gpt-5\.2<\/td>/);
  assert.match(html, /real usage/);
  assert.doesNotMatch(html, /Floor, not a total/, 'no note when everything was reported');
});

test('usageHtml: billed AI Units are shown as measured spend', () => {
  // 17.1085 AIU is the figure a real claude-opus-5 request reported
  const summary = aggregateCopilotUsage([
    request({ inputTokens: 292_801, cachedTokens: 290_725, outputTokens: 510, nanoAiu: 17_108_500_000 }),
  ]);
  const html = usageHtml(summary, 'last 30 days');
  assert.match(html, /class="kpi-value">\$0\.17<\/div>/);
  assert.match(html, /17 AI Units/);
  assert.match(html, /class="kpi-value">99\.3%<\/div>/, 'cache hit rate KPI');
  assert.match(html, /far below what a rate card applied to raw token counts/);
});

test('usageHtml: no billed amount reported renders no spend headline', () => {
  const summary = aggregateCopilotUsage([request({ nanoAiu: undefined })]);
  const html = usageHtml(summary, 'last 30 days');
  assert.doesNotMatch(html, /AI Units/);
  assert.match(html, /no billed amount/, 'the gap is stated rather than shown as $0.00');
});

test('usageHtml: unreported counters turn the total into a stated floor', () => {
  const summary = aggregateCopilotUsage([request(), request({ inputTokens: undefined })]);
  const html = usageHtml(summary, 'last 7 days');
  assert.match(html, /Floor, not a total/);
  assert.match(html, /1 reported no input count/);
});
test('usageHtml: failed requests are surfaced, model names escaped', () => {
  const summary = aggregateCopilotUsage([request({ model: '<script>', status: 'error' })]);
  const html = usageHtml(summary, 'all time');
  assert.match(html, /1 requests failed/);
  assert.doesNotMatch(html, /<script>/);
});

test('savingsShareHtml: the headline comparison, marked as mixed units', () => {
  const summary = aggregateCopilotUsage([request({ inputTokens: 3000 })]);
  const share = savingsShare(
    [{
      ts: '2026-09-10T12:00:00.000Z', agent: 'vscode', tool: 'read', mode: 'optimized',
      charsIn: 4000, charsOut: 0, estTokensIn: 1000, estTokensOut: 0, transforms: [],
    }],
    summary,
  );
  const html = savingsShareHtml(share);
  assert.match(html, /≈25\.0%/);
  assert.match(html, /Mixed units/);
});

test('savingsShareHtml: nothing on either side renders nothing', () => {
  assert.equal(savingsShareHtml(savingsShare([], aggregateCopilotUsage([]))), '');
  assert.equal(
    savingsShareHtml(savingsShare([], aggregateCopilotUsage([request()]))),
    '',
    'usage without savings is not a reduction claim',
  );
});

test('savingsShareHtml: an incomplete sent total qualifies the direction of error', () => {
  const summary = aggregateCopilotUsage([request({ inputTokens: 1000 }), request({ inputTokens: undefined })]);
  const share = savingsShare(
    [{
      ts: '2026-09-10T12:00:00.000Z', agent: 'vscode', tool: 'read', mode: 'optimized',
      charsIn: 1, charsOut: 0, estTokensIn: 1000, estTokensOut: 0, transforms: [],
    }],
    summary,
  );
  assert.match(savingsShareHtml(share), /real share is lower/);
});
