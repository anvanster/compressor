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

// --- regression: loose begin-prefix matching swallowed user content ---

test('prose line that merely starts with the begin prefix is not a boundary', () => {
  const prose = '<!-- compressor:begin marker is documented below -->';
  const doc = [prose, 'Important user paragraph A', '', sectionSlim, '', 'tail', ''].join('\n');
  // remove deletes ONLY the real section — prose line and user content survive
  assert.equal(
    removeMarkedSection(doc),
    `${prose}\nImportant user paragraph A\n\ntail\n`,
  );
  // upsert replaces the real section in place, not from the prose line
  const upserted = upsertMarkedSection(doc, sectionOptimized);
  assert.equal(
    upserted,
    [prose, 'Important user paragraph A', '', sectionOptimized, '', 'tail', ''].join('\n'),
  );
  // a document with ONLY the prose line has no section at all
  assert.equal(readMarkedSection(`${prose}\nuser text\n`), null);
});

test('orphan begin (end hand-deleted) never pairs with a later end', () => {
  const orphanDoc = [
    markerBegin('slim'),
    'Important user paragraph A',
    'Important user paragraph B',
    '',
  ].join('\n');
  // an orphan begin is not a section
  assert.equal(readMarkedSection(orphanDoc), null);
  assert.equal(removeMarkedSection(orphanDoc), orphanDoc);

  // install appends a fresh section; the orphan must not capture its end
  const once = upsertMarkedSection(orphanDoc, sectionSlim);
  assert.ok(once.includes('Important user paragraph A'));
  assert.equal(upsertMarkedSection(once, sectionSlim), once); // idempotent

  // uninstall removes only the appended section; user paragraphs survive
  const removed = removeMarkedSection(once);
  assert.ok(removed.includes('Important user paragraph A'));
  assert.ok(removed.includes('Important user paragraph B'));
  assert.ok(!removed.includes(MARKER_END));
});

// --- regression: markers in 4-space indented code blocks were treated as real ---

const indentedExample = [
  '# My project',
  '',
  'Compressor markers look like this:',
  '',
  `    ${markerBegin('slim')}`,
  '    user example body',
  `    ${MARKER_END}`,
  '',
  'Tail text.',
  '',
].join('\n');

test('markers in indented code blocks are examples, not boundaries', () => {
  assert.equal(readMarkedSection(indentedExample), null);
  assert.equal(removeMarkedSection(indentedExample), indentedExample);
  const withSection = upsertMarkedSection(indentedExample, sectionOptimized);
  assert.ok(withSection.includes('    user example body'), 'example preserved');
  assert.equal(readMarkedSection(withSection), sectionOptimized);
  assert.equal(removeMarkedSection(withSection), indentedExample);
});

// --- regression: ``` inside an open ~~~ block desynced fence tracking ---

test('a ``` line inside an open ~~~ block is literal text, not a fence toggle', () => {
  const doc = [
    '~~~markdown',
    'Nested example:',
    '```',
    markerBegin('slim'),
    'fenced user line',
    MARKER_END,
    '```',
    '~~~',
    '',
  ].join('\n');
  // documented markers inside the ~~~ block are never matched
  assert.equal(readMarkedSection(doc), null);
  assert.equal(removeMarkedSection(doc), doc);

  // and a REAL section after the closed block is still found (no inverse desync)
  const withReal = upsertMarkedSection(doc, sectionSlim);
  assert.equal(withReal, `${doc.replace(/\n+$/u, '')}\n\n${sectionSlim}\n`);
  assert.equal(readMarkedSection(withReal), sectionSlim);
  assert.equal(upsertMarkedSection(withReal, sectionSlim), withReal);
  assert.equal(removeMarkedSection(withReal), doc);
});

// --- regression: unclosed fence at EOF stranded our section forever ---

test('unclosed fence at EOF: upsert stays idempotent and the section stays removable', () => {
  const doc = '# Notes\n\n```\ncode never closed\n';
  const once = upsertMarkedSection(doc, sectionSlim);
  assert.equal(upsertMarkedSection(once, sectionSlim), once); // no duplicates
  assert.equal(readMarkedSection(once), sectionSlim); // not stranded
  assert.equal(removeMarkedSection(once), doc); // removal path exists
});

// --- regression: whitespace-only residue was collapsed to '' on removal ---

test('remove preserves whitespace-only residue byte-for-byte', () => {
  const original = ' \n';
  const withSection = upsertMarkedSection(original, sectionSlim);
  assert.equal(removeMarkedSection(withSection), original);
});
