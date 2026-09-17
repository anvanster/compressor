import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWN_ENTRY_TYPES,
  KNOWN_SCHEMA_VERSION,
  emptyProbe,
  probeDebugLog,
  readLlmRequests,
} from '../../src/copilot/debug-log.ts';

// Fixtures follow IDebugLogEntry as declared in vscode-copilot-chat
// (src/platform/chat/common/chatDebugFileLoggerService.ts). No IO: the reader
// takes file contents, so a schema change is a fixture change here.

const entry = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: 1,
    ts: 1789668479600,
    dur: 0,
    sid: 'session-a',
    type: 'session_start',
    name: 'session_start',
    spanId: 'span-1',
    status: 'ok',
    attrs: { copilotVersion: '0.64.1', vscodeVersion: '1.136.2' },
    ...overrides,
  });

const llmRequest = (attrs: Record<string, unknown>, overrides: Record<string, unknown> = {}) =>
  entry({
    type: 'llm_request',
    name: `chat:${attrs['model'] ?? 'unknown'}`,
    dur: 1500,
    attrs,
    ...overrides,
  });

test('readLlmRequests: model and token counters come off attrs', () => {
  const log = [
    entry(),
    llmRequest({ model: 'gpt-4o', inputTokens: 1000, outputTokens: 500, ttft: 300 }),
  ].join('\n');
  assert.deepEqual(readLlmRequests(log), [
    {
      ts: 1789668479600,
      sessionId: 'session-a',
      model: 'gpt-4o',
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 1500,
      status: 'ok',
    },
  ]);
});

test('readLlmRequests: an absent counter stays absent and is never zero', () => {
  const [request] = readLlmRequests(llmRequest({ model: 'gpt-4o', outputTokens: 12 }));
  assert.equal(request?.inputTokens, undefined, 'unknown must not be coerced to 0');
  assert.equal(request?.outputTokens, 12);
  // a negative or non-numeric counter is unknown, not a value
  const [bad] = readLlmRequests(llmRequest({ model: 'm', inputTokens: -5, outputTokens: 'lots' }));
  assert.equal(bad?.inputTokens, undefined);
  assert.equal(bad?.outputTokens, undefined);
});

test('readLlmRequests: other entry types, blank lines and a torn tail are skipped', () => {
  const log = [
    entry({ type: 'tool_call', name: 'read_file', attrs: { args: '{}' } }),
    '',
    llmRequest({ model: 'gpt-4o', inputTokens: 1 }),
    '{"ts":1789,"sid":"s","type":"llm_re', // writer flushes on a timer
  ].join('\n');
  assert.equal(readLlmRequests(log).length, 1);
});

test('readLlmRequests: ordered by timestamp and filtered by window', () => {
  const log = [
    llmRequest({ model: 'b' }, { ts: 3000 }),
    llmRequest({ model: 'a' }, { ts: 1000 }),
    llmRequest({ model: 'c' }, { ts: 2000 }),
  ].join('\n');
  assert.deepEqual(readLlmRequests(log).map((r) => r.model), ['a', 'c', 'b']);
  assert.deepEqual(readLlmRequests(log, 2000).map((r) => r.model), ['c', 'b']);
});

test('readLlmRequests: a missing model is named, not dropped', () => {
  assert.equal(readLlmRequests(llmRequest({ inputTokens: 5 }))[0]?.model, 'unknown');
});

test('probeDebugLog: reports what was present, per type', () => {
  const probe = probeDebugLog(
    [
      entry(),
      entry({ type: 'tool_call', name: 'read_file', attrs: { args: '{}', result: 'ok' } }),
      llmRequest({ model: 'gpt-4o', inputTokens: 1000, outputTokens: 500 }),
    ].join('\n'),
  );
  assert.equal(probe.entries, 3);
  assert.equal(probe.malformed, 0);
  assert.deepEqual(probe.byType, { session_start: 1, tool_call: 1, llm_request: 1 });
  assert.deepEqual(probe.attrsByType['tool_call'], ['args', 'result']);
  assert.deepEqual(probe.attrsByType['llm_request'], ['inputTokens', 'model', 'outputTokens']);
  assert.deepEqual(probe.versions, [1]);
  assert.equal(probe.unknownSchema, false);
  assert.deepEqual(probe.unknownTypes, []);
});

test('probeDebugLog: distinguishes "logging off" from "schema moved"', () => {
  // logging off: nothing but session markers, no llm_request at all
  const off = probeDebugLog([entry(), entry()].join('\n'));
  assert.equal(off.byType['llm_request'], undefined);
  assert.equal(off.unknownSchema, false);

  // schema moved: requests exist but the counters we read are gone
  const moved = probeDebugLog(
    [llmRequest({ model: 'gpt-4o', usage: '{"in":1,"out":2}' })].join('\n'),
  );
  assert.equal(moved.byType['llm_request'], 1);
  assert.equal(moved.requestsMissingInputTokens, 1);
  assert.equal(moved.requestsMissingOutputTokens, 1);
  assert.deepEqual(moved.attrsByType['llm_request'], ['model', 'usage']);
});

test('probeDebugLog: a newer schema version and unknown types are flagged', () => {
  const probe = probeDebugLog(
    [entry({ v: 2, type: 'model_switch' }), entry({ v: 1 })].join('\n'),
  );
  assert.equal(probe.unknownSchema, true);
  assert.deepEqual(probe.versions, [1, 2]);
  assert.deepEqual(probe.unknownTypes, ['model_switch']);
});

test('probeDebugLog: absent v counts as version 1, malformed lines are counted', () => {
  const probe = probeDebugLog(['{"ts":1,"sid":"s","type":"hook","attrs":{}}', 'garbage'].join('\n'));
  assert.deepEqual(probe.versions, [1]);
  assert.equal(probe.malformed, 1);
  assert.equal(probe.entries, 1);
});

test('probeDebugLog: folds across files so a session directory is one report', () => {
  const probe = probeDebugLog(llmRequest({ model: 'a' }), probeDebugLog(entry(), emptyProbe()));
  assert.equal(probe.entries, 2);
  assert.deepEqual(Object.keys(probe.byType).sort(), ['llm_request', 'session_start']);
});

test('the known schema is pinned, so an upstream change is a failing test', () => {
  assert.equal(KNOWN_SCHEMA_VERSION, 1);
  assert.deepEqual([...KNOWN_ENTRY_TYPES], [
    'session_start', 'tool_call', 'llm_request', 'user_message', 'agent_response',
    'subagent', 'discovery', 'error', 'generic', 'child_session_ref', 'hook',
    'turn_start', 'turn_end',
  ]);
});
