import test from 'node:test';
import assert from 'node:assert/strict';
import { filterBuildLog, filterTestLog } from '../../src/engine/tiers/logs.ts';

const JEST_LOG = [
  'PASS src/math.test.ts',
  '  ✓ adds numbers (2 ms)',
  '  ✓ subtracts numbers (1 ms)',
  'FAIL src/string.test.ts',
  '  ✗ trims whitespace',
  '  ● trims whitespace',
  '',
  '    expect(received).toBe(expected)',
  '',
  '    Expected: "abc"',
  '    Received: " abc"',
  '',
  '      at Object.<anonymous> (src/string.test.ts:5:20)',
  '',
  'Tests:       1 failed, 2 passed, 3 total',
  'Time:        0.5 s',
].join('\n');

test('filterTestLog keeps jest failures and summary, drops passes', () => {
  const result = filterTestLog(JEST_LOG);
  assert.ok(result.content.includes('FAIL src/string.test.ts'));
  assert.ok(result.content.includes('✗ trims whitespace'));
  assert.ok(result.content.includes('Expected: "abc"'));
  assert.ok(result.content.includes('at Object.<anonymous> (src/string.test.ts:5:20)'));
  assert.ok(result.content.includes('Tests:       1 failed, 2 passed, 3 total'));
  assert.ok(!result.content.includes('✓ adds numbers'));
  assert.ok(!result.content.includes('PASS src/math.test.ts'));
  assert.ok(result.content.includes('[compressor: 3 passing-test lines omitted]'));
  assert.equal(result.transform?.id, 'log-filter');
});

const CARGO_LOG = [
  'running 4 tests',
  'test tests::add_works ... ok',
  'test tests::sub_works ... ok',
  'test tests::mul_works ... ok',
  'test tests::div_breaks ... FAILED',
  '',
  'failures:',
  '',
  '---- tests::div_breaks stdout ----',
  "thread 'tests::div_breaks' panicked at 'attempt to divide by zero', src/lib.rs:42:9",
  '',
  'failures:',
  '    tests::div_breaks',
  '',
  'test result: FAILED. 3 passed; 1 failed; 0 ignored',
].join('\n');

test('filterTestLog keeps cargo failures and result line, drops ok lines', () => {
  const result = filterTestLog(CARGO_LOG);
  assert.ok(result.content.includes('test tests::div_breaks ... FAILED'));
  assert.ok(result.content.includes('panicked at'));
  assert.ok(result.content.includes('test result: FAILED. 3 passed; 1 failed; 0 ignored'));
  assert.ok(!result.content.includes('add_works'));
  assert.ok(!result.content.includes('sub_works'));
  assert.ok(result.content.includes('[compressor: 3 passing-test lines omitted]'));
});

test('filterTestLog never drops unrecognized content', () => {
  const input = 'hello there\nsome output lines\nnothing test-like at all';
  const result = filterTestLog(input);
  assert.equal(result.content, input);
  assert.equal(result.transform, undefined);
});

test('filterTestLog leaves checkmark checklists with prose error mentions intact', () => {
  const input = [
    '# Feature checklist',
    ...Array.from({ length: 5 }, (_, i) => `✓ Feature ${i}: done`),
    'Note: error handling for feature 12 is still pending review',
  ].join('\n');
  const result = filterTestLog(input);
  assert.equal(result.content, input);
  assert.equal(result.transform, undefined);
});

test('filterTestLog still keeps error-report lines as failures', () => {
  const input = ['✓ works', 'Error: boom at startup', 'Tests: 1 passed, 1 total'].join('\n');
  const result = filterTestLog(input);
  assert.ok(result.content.includes('Error: boom at startup'));
  assert.ok(result.content.includes('Tests: 1 passed, 1 total'));
  assert.ok(!result.content.includes('✓ works'));
  assert.ok(result.content.includes('[compressor: 1 passing-test lines omitted]'));
});

const CARGO_BUILD_LOG = [
  '   Compiling proc-macro2 v1.0.86',
  '   Compiling quote v1.0.36',
  '   Compiling compressor v0.1.0 (/work/compressor)',
  'error[E0308]: mismatched types',
  ' --> src/main.rs:2:13',
  '  |',
  '2 |     let x: u32 = "hello";',
  '  |            ---   ^^^^^^^ expected `u32`, found `&str`',
  '',
  'some unrelated progress noise',
  'error: could not compile `compressor` (bin "compressor") due to 1 previous error',
].join('\n');

test('filterBuildLog keeps error blocks and final status, drops progress noise', () => {
  const result = filterBuildLog(CARGO_BUILD_LOG);
  assert.ok(result.content.includes('error[E0308]: mismatched types'));
  assert.ok(result.content.includes('--> src/main.rs:2:13'));
  assert.ok(result.content.includes('expected `u32`, found `&str`'));
  assert.ok(result.content.includes('error: could not compile'));
  assert.ok(!result.content.includes('Compiling proc-macro2'));
  assert.ok(!result.content.includes('unrelated progress noise'));
  assert.match(result.content, /\[compressor: \d+ build-log lines omitted\]/);
  assert.equal(result.transform?.id, 'log-filter');
});

test('filterBuildLog keeps tsc error lines', () => {
  const input = [
    'npm run build output',
    "src/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    'Found 1 error.',
  ].join('\n');
  const result = filterBuildLog(input);
  assert.ok(result.content.includes('error TS2322'));
  assert.ok(result.content.includes('Found 1 error.'));
  assert.ok(!result.content.includes('npm run build output'));
});

test('filterBuildLog never drops unrecognized content', () => {
  const input = 'building things\nall done\neverything fine';
  const result = filterBuildLog(input);
  assert.equal(result.content, input);
  assert.equal(result.transform, undefined);
});
