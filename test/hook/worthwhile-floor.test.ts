import test from 'node:test';
import assert from 'node:assert/strict';
import { compressCall } from '../../src/hook/core.ts';
import type { CompressibleCall } from '../../src/hook/core.ts';
import type { MarkerStyle } from '../../src/engine/types.ts';

// Regression: the hook's "worthwhile" floor (200 chars / 10%) must be
// computed on MARKER-STRIPPED output. The marker text is the marker-style
// experiment's treatment — informative/deterrent markers are ~50-120 chars
// longer than plain — so a marker-INCLUSIVE `saved` lets arms near a floor
// flip between compressed and full passthrough: the plain arm clears the
// floor while informative/deterrent receive the original uncompressed output
// (worthwhile=false), and the arms then differ in WHAT the model sees, not
// just marker phrasing. The engine-level invariant (marker-styles.test.ts,
// byte-identical sans markers) cannot catch this — the floor lives in the
// hook layer above compress().

const STYLES: readonly MarkerStyle[] = ['plain', 'deterrent', 'informative'];

function numbered(line: number, text: string): string {
  return `${String(line).padStart(5, ' ')}→${text}`;
}

/**
 * Numbered TS file (optimized-mode comment-strip path: one style-bearing
 * marker, savings proportional to the comment count). 320 distinct code
 * lines (~14.4k chars) clear the touch and comment-strip thresholds while
 * staying under the truncate budget; short distinct comment lines give the
 * sweep fine granularity around the 10% ratio floor.
 */
function tsFileWithComments(commentLines: number): string {
  const lines: string[] = [];
  let n = 1;
  for (let i = 0; i < 320; i += 1) {
    lines.push(numbered(n++, `const value${i} = compute(${i}) + offset${i % 7};`));
  }
  for (let c = 0; c < commentLines; c += 1) {
    lines.push(numbered(n++, `// n${c}`));
  }
  return lines.join('\n');
}

function callFor(content: string): CompressibleCall {
  return { toolKind: 'read', filePath: '/tmp/sweep.ts', targeted: false, text: content };
}

test('worthwhile floor is style-invariant across the savings boundary (sweep)', () => {
  let sawWorthwhile = false;
  let sawNotWorthwhile = false;

  // sweep the comment count across the 10% ratio floor: each step moves the
  // content savings by ~12 chars while the plain↔informative marker-length
  // delta is ~50-60 chars, so a marker-inclusive floor MUST flip styles
  // apart somewhere in this range
  for (let comments = 90; comments <= 190; comments += 1) {
    const content = tsFileWithComments(comments);
    const results = STYLES.map((style) => compressCall(callFor(content), 'optimized', style));
    const [plain, deterrent, informative] = results;
    assert.ok(plain && deterrent && informative);

    assert.equal(
      deterrent.worthwhile,
      plain.worthwhile,
      `comments=${comments}: deterrent flipped (plain=${plain.worthwhile})`,
    );
    assert.equal(
      informative.worthwhile,
      plain.worthwhile,
      `comments=${comments}: informative flipped (plain=${plain.worthwhile})`,
    );

    if (plain.worthwhile) {
      sawWorthwhile = true;
      // treatment present when worthwhile: marker phrasing differs per style
      assert.ok(plain.text.includes('[compressor:'), `comments=${comments}: marker missing`);
      assert.notEqual(deterrent.text, plain.text, `comments=${comments}: same marker text`);
      assert.notEqual(informative.text, plain.text, `comments=${comments}: same marker text`);
    } else {
      sawNotWorthwhile = true;
      assert.equal(plain.text, content, 'below-floor returns the original text');
    }
  }

  // the sweep must actually bracket the floor, otherwise it proves nothing
  assert.ok(sawWorthwhile, 'sweep never crossed into worthwhile territory');
  assert.ok(sawNotWorthwhile, 'sweep never crossed below the floor');
});
