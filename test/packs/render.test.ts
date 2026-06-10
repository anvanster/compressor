import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKER_BEGIN_PREFIX,
  MARKER_END,
  atomManifest,
  markerBegin,
  parseAtomManifest,
  renderCursorRules,
  renderMarkedSection,
  renderOutputStyle,
} from '../../src/packs/render.ts';
import type { PackMode } from '../../src/packs/types.ts';

const MODES: readonly PackMode[] = ['optimized', 'slim'];

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test('renderers are byte-deterministic', () => {
  for (const mode of MODES) {
    assert.deepEqual(renderOutputStyle(mode), renderOutputStyle(mode));
    assert.deepEqual(
      renderMarkedSection(mode, 'agents-md'),
      renderMarkedSection(mode, 'agents-md'),
    );
    assert.deepEqual(renderCursorRules(mode), renderCursorRules(mode));
  }
});

test('output style has keep-coding-instructions and no name field', () => {
  const { body } = renderOutputStyle('slim');
  assert.ok(body.includes('keep-coding-instructions: true'));
  assert.ok(!/^name:/m.test(body));
});

test('slim output style leads with code-first section; optimized lacks it', () => {
  const slim = renderOutputStyle('slim');
  const codeFirst = slim.body.indexOf('## Code-first responses');
  assert.ok(codeFirst >= 0);
  assert.ok(codeFirst < slim.body.indexOf('## Output discipline'));
  assert.ok(slim.body.includes('## Context discipline'));
  assert.deepEqual(slim.atomIds.slice(0, 2), [
    'out.explanation-budget',
    'out.code-only-default',
  ]);
  assert.ok(!renderOutputStyle('optimized').body.includes('## Code-first responses'));
});

test('marked section round-trips mode and atom ids', () => {
  for (const mode of MODES) {
    const artifact = renderMarkedSection(mode, 'copilot');
    assert.deepEqual(parseAtomManifest(artifact.body), {
      mode,
      atomIds: artifact.atomIds,
    });
  }
});

test('marked section contains markers exactly once', () => {
  for (const mode of MODES) {
    const { body } = renderMarkedSection(mode, 'claude-code');
    assert.equal(count(body, markerBegin(mode)), 1);
    assert.equal(count(body, MARKER_BEGIN_PREFIX), 1);
    assert.equal(count(body, MARKER_END), 1);
    assert.ok(body.startsWith(markerBegin(mode)));
    assert.ok(body.endsWith(MARKER_END));
  }
});

test('parseAtomManifest reads mode from output-style and cursor bodies', () => {
  for (const mode of MODES) {
    const style = renderOutputStyle(mode);
    assert.deepEqual(parseAtomManifest(style.body), {
      mode,
      atomIds: style.atomIds,
    });
    const rules = renderCursorRules(mode);
    assert.deepEqual(parseAtomManifest(rules.body), {
      mode,
      atomIds: rules.atomIds,
    });
  }
});

test('parseAtomManifest rejects unmarked or partial text', () => {
  assert.equal(parseAtomManifest('# README\nplain text'), null);
  assert.equal(parseAtomManifest(atomManifest(['out.no-preamble'])), null);
});
