import test from 'node:test';
import assert from 'node:assert/strict';
import { detectKind } from '../../src/engine/detect.ts';

test('code by file extension', () => {
  assert.equal(detectKind('whatever', 'src/foo.rs'), 'code');
  assert.equal(detectKind('whatever', '/abs/path/bar.ts'), 'code');
  assert.equal(detectKind('whatever', 'config.yaml'), 'code');
});

test('extension wins over log-looking content', () => {
  const content = 'PASS something\nFAIL other\nTests: 2 total';
  assert.equal(detectKind(content, 'src/runner.ts'), 'code');
});

test('code by shebang', () => {
  assert.equal(detectKind('#!/bin/bash\necho hi'), 'code');
});

test('jest output is test-log', () => {
  assert.equal(detectKind('PASS src/a.test.ts\n  ✓ works (2 ms)\nTests: 1 passed, 1 total'), 'test-log');
});

test('cargo test output is test-log', () => {
  assert.equal(detectKind('running 1 test\ntest tests::works ... ok\n\ntest result: ok. 1 passed; 0 failed'), 'test-log');
});

test('go test output is test-log', () => {
  assert.equal(detectKind('--- FAIL: TestThing (0.00s)\nFAIL\nexit status 1'), 'test-log');
});

test('node:test spec/tap output is test-log', () => {
  const spec = [
    '▶ zone quotes',
    '  ✔ quote batch 1 (0.4ms)',
    '  ✖ letter rate holds (0.4ms)',
    'ℹ tests 121',
    'ℹ pass 118',
    'ℹ fail 3',
  ].join('\n');
  assert.equal(detectKind(spec), 'test-log');
  const tap = ['ok 1 - adds', 'not ok 2 - subtracts', '# tests 2', '# pass 1', '# fail 1'].join('\n');
  assert.equal(detectKind(tap), 'test-log');
  // a markdown heading like '# pass' without a counter is NOT a runner summary
  assert.equal(detectKind('# pass the salt\nplease and thank you'), 'generic');
});

test('rustc errors are build-log', () => {
  assert.equal(detectKind('error[E0308]: mismatched types\n --> src/main.rs:2:13'), 'build-log');
});

test('tsc errors are build-log', () => {
  assert.equal(detectKind("error TS2322: Type 'string' is not assignable to type 'number'."), 'build-log');
});

test('npm errors are build-log', () => {
  assert.equal(detectKind('npm ERR! code ELIFECYCLE\nnpm ERR! errno 1'), 'build-log');
});

test('stack frames alone are generic, with error context build-log', () => {
  assert.equal(detectKind('    at fn (src/a.ts:3:4)\n    at run (src/b.ts:9:1)'), 'generic');
  assert.equal(detectKind('Error: boom\n    at fn (src/a.ts:3:4)'), 'build-log');
});

test('plain prose is generic', () => {
  assert.equal(detectKind('hello there\nthis is some output\nnothing special'), 'generic');
});

test('checkmark bullets alone are generic (docs/checklists), not test-log', () => {
  const checklist = [
    '# Feature checklist',
    '✓ Feature 1: shipped',
    '✓ Feature 2: shipped',
    'Note: error handling for feature 12 is still pending review',
  ].join('\n');
  assert.equal(detectKind(checklist), 'generic');
});

test('checkmarks plus a runner summary are still test-log', () => {
  const mocha = ['  ✓ adds numbers', '  ✓ subtracts numbers', '  2 passing (10ms)'].join('\n');
  assert.equal(detectKind(mocha), 'test-log');
  const vitest = ['✓ src/a.test.ts (3)', 'Tests: 3 passed, 3 total'].join('\n');
  assert.equal(detectKind(vitest), 'test-log');
});
