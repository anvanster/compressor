import test from 'node:test';
import assert from 'node:assert/strict';
import { renderChanges } from '../../src/adapters/apply.ts';
import type { FileChange } from '../../src/adapters/types.ts';

// Regression (minor): --dry-run printed only `create path (+N/-0)` for new
// files — no body at all, yet the body IS what the user is approving. Small
// creations print the full body indented two spaces; long ones are capped at
// the first 40 lines plus a remainder count. Updates and deletes unchanged.

test('renderChanges prints the full body of a small created file, indented two spaces', () => {
  const change: FileChange = {
    path: '/tmp/proj/.github/hooks/compressor.json',
    before: null,
    after: '{\n  "version": 1\n}\n',
  };
  const lines = renderChanges([change]).split('\n');
  assert.equal(lines[0], 'create /tmp/proj/.github/hooks/compressor.json (+3/-0)');
  assert.deepEqual(lines.slice(1), ['  {', '    "version": 1', '  }']);
});

test('renderChanges caps a 200-line created body at 40 lines plus the remainder count', () => {
  const body = `${Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n')}\n`;
  const change: FileChange = { path: '/tmp/proj/big.md', before: null, after: body };
  const lines = renderChanges([change]).split('\n');
  assert.equal(lines[0], 'create /tmp/proj/big.md (+200/-0)');
  assert.equal(lines.length, 42, 'header + 40 body lines + cap line');
  assert.equal(lines[1], '  line 1');
  assert.equal(lines[40], '  line 40');
  assert.equal(lines[41], '  … (160 more lines)');
  assert.ok(!lines.includes('  line 41'), 'nothing beyond the head is printed');
});

test('renderChanges deletes stay summary-only', () => {
  const change: FileChange = { path: '/tmp/proj/old.md', before: 'a\nb\n', after: null };
  assert.equal(renderChanges([change]), 'delete /tmp/proj/old.md (+0/-2)');
});

test('renderChanges updates keep the contextual diff form (no full-body dump)', () => {
  const change: FileChange = {
    path: '/tmp/proj/notes.md',
    before: 'one\ntwo\nthree\n',
    after: 'one\nTWO\nthree\n',
  };
  const lines = renderChanges([change]).split('\n');
  assert.equal(lines[0], 'update /tmp/proj/notes.md (+1/-1)');
  assert.deepEqual(lines.slice(1), ['  one', '- two', '+ TWO', '  three']);
});
