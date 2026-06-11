import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { handlePostToolUse } from '../../src/hook/post-tool-use.ts';

// Worthwhile compressions fire fire-and-forget ledger appends; keep this
// suite hermetic (never touch the real ~/.compressor). Ledger behavior has
// its own tests under test/ledger/ using temp dirs.
process.env['COMPRESSOR_NO_LEDGER'] = '1';

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

// big enough (cheapEstimator) to trip slim's truncate budget; no repeats so
// dedupe stays out of the way and the truncation marker carries the style
function distinctLog(lines: number): string {
  return Array.from(
    { length: lines },
    (_, i) => `row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur adipiscing`,
  ).join('\n');
}

function stdoutOf(output: string | null): string {
  assert.ok(output !== null, 'expected non-null output');
  return (JSON.parse(output) as Envelope<BashOutput>).hookSpecificOutput.updatedToolOutput.stdout;
}

test('marker style defaults to the policy value (plain)', () => {
  const stdout = stdoutOf(handlePostToolUse(bashPayload(distinctLog(600)), 'slim').output);
  assert.match(stdout, /— re-run with a narrower filter \(grep, --quiet, head\) to retrieve\]/);
  assert.ok(!stdout.includes('likely irrelevant'));
});

test('--marker-style deterrent override changes ONLY the marker line', () => {
  const plain = stdoutOf(handlePostToolUse(bashPayload(distinctLog(600)), 'slim').output);
  const deterrent = stdoutOf(
    handlePostToolUse(bashPayload(distinctLog(600)), 'slim', 'deterrent').output,
  );
  assert.ok(deterrent.includes('likely irrelevant'), 'deterrent phrasing present');
  assert.ok(deterrent.includes('ONLY if the problem you are chasing'));
  const sansMarkers = (text: string): string =>
    text
      .split('\n')
      .filter((line) => !line.includes('[compressor:'))
      .join('\n');
  assert.equal(sansMarkers(deterrent), sansMarkers(plain), 'non-marker content identical');
});

test('--marker-style informative override reports the omitted-range scan', () => {
  const rows = distinctLog(600).split('\n');
  rows[300] = 'Error: kaboom while processing row 00300'; // 1-based line 301
  const stdout = stdoutOf(
    handlePostToolUse(bashPayload(rows.join('\n')), 'slim', 'informative').output,
  );
  assert.ok(
    stdout.includes('1 lines matching error/fail/warn at lines 301'),
    `expected scan report in: ${stdout.slice(0, 400)}`,
  );
});
