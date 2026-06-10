import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markerBegin, MARKER_END } from '../../src/packs/render.ts';
import {
  readMarkedSection,
  removeMarkedSection,
  upsertMarkedSection,
} from '../../src/adapters/markers.ts';

const sectionSlim = [
  markerBegin('slim'),
  '<!-- atoms: out.a,beh.b -->',
  '## Response & context discipline (compressor)',
  '- be terse',
  MARKER_END,
].join('\n');

const sectionOptimized = [
  markerBegin('optimized'),
  '<!-- atoms: out.a -->',
  '## Response & context discipline (compressor)',
  '- answer first',
  MARKER_END,
].join('\n');

test('upsert into null yields section with trailing newline', () => {
  assert.equal(upsertMarkedSection(null, sectionSlim), `${sectionSlim}\n`);
});

test('upsert appends to fresh file with exactly one blank line', () => {
  const existing = '# My project\n\nUser notes.\n';
  const result = upsertMarkedSection(existing, sectionSlim);
  assert.equal(result, `# My project\n\nUser notes.\n\n${sectionSlim}\n`);
});

test('upsert appends to file lacking trailing newline', () => {
  const result = upsertMarkedSection('text without newline', sectionSlim);
  assert.equal(result, `text without newline\n\n${sectionSlim}\n`);
});

test('upsert replaces existing section without duplication', () => {
  const existing = `# Top\n\n${sectionSlim}\n`;
  const result = upsertMarkedSection(existing, sectionOptimized);
  assert.equal(result, `# Top\n\n${sectionOptimized}\n`);
  assert.ok(!result.includes('mode=slim'));
  assert.equal(result.split(MARKER_END).length, 2);
});

test('upsert preserves bytes outside markers (content both sides)', () => {
  const existing = `# Top\nline two\n\n${sectionSlim}\n\n## Bottom\ntail text\n`;
  const result = upsertMarkedSection(existing, sectionOptimized);
  assert.equal(result, `# Top\nline two\n\n${sectionOptimized}\n\n## Bottom\ntail text\n`);
});

test('upsert is idempotent', () => {
  const once = upsertMarkedSection('user content\n', sectionSlim);
  const twice = upsertMarkedSection(once, sectionSlim);
  assert.equal(twice, once);
});

test('remove round-trips to original', () => {
  const original = '# Project notes\n\nUser content here.\n\n## More\ntext\n';
  const withSection = upsertMarkedSection(original, sectionSlim);
  assert.equal(removeMarkedSection(withSection), original);
});

test('remove collapses to empty string when only our section existed', () => {
  const onlySection = upsertMarkedSection(null, sectionSlim);
  assert.equal(removeMarkedSection(onlySection), '');
});

test('remove with content after the section strips the separating blank line', () => {
  const doc = `${sectionSlim}\n\n## User stuff\nbody\n`;
  assert.equal(removeMarkedSection(doc), '## User stuff\nbody\n');
});

test('remove without a section returns input unchanged', () => {
  const doc = '# Nothing of ours\n';
  assert.equal(removeMarkedSection(doc), doc);
});

test('readMarkedSection returns exact section or null', () => {
  const doc = `intro\n\n${sectionSlim}\n\noutro\n`;
  assert.equal(readMarkedSection(doc), sectionSlim);
  assert.equal(readMarkedSection('no markers here\n'), null);
});

const fencedExample = [
  '# My project',
  '',
  'Compressor markers look like this:',
  '',
  '```markdown',
  markerBegin('slim'),
  'example body',
  MARKER_END,
  '```',
  '',
  'Tail text.',
  '',
].join('\n');

test('upsert ignores markers inside code fences and appends a real section', () => {
  const result = upsertMarkedSection(fencedExample, sectionOptimized);
  assert.ok(result.includes('example body'), 'fenced example preserved');
  assert.equal(
    result,
    `${fencedExample.replace(/\n+$/u, '')}\n\n${sectionOptimized}\n`,
  );
});

test('remove ignores fenced examples and only removes the real section', () => {
  const withSection = upsertMarkedSection(fencedExample, sectionOptimized);
  assert.equal(removeMarkedSection(withSection), fencedExample);
  // a document with ONLY a fenced example is untouched
  assert.equal(removeMarkedSection(fencedExample), fencedExample);
});

test('readMarkedSection ignores fenced examples', () => {
  assert.equal(readMarkedSection(fencedExample), null);
  const withSection = upsertMarkedSection(fencedExample, sectionOptimized);
  assert.equal(readMarkedSection(withSection), sectionOptimized);
});
