import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { handleCopilotPostToolUse } from '../../src/hook/copilot.ts';
import { settleLedger } from '../../src/ledger/write.ts';

// Worthwhile compressions fire fire-and-forget ledger appends; keep this
// suite hermetic (never touch the real ~/.compressor). Ledger behavior has
// its own tests under test/ledger/ using temp dirs. Same for recovery-budget
// state (real dir is os.tmpdir()/compressor-recovery; behavior tests live in
// test/hook/recovery.test.ts).
process.env['COMPRESSOR_NO_LEDGER'] = '1';
process.env['COMPRESSOR_RECOVERY_DIR'] = mkdtempSync(join(tmpdir(), 'compressor-cp-recovery-'));
// CCR stash is default-on for the hook path; point it at a temp dir so non-file
// (bash) retrieve markers write hermetically, never touching the real stash.
process.env['COMPRESSOR_CCR_DIR'] = mkdtempSync(join(tmpdir(), 'compressor-cp-ccr-'));

function repetitiveLog(lines: number): string {
  return Array.from(
    { length: lines },
    () => 'warning: unused variable `x` found while linting src/lib.rs:42',
  ).join('\n');
}

interface CopilotResponse {
  modifiedResult: {
    resultType: 'success';
    textResultForLlm: string;
  };
}

/**
 * Payload per the documented camelCase postToolUse input (event registered as
 * `postToolUse`), field-for-field:
 *   { sessionId: string; timestamp: number; cwd: string; toolName: string;
 *     toolArgs: unknown;
 *     toolResult: { resultType: "success"; textResultForLlm: string } }
 */
function copilotPayload(toolName: string, toolArgs: unknown, text: string): string {
  return JSON.stringify({
    sessionId: '0193e4c2-demo-session',
    timestamp: 1765432100000,
    cwd: '/tmp/project',
    toolName,
    toolArgs,
    toolResult: {
      resultType: 'success',
      textResultForLlm: text,
    },
  });
}

test('conformance: documented payload in, exactly the documented response shape out', () => {
  const text = repetitiveLog(400);
  const result = handleCopilotPostToolUse(
    copilotPayload('bash', { command: 'cargo build 2>&1' }, text),
    'slim',
  );
  const out = result.output;
  assert.ok(out !== null, 'expected non-null output');

  const parsed = JSON.parse(out) as CopilotResponse;
  // exact output schema: { modifiedResult: { resultType, textResultForLlm } }
  assert.deepEqual(Object.keys(parsed), ['modifiedResult']);
  assert.deepEqual(Object.keys(parsed.modifiedResult).sort(), [
    'resultType',
    'textResultForLlm',
  ]);
  assert.equal(parsed.modifiedResult.resultType, 'success');
  assert.equal(typeof parsed.modifiedResult.textResultForLlm, 'string');
});

test('bash: huge repetitive output is compressed with the omission marker', () => {
  const text = repetitiveLog(400);
  const out = handleCopilotPostToolUse(
    copilotPayload('bash', { command: 'cargo build 2>&1' }, text),
    'slim',
  ).output;
  assert.ok(out !== null, 'expected non-null output');
  const replaced = (JSON.parse(out) as CopilotResponse).modifiedResult.textResultForLlm;
  assert.ok(replaced.includes('[compressor:'), 'carries an omission marker');
  assert.ok(replaced.length < text.length, 'actually shrank');
});

test('powershell maps to the shell path and compresses too', () => {
  const text = repetitiveLog(400);
  const out = handleCopilotPostToolUse(
    copilotPayload('powershell', { command: 'cargo build 2>&1' }, text),
    'slim',
  ).output;
  assert.ok(out !== null, 'expected non-null output');
  assert.ok(
    (JSON.parse(out) as CopilotResponse).modifiedResult.textResultForLlm.includes(
      '[compressor:',
    ),
  );
});

test('targeted view (offset/limit in toolArgs) passes through', () => {
  const payload = copilotPayload(
    'view',
    { path: '/tmp/big.ts', offset: 100, limit: 50 },
    repetitiveLog(400),
  );
  assert.equal(handleCopilotPostToolUse(payload, 'slim').output, null);
});

