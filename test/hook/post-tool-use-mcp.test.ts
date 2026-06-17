import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { handlePostToolUse } from '../../src/hook/post-tool-use.ts';

// MCP reach: the PostToolUse hook now matches 'mcp__*' tools. Their JSON output
// (a content-block array [{type:'text',text:'<json>'}]) is found by the generic
// longest-string-leaf and minified shape-preservingly, emitted via the unified
// updatedToolOutput field. Unrecognized shapes fail open (null). Keep hermetic.
process.env['COMPRESSOR_NO_LEDGER'] = '1';
process.env['COMPRESSOR_RECOVERY_DIR'] = mkdtempSync(join(tmpdir(), 'compressor-mcp-recovery-'));

interface Envelope<T> {
  hookSpecificOutput: {
    hookEventName: string;
    updatedToolOutput: T;
  };
}

type ContentBlocks = Array<{ type: string; text: string }>;

/** A pretty JSON payload large enough to clear slim's touch and the savings floor. */
function bigPrettyJson(rows: number): string {
  const arr = Array.from({ length: rows }, (_, i) => ({
    id: i,
    name: `item ${i}`,
    note: 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod',
  }));
  return JSON.stringify({ rows: arr }, null, 2);
}

function mcpPayload(toolResponse: unknown): string {
  return JSON.stringify({
    tool_name: 'mcp__codegraph__search_semantic',
    tool_input: { query: 'foo' },
    tool_use_id: 'toolu_mcp_01',
    session_id: 's-mcp',
    tool_response: toolResponse,
  });
}

test('MCP content-block array: text leaf minified, shape preserved, valid JSON', () => {
  const pretty = bigPrettyJson(40);
  const blocks: ContentBlocks = [{ type: 'text', text: pretty }];
  const result = handlePostToolUse(mcpPayload(blocks), 'slim');
  const out = result.output;
  assert.ok(out !== null, 'expected non-null output for MCP JSON');

  const parsed = JSON.parse(out) as Envelope<ContentBlocks>;
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse');
  const updated = parsed.hookSpecificOutput.updatedToolOutput;

  // SAME shape: a one-element array with a text block
  assert.ok(Array.isArray(updated), 'updatedToolOutput is still an array');
  assert.equal(updated.length, 1);
  assert.equal(updated[0]?.type, 'text');

  const text = updated[0]?.text ?? '';
  assert.ok(text.length < pretty.length, 'the text leaf actually shrank');
  // lossless minify: valid JSON, semantically equal, no omission marker
  assert.deepEqual(JSON.parse(text), JSON.parse(pretty));
  assert.ok(!text.includes('[compressor:'), 'lossless transform leaves no marker');
});

test('MCP optimized mode also minifies JSON output', () => {
  const pretty = bigPrettyJson(60);
  const blocks: ContentBlocks = [{ type: 'text', text: pretty }];
  const out = handlePostToolUse(mcpPayload(blocks), 'optimized').output;
  assert.ok(out !== null);
  const updated = (JSON.parse(out) as Envelope<ContentBlocks>).hookSpecificOutput
    .updatedToolOutput;
  assert.deepEqual(JSON.parse(updated[0]?.text ?? ''), JSON.parse(pretty));
});

test('MCP string tool_response (alt shape) minifies directly to a string', () => {
  const pretty = bigPrettyJson(40);
  const out = handlePostToolUse(mcpPayload(pretty), 'slim').output;
  assert.ok(out !== null);
  const updated = (JSON.parse(out) as Envelope<string>).hookSpecificOutput.updatedToolOutput;
  assert.equal(typeof updated, 'string');
  assert.deepEqual(JSON.parse(updated), JSON.parse(pretty));
});

test('already-minified MCP JSON is a no-op (below savings floor)', () => {
  const dense = JSON.stringify({ rows: Array.from({ length: 40 }, (_, i) => ({ id: i })) });
  const blocks: ContentBlocks = [{ type: 'text', text: dense }];
  assert.equal(handlePostToolUse(mcpPayload(blocks), 'slim').output, null);
});

test('non-JSON MCP text is left alone when it would not compress (fail-open)', () => {
  // a short human-readable MCP result: below the savings floor → no-op
  const blocks: ContentBlocks = [{ type: 'text', text: 'Found 2 matches in src/foo.ts' }];
  assert.equal(handlePostToolUse(mcpPayload(blocks), 'slim').output, null);
});

test('unrecognized MCP shape (no string leaf) is a no-op (FAIL OPEN)', () => {
  // a response with no string anywhere → pickLeaf returns null → output null
  const shape = { count: 3, ok: true, ids: [1, 2, 3] };
  assert.equal(handlePostToolUse(mcpPayload(shape), 'slim').output, null);
  // an empty content-block array
  assert.equal(handlePostToolUse(mcpPayload([]), 'slim').output, null);
  // null response
  assert.equal(handlePostToolUse(mcpPayload(null), 'slim').output, null);
});

test("mode 'full' is passthrough for MCP too", () => {
  const blocks: ContentBlocks = [{ type: 'text', text: bigPrettyJson(40) }];
  assert.equal(handlePostToolUse(mcpPayload(blocks), 'full').output, null);
});

test('a non-matcher, non-MCP tool still no-ops (cross-host guard intact)', () => {
  const payload = JSON.stringify({
    tool_name: 'editFiles', // VS Code tool name — neither matcher nor mcp__
    tool_input: { files: ['src/x.ts'] },
    tool_use_id: 't1',
    tool_response: bigPrettyJson(40),
  });
  assert.equal(handlePostToolUse(payload, 'slim').output, null);
});

test('a near-miss tool name "mcpfoo" (not the mcp__ prefix) no-ops', () => {
  const payload = JSON.stringify({
    tool_name: 'mcpfoo',
    tool_input: {},
    tool_use_id: 't2',
    tool_response: bigPrettyJson(40),
  });
  assert.equal(handlePostToolUse(payload, 'slim').output, null);
});
