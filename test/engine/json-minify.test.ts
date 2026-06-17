import test from 'node:test';
import assert from 'node:assert/strict';
import { minifyJson, minifyJsonText } from '../../src/engine/tiers/json.ts';
import { detectKind } from '../../src/engine/detect.ts';

// LOSSLESS property: the emitted text must parse equal to the original, and
// every number/string TOKEN must survive byte-exact. minifyJsonText only
// removes inter-token whitespace; minifyJson adds the parse-equality safety net
// and fails open (null) on anything it cannot prove lossless.

/** Assert minifyJson is lossless: shorter, parses, and is semantically equal. */
function assertLossless(pretty: string): string {
  const r = minifyJson(pretty);
  assert.ok(r !== null, 'expected a tier result (lossless + shorter)');
  assert.equal(r.transform?.id, 'json-minify');
  assert.equal(r.transform?.charsSaved, pretty.length - r.content.length);
  assert.ok(r.content.length < pretty.length, 'minified is shorter');
  // parse-equal
  assert.deepEqual(JSON.parse(r.content), JSON.parse(pretty));
  return r.content;
}

test('pretty object: whitespace outside strings is stripped, structure preserved', () => {
  const pretty = JSON.stringify({ a: 1, b: { c: [1, 2, 3] }, d: 'x' }, null, 2);
  const min = assertLossless(pretty);
  assert.equal(min, '{"a":1,"b":{"c":[1,2,3]},"d":"x"}');
});

test('pretty array minifies losslessly', () => {
  const pretty = JSON.stringify([{ n: 1 }, { n: 2 }, { n: 3 }], null, 4);
  const min = assertLossless(pretty);
  assert.equal(min, '[{"n":1},{"n":2},{"n":3}]');
});

test('strings containing structural chars and significant whitespace are untouched', () => {
  // The string VALUES carry {, }, :, ,, leading/trailing/inner spaces, tabs and
  // newlines — none of which are whitespace BETWEEN tokens, so all survive.
  const obj = {
    a: '{ "nested": [1, 2] } : , end',
    b: '  keep  these   spaces  ',
    c: 'tab\tand\nnewline kept',
  };
  const pretty = JSON.stringify(obj, null, 2);
  const min = minifyJson(pretty);
  assert.ok(min !== null);
  assert.deepEqual(JSON.parse(min.content), obj);
  // every original string value re-appears byte-exact (its JSON encoding) in the
  // minified output
  for (const value of Object.values(obj)) {
    assert.ok(min.content.includes(JSON.stringify(value)), `value preserved: ${value}`);
  }
});

test('escaped quotes and backslashes inside strings do not desync the scanner', () => {
  const obj = { s: 'he said \\"hi\\" and a path C:\\\\x', e: '\\" : , } { not structural' };
  const pretty = JSON.stringify(obj, null, 2);
  const min = minifyJson(pretty);
  assert.ok(min !== null);
  assert.deepEqual(JSON.parse(min.content), obj);
});

test('unicode in strings is preserved', () => {
  const obj = { emoji: '✓ ✗ → 漢字 café', escaped: 'line1 line2' };
  const pretty = JSON.stringify(obj, null, 2);
  const min = minifyJson(pretty);
  assert.ok(min !== null);
  assert.deepEqual(JSON.parse(min.content), obj);
});

test('number edge-case TOKENS are emitted byte-exact (no parse/stringify round-trip)', () => {
  // Hand-built so the literal NUMBER TOKENS (big int beyond 2^53, exponent
  // forms, trailing zero, -0, negatives) survive in the EMITTED text — a
  // JSON.parse→stringify would rewrite every one of these.
  const pretty = `{
    "bigint": 12345678901234567890,
    "exp": 1e10,
    "trailing": 1.0,
    "negzero": -0,
    "neg": -42,
    "expSigned": 6.022e-23,
    "leadingExp": 1.5E+3
  }`;
  const min = minifyJson(pretty);
  assert.ok(min !== null, 'big-int / exponent JSON still minifies');
  for (const token of ['12345678901234567890', '1e10', '1.0', '-0', '-42', '6.022e-23', '1.5E+3']) {
    assert.ok(min.content.includes(token), `number token byte-exact in output: ${token}`);
  }
  // and it parses to the same VALUES (the safety net already guaranteed this)
  assert.deepEqual(JSON.parse(min.content), JSON.parse(pretty));
});

test('idempotency: minify ∘ minify === minify', () => {
  const pretty = JSON.stringify({ a: [1, 2, 3], b: { c: 'd e f' } }, null, 2);
  const once = minifyJson(pretty);
  assert.ok(once !== null);
  // already-minified text has no gain → null (fail-open no-op)
  const twice = minifyJson(once.content);
  assert.equal(twice, null, 'already-dense JSON yields no further gain');
});

test('minifyJsonText alone is idempotent', () => {
  const pretty = JSON.stringify({ a: [1, 2], b: 'x y' }, null, 2);
  const m1 = minifyJsonText(pretty);
  const m2 = minifyJsonText(m1);
  assert.equal(m1, m2);
});

test('non-JSON input fails open (null)', () => {
  // a log line with braces
  assert.equal(minifyJson('warning: unused { x } in src/lib.rs:42'), null);
  // truncated / invalid JSON
  assert.equal(minifyJson('{"a": 1, "b": [1, 2,'), null);
  assert.equal(minifyJson('{ not json at all }'), null);
  // empty / whitespace
  assert.equal(minifyJson('   '), null);
  // JSONL (two objects, not one document)
  assert.equal(minifyJson('{"a":1}\n{"b":2}'), null);
});

test('a deliberately corrupting fake would fail the safety net (fail-open)', () => {
  // Construct input the safety net must reject: text that parses but whose
  // whitespace strip would change a VALUE is impossible via minifyJsonText
  // (it never touches in-string bytes). To exercise the net directly, feed a
  // value where the minified candidate is shorter yet NOT equal — simulated by
  // trailing garbage after a valid value: JSON.parse(original) throws, so null.
  assert.equal(minifyJson('[1, 2, 3] trailing-garbage'), null);
  // a document that is only whitespace-with-braces but invalid
  assert.equal(minifyJson('{,}'), null);
});

test('detectKind returns json for valid JSON documents', () => {
  assert.equal(detectKind(JSON.stringify({ a: 1, b: [1, 2] }, null, 2)), 'json');
  assert.equal(detectKind('  [1, 2, 3]  '), 'json');
  assert.equal(detectKind('{"error": "boom", "code": 500}'), 'json');
});

test('detectKind does NOT classify json-shaped prose or JSONL-with-garbage as json', () => {
  // prose that merely starts with a brace
  assert.equal(detectKind('{ this is not json, just braces in prose }'), 'generic');
  // JSONL: valid lines but not one document
  assert.notEqual(detectKind('{"a":1}\n{"b":2}'), 'json');
  // valid JSON followed by trailing garbage
  assert.notEqual(detectKind('[1,2,3] then some log text'), 'json');
  // a build-log that does not start with a brace stays build-log
  assert.equal(detectKind('error[E0308]: mismatched types'), 'build-log');
});

test('a JSON payload containing the word "error" is json, not build-log', () => {
  const payload = JSON.stringify(
    { status: 'error', message: 'npm ERR! something', errors: [{ code: 'E0308' }] },
    null,
    2,
  );
  assert.equal(detectKind(payload), 'json');
});