test('untargeted view of a big file is compressed', () => {
  const out = handleCopilotPostToolUse(
    copilotPayload('view', { path: '/tmp/build.log' }, repetitiveLog(400)),
    'slim',
  ).output;
  assert.ok(out !== null, 'expected non-null output');
  assert.ok(
    (JSON.parse(out) as CopilotResponse).modifiedResult.textResultForLlm.includes(
      '[compressor:',
    ),
  );
});

// The CLI docs' only concrete payload example sends toolArgs as a
// JSON-ENCODED STRING ("toolArgs":"{\"command\":\"ls\"}"), not an object.
// Regression: the string form must drive targeting/filePath exactly like the
// object form, or every range-limited `view` read gets compressed.
test('regression: string-form toolArgs (wire format) — targeted view passes through', () => {
  const payload = copilotPayload(
    'view',
    JSON.stringify({ path: '/tmp/big.ts', offset: 100, limit: 50 }),
    repetitiveLog(400),
  );
  assert.equal(handleCopilotPostToolUse(payload, 'slim').output, null);
});

test('regression: string-form toolArgs — untargeted view still compresses', () => {
  const out = handleCopilotPostToolUse(
    copilotPayload('view', JSON.stringify({ path: '/tmp/build.log' }), repetitiveLog(400)),
    'slim',
  ).output;
  assert.ok(out !== null, 'expected non-null output');
  assert.ok(
    (JSON.parse(out) as CopilotResponse).modifiedResult.textResultForLlm.includes(
      '[compressor:',
    ),
  );
});

test('regression: unparseable string toolArgs fails open to {} — compression proceeds', () => {
  const out = handleCopilotPostToolUse(
    copilotPayload('view', 'not json {{', repetitiveLog(400)),
    'slim',
  ).output;
  assert.ok(out !== null, 'expected non-null output');
  assert.ok(
    (JSON.parse(out) as CopilotResponse).modifiedResult.textResultForLlm.includes(
      '[compressor:',
    ),
  );
});

test("mode 'full' is always passthrough", () => {
  const payload = copilotPayload('bash', { command: 'x' }, repetitiveLog(400));
  assert.equal(handleCopilotPostToolUse(payload, 'full').output, null);
});

test('garbage stdin is passthrough (fail-open)', () => {
  assert.equal(handleCopilotPostToolUse('not json {{{', 'slim').output, null);
  assert.equal(handleCopilotPostToolUse('', 'optimized').output, null);
  assert.equal(handleCopilotPostToolUse('42', 'slim').output, null);
});

test('tiny output stays untouched (below savings floor)', () => {
  assert.equal(
    handleCopilotPostToolUse(copilotPayload('bash', { command: 'ls' }, 'ok\n'), 'slim')
      .output,
    null,
  );
});

test('idempotency: compressed output fed back through is passthrough', () => {
  const first = handleCopilotPostToolUse(
    copilotPayload('bash', { command: 'cargo build 2>&1' }, repetitiveLog(400)),
    'slim',
  ).output;
  assert.ok(first !== null, 'expected non-null output on first pass');
  const compressed = (JSON.parse(first) as CopilotResponse).modifiedResult
    .textResultForLlm;
  const second = handleCopilotPostToolUse(
    copilotPayload('bash', { command: 'cargo build 2>&1' }, compressed),
    'slim',
  );
  assert.equal(second.output, null);
});

test('non-success resultType is never rewritten into a success', () => {
  const payload = JSON.stringify({
    sessionId: 's',
    timestamp: 1765432100000,
    cwd: '/tmp/project',
    toolName: 'bash',
    toolArgs: { command: 'cargo build' },
    toolResult: { resultType: 'failure', textResultForLlm: repetitiveLog(400) },
  });
  assert.equal(handleCopilotPostToolUse(payload, 'slim').output, null);
});

