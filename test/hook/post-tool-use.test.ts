import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePostToolUse } from '../../src/hook/post-tool-use.ts';

function repetitiveLog(lines: number): string {
  return Array.from(
    { length: lines },
    () => 'warning: unused variable `x` found while linting src/lib.rs:42',
  ).join('\n');
}

interface BashOutput {
  stdout: string;
  stderr: string;
  interrupted: boolean;
  isImage: boolean;
}

interface Envelope<T> {
  hookSpecificOutput: {
    hookEventName: string;
    updatedToolOutput: T;
  };
}

function bashPayload(stdout: string): string {
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'cargo build 2>&1' },
    tool_use_id: 'toolu_01',
    tool_response: {
      stdout,
      stderr: 'warn-free',
      interrupted: false,
      isImage: false,
    },
  });
}

test('Bash payload with huge repetitive stdout is compressed shape-preservingly', () => {
  const stdout = repetitiveLog(400);
  const result = handlePostToolUse(bashPayload(stdout), 'slim');
  const out = result.output;
  assert.ok(out !== null, 'expected non-null output');

  const parsed = JSON.parse(out) as Envelope<BashOutput>;
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse');

  const updated = parsed.hookSpecificOutput.updatedToolOutput;
  assert.equal(updated.stderr, 'warn-free');
  assert.equal(updated.interrupted, false);
  assert.equal(updated.isImage, false);
  assert.ok(updated.stdout.includes('[compressor:'), 'stdout carries an omission marker');
  assert.ok(updated.stdout.length < stdout.length, 'stdout actually shrank');
});

test('targeted Read (offset/limit in tool_input) passes through', () => {
  const payload = JSON.stringify({
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/big.ts', offset: 100, limit: 50 },
    tool_use_id: 'toolu_02',
    tool_response: {
      type: 'text',
      file: { filePath: '/tmp/big.ts', content: repetitiveLog(400), numLines: 400 },
    },
  });
  assert.equal(handlePostToolUse(payload, 'slim').output, null);
});

test("mode 'full' is always passthrough", () => {
  assert.equal(handlePostToolUse(bashPayload(repetitiveLog(400)), 'full').output, null);
});

test('garbage stdin is passthrough (fail-open)', () => {
  assert.equal(handlePostToolUse('not json {{{', 'slim').output, null);
  assert.equal(handlePostToolUse('', 'optimized').output, null);
  assert.equal(handlePostToolUse('42', 'slim').output, null);
});

test('tiny output stays untouched (below savings floor)', () => {
  assert.equal(handlePostToolUse(bashPayload('ok\n'), 'slim').output, null);
});

test('unknown tool shape: only the longest string leaf is rewritten', () => {
  const huge = repetitiveLog(300);
  const payload = JSON.stringify({
    tool_name: 'WebFetch',
    tool_input: { url: 'https://example.com' },
    tool_use_id: 'toolu_03',
    tool_response: {
      code: 200,
      result: {
        items: [{ note: 'short note' }, { body: huge }],
        ok: true,
      },
    },
  });
  const result = handlePostToolUse(payload, 'slim');
  const out = result.output;
  assert.ok(out !== null, 'expected non-null output');

  interface FetchOutput {
    code: number;
    result: { items: [{ note: string }, { body: string }]; ok: boolean };
  }
  const parsed = JSON.parse(out) as Envelope<FetchOutput>;
  const updated = parsed.hookSpecificOutput.updatedToolOutput;
  assert.equal(updated.code, 200);
  assert.equal(updated.result.ok, true);
  assert.equal(updated.result.items[0].note, 'short note');
  assert.notEqual(updated.result.items[1].body, huge);
  assert.ok(updated.result.items[1].body.includes('[compressor:'));
  assert.ok(updated.result.items[1].body.length < huge.length);
});

test('idempotency: compressed output fed back through is passthrough', () => {
  const first = handlePostToolUse(bashPayload(repetitiveLog(400)), 'slim');
  const out = first.output;
  assert.ok(out !== null, 'expected non-null output on first pass');

  const updated = (JSON.parse(out) as Envelope<BashOutput>).hookSpecificOutput.updatedToolOutput;
  const second = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'cargo build 2>&1' },
    tool_use_id: 'toolu_04',
    tool_response: updated,
  });
  assert.equal(handlePostToolUse(second, 'slim').output, null);
});

test('string tool_response is compressed directly to a string', () => {
  const payload = JSON.stringify({
    tool_name: 'SomeTool',
    tool_input: {},
    tool_use_id: 'toolu_05',
    tool_response: repetitiveLog(400),
  });
  const result = handlePostToolUse(payload, 'slim');
  const out = result.output;
  assert.ok(out !== null, 'expected non-null output');
  const parsed = JSON.parse(out) as Envelope<string>;
  assert.equal(typeof parsed.hookSpecificOutput.updatedToolOutput, 'string');
  assert.ok(parsed.hookSpecificOutput.updatedToolOutput.includes('[compressor:'));
});
