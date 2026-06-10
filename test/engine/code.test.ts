import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasLineNumbers,
  langFromPath,
  skeleton,
  stripComments,
} from '../../src/engine/tiers/code.ts';
import type { CompressMeta } from '../../src/engine/types.ts';

const estimate = (s: string): number => Math.ceil(s.length / 4);

function numbered(lines: string[]): string {
  return lines.map((text, i) => `${String(i + 1).padStart(6)}→${text}`).join('\n');
}

test('hasLineNumbers recognizes arrow-prefixed Read output', () => {
  assert.equal(hasLineNumbers(numbered(['const x = 1;', 'export { x };'])), true);
  assert.equal(hasLineNumbers('     1\tconst x = 1;\n     2\texport { x };'), true);
});

test('hasLineNumbers rejects plain code', () => {
  assert.equal(hasLineNumbers('const x = 1;\nexport { x };'), false);
  assert.equal(hasLineNumbers('     1→numbered\nplain line'), false);
});

test('langFromPath maps extensions', () => {
  assert.equal(langFromPath('a/b.ts'), 'ts-js');
  assert.equal(langFromPath('lib.rs'), 'rust');
  assert.equal(langFromPath('app.py'), 'python');
  assert.equal(langFromPath('main.go'), 'go');
  assert.equal(langFromPath('notes.md'), undefined);
  assert.equal(langFromPath(undefined), undefined);
});

test('stripComments on numbered TS keeps retained lines verbatim with numbers', () => {
  const input = numbered([
    "import { a } from './a.ts';",
    '// explains the constant',
    '',
    'const x = a + 1;',
    '/* block comment',
    '   continues here',
    '*/',
    'export { x };',
  ]);
  const result = stripComments(input, 'ts-js');
  const outLines = result.content.split('\n');
  assert.deepEqual(outLines, [
    `${String(1).padStart(6)}→import { a } from './a.ts';`,
    `${String(4).padStart(6)}→const x = a + 1;`,
    `${String(8).padStart(6)}→export { x };`,
    '[compressor: 5 comment/blank lines stripped — line numbers preserved]',
  ]);
  assert.equal(result.transform?.id, 'comment-strip');
});

test('stripComments leaves unnumbered content untouched', () => {
  const input = "// comment\nconst x = 1;\n\nexport { x };";
  const result = stripComments(input, 'ts-js');
  assert.equal(result.content, input);
  assert.equal(result.transform, undefined);
});

test('stripComments with unknown lang is a no-op', () => {
  const input = numbered(['// comment', 'const x = 1;']);
  assert.equal(stripComments(input, undefined).content, input);
});

test('stripComments handles hash comments for python', () => {
  const input = numbered(['#!/usr/bin/env python3', '# setup', 'x = 1', '', 'print(x)']);
  const result = stripComments(input, 'python');
  const outLines = result.content.split('\n');
  assert.ok(outLines.includes(`${String(1).padStart(6)}→#!/usr/bin/env python3`), 'shebang kept');
  assert.ok(outLines.includes(`${String(3).padStart(6)}→x = 1`));
  assert.ok(!outLines.some((l) => l.includes('# setup')));
  assert.ok(outLines.includes('[compressor: 2 comment/blank lines stripped — line numbers preserved]'));
});

test('stripComments never strips config: yaml block-scalar "#" lines are data', () => {
  const input = numbered([
    'release_notes: |',
    '  # v2.0 Highlights',
    '  - new engine',
    '  # Breaking changes',
    '  - removed legacy API',
  ]);
  const result = stripComments(input, 'config');
  assert.equal(result.content, input);
  assert.equal(result.transform, undefined);
});

test('stripComments keeps python "#" and blank lines inside triple-quoted strings', () => {
  const input = numbered([
    'TEMPLATE = """',
    '# Heading from the template',
    '',
    'body text',
    '"""',
    '# real comment',
    'x = 1',
  ]);
  const result = stripComments(input, 'python');
  assert.ok(result.content.includes('# Heading from the template'), 'string content kept');
  assert.ok(result.content.includes(`${String(3).padStart(6)}→`), 'blank line inside string kept');
  assert.ok(result.content.includes('body text'));
  assert.ok(!result.content.includes('# real comment'), 'real comment stripped');
  assert.ok(result.content.includes('x = 1'));
  assert.equal(result.transform?.id, 'comment-strip');
});

test('skeleton keeps imports and signatures, collapses bodies with line-accurate markers', () => {
  const input = numbered([
    "import { a } from './a.ts';",
    '',
    'export function one(x: number): number {',
    '  return x + 1;',
    '}',
    '',
    'export class Box {',
    '  value = 1;',
    '}',
  ]);
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: 'src/big.ts' };
  const result = skeleton(input, 'ts-js', meta, estimate);

  assert.ok(result.content.includes(`${String(1).padStart(6)}→import { a } from './a.ts';`));
  assert.ok(result.content.includes(`${String(3).padStart(6)}→export function one(x: number): number {`));
  assert.ok(result.content.includes(`${String(7).padStart(6)}→export class Box {`));
  assert.ok(!result.content.includes('return x + 1;'));
  // line 6 is a numbered blank line, so it joins the 4-6 gap
  assert.match(result.content, /\[compressor: lines 4-6 omitted \(~\d+ est tokens\) — Read src\/big\.ts with offset=4 and limit=3 to retrieve\]/);
  assert.match(result.content, /\[compressor: lines 8-9 omitted \(~\d+ est tokens\) — Read src\/big\.ts with offset=8 and limit=2 to retrieve\]/);
  assert.equal(result.transform?.id, 'skeleton');
});

test('skeleton is a no-op on unnumbered content', () => {
  const input = 'export function one(): void {\n  return;\n}';
  const meta: CompressMeta = { tool: 'read', mode: 'slim', filePath: 'a.ts' };
  assert.equal(skeleton(input, 'ts-js', meta, estimate).content, input);
});