test('unknown toolResult shape: generic leaf path, siblings preserved in JSON', () => {
  const huge = repetitiveLog(300);
  const payload = JSON.stringify({
    sessionId: 's',
    timestamp: 1765432100000,
    cwd: '/tmp/project',
    toolName: 'web_fetch',
    toolArgs: { url: 'https://example.com' },
    toolResult: {
      code: 200,
      result: { items: [{ note: 'short note' }, { body: huge }], ok: true },
    },
  });
  const out = handleCopilotPostToolUse(payload, 'slim').output;
  assert.ok(out !== null, 'expected non-null output');

  const parsed = JSON.parse(out) as CopilotResponse;
  assert.equal(parsed.modifiedResult.resultType, 'success');
  interface FetchShape {
    code: number;
    result: { items: [{ note: string }, { body: string }]; ok: boolean };
  }
  // the replacement string renders the rebuilt structure as JSON: only the
  // longest string leaf was rewritten, every sibling field survives
  const rebuilt = JSON.parse(parsed.modifiedResult.textResultForLlm) as FetchShape;
  assert.equal(rebuilt.code, 200);
  assert.equal(rebuilt.result.ok, true);
  assert.equal(rebuilt.result.items[0].note, 'short note');
  assert.notEqual(rebuilt.result.items[1].body, huge);
  assert.ok(rebuilt.result.items[1].body.includes('[compressor:'));
  assert.ok(rebuilt.result.items[1].body.length < huge.length);
});

test('bare-string toolResult (undocumented) is compressed directly to a string', () => {
  const payload = JSON.stringify({
    sessionId: 's',
    timestamp: 1765432100000,
    cwd: '/tmp/project',
    toolName: 'some_mcp_tool',
    toolArgs: {},
    toolResult: repetitiveLog(400),
  });
  const out = handleCopilotPostToolUse(payload, 'slim').output;
  assert.ok(out !== null, 'expected non-null output');
  const replaced = (JSON.parse(out) as CopilotResponse).modifiedResult.textResultForLlm;
  assert.ok(replaced.includes('[compressor:'));
  assert.equal(replaced.startsWith('"'), false, 'not JSON-wrapped');
});

// internal/VSCODE-HOOKS-VERIFICATION.md V3: VS Code agent mode also executes
// the COMMAND hooks our copilot adapter writes (.github/hooks/*.json,
// ~/.copilot/hooks) and ignores matchers — but it sends the SNAKE_CASE payload
// (tool_name/tool_response), not Copilot's camelCase. This layer's camelCase
// parse must find nothing: toolName '' and toolResult undefined → null output
// and, crucially, NO ledger event. Pinned as a regression contract: if the
// parse ever grows snake_case tolerance, VS Code payloads would start
// compress-and-ledgering replacements VS Code never applies.
test('regression: snake_case VS Code payload no-ops — null output, no ledger event', async () => {
  const ledgerDir = mkdtempSync(join(tmpdir(), 'compressor-cp-vscode-ledger-'));
  const prevNoLedger = process.env['COMPRESSOR_NO_LEDGER'];
  const prevLedgerDir = process.env['COMPRESSOR_LEDGER_DIR'];
  delete process.env['COMPRESSOR_NO_LEDGER']; // armed: an un-guarded compression would write
  process.env['COMPRESSOR_LEDGER_DIR'] = ledgerDir;
  try {
    const payload = JSON.stringify({
      tool_name: 'editFiles',
      tool_input: { files: ['src/main.ts'] },
      tool_use_id: 'tool-123',
      tool_response: repetitiveLog(400), // big enough to compress if ever parsed
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      cwd: '/x',
      transcript_path: '/t',
    });
    assert.equal(handleCopilotPostToolUse(payload, 'slim').output, null);
    await settleLedger();
    assert.deepEqual(readdirSync(ledgerDir), [], 'no phantom ledger event');
  } finally {
    if (prevNoLedger === undefined) {
      delete process.env['COMPRESSOR_NO_LEDGER'];
    } else {
      process.env['COMPRESSOR_NO_LEDGER'] = prevNoLedger;
    }
    if (prevLedgerDir === undefined) {
      delete process.env['COMPRESSOR_LEDGER_DIR'];
    } else {
      process.env['COMPRESSOR_LEDGER_DIR'] = prevLedgerDir;
    }
  }
});

test('toolResult with no string content at all is passthrough', () => {
  const payload = JSON.stringify({
    sessionId: 's',
    timestamp: 1765432100000,
    cwd: '/tmp/project',
    toolName: 'glob',
    toolArgs: { pattern: '*.ts' },
    toolResult: 7,
  });
  assert.equal(handleCopilotPostToolUse(payload, 'slim').output, null);
});

// big enough (cheapEstimator) to trip slim's truncate budget; no repeats so
// dedupe stays out of the way and the truncation marker carries the style
function distinctLog(lines: number): string {
  return Array.from(
    { length: lines },
    (_, i) => `row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur adipiscing`,
  ).join('\n');
}

// CCR (Phase 2) supersedes the marker-STYLE recovery clause for NON-FILE
// (bash) output on the hook path: the marker carries a content-addressed
// retrieve handle instead, identical across styles. File-read style variants
// are covered at the engine level (test/engine/marker-styles.test.ts).
test('bash output gets a CCR retrieve marker by default (CCR on)', () => {
  const out = handleCopilotPostToolUse(
    copilotPayload('bash', { command: 'cargo build 2>&1' }, distinctLog(600)),
    'slim',
  ).output;
  assert.ok(out !== null, 'expected non-null output');
  const replaced = (JSON.parse(out) as CopilotResponse).modifiedResult.textResultForLlm;
  assert.match(replaced, /— retrieve: compressor retrieve [A-Za-z0-9_-]{16}\]/);
  assert.ok(!replaced.includes('⟦ccr:'), 'no raw placeholder leaked');
  assert.ok(!replaced.includes('likely irrelevant'));
});

test('marker style no longer changes the bash recovery clause (CCR supersedes it)', () => {
  const out = handleCopilotPostToolUse(
    copilotPayload('bash', { command: 'cargo build 2>&1' }, distinctLog(600)),
    'slim',
    'deterrent',
  ).output;
  assert.ok(out !== null, 'expected non-null output');
  const replaced = (JSON.parse(out) as CopilotResponse).modifiedResult.textResultForLlm;
  assert.ok(!replaced.includes('likely irrelevant'), 'no style prose on the CCR path');
  assert.match(replaced, /— retrieve: compressor retrieve [A-Za-z0-9_-]{16}\]/);
});

// CCR passthrough guard (§3): the output of a `compressor retrieve` command is
// an exact original slice the model deliberately pulled back; re-compressing it
// would re-cut and re-stash what was just retrieved. Copilot sniffs the command
// out of toolArgs, which the CLI docs send as a JSON-ENCODED STRING — a code
// path distinct from post-tool-use/opencode, hence its own guard test. Mirrors
// those guards: null for a retrieve command, non-null for a control command
// over the same large output, in BOTH the object and the wire (string) form.
test('copilot guard: a `compressor retrieve` bash output passes through uncompressed', () => {
  const big = distinctLog(600);
  // object-form toolArgs
  assert.equal(
    handleCopilotPostToolUse(
      copilotPayload('bash', { command: 'compressor retrieve AbCdEf0123456789' }, big),
      'slim',
    ).output,
    null,
    'retrieved output (object toolArgs) is passed through, not compressed',
  );
  // JSON-encoded-string toolArgs (the documented wire format)
  assert.equal(
    handleCopilotPostToolUse(
      copilotPayload('bash', JSON.stringify({ command: 'compressor retrieve AbCdEf0123456789' }), big),
      'slim',
    ).output,
    null,
    'retrieved output (string toolArgs) is passed through too',
  );
  // control: the SAME large output under a non-retrieve command DOES compress
  const control = handleCopilotPostToolUse(
    copilotPayload('bash', { command: 'cat huge.log' }, big),
    'slim',
  ).output;
  assert.ok(control !== null, 'control output compresses (guard is command-specific)');
});
