import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATOMS, getAtom } from '../../src/packs/atoms.ts';
import { atomsForMode } from '../../src/packs/modes.ts';
import type { AgentName, PackMode } from '../../src/packs/types.ts';

const MODES: readonly PackMode[] = ['optimized', 'slim'];
const AGENTS: readonly (AgentName | undefined)[] = [
  undefined,
  'claude-code',
  'copilot',
  'cursor',
  'agents-md',
];

test('atom ids are unique', () => {
  const ids = ATOMS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('getAtom resolves known ids and misses unknown ids', () => {
  assert.equal(getAtom('out.no-preamble')?.id, 'out.no-preamble');
  assert.equal(getAtom('does.not-exist'), undefined);
});

test('rejected atoms never appear in atomsForMode for any mode/agent', () => {
  const rejectedIds = ATOMS.filter((a) => a.rejected !== undefined).map(
    (a) => a.id,
  );
  assert.ok(rejectedIds.includes('tokens.drop-articles'));
  assert.ok(rejectedIds.includes('tokens.no-politeness-words'));
  for (const mode of MODES) {
    for (const agent of AGENTS) {
      const ids = atomsForMode(mode, agent).map((a) => a.id);
      for (const rejected of rejectedIds) {
        assert.ok(
          !ids.includes(rejected),
          `${rejected} leaked into ${mode}/${agent ?? 'any'}`,
        );
      }
    }
  }
});

test('slim includes explanation-budget, optimized does not', () => {
  assert.ok(
    atomsForMode('slim')
      .map((a) => a.id)
      .includes('out.explanation-budget'),
  );
  assert.ok(
    !atomsForMode('optimized')
      .map((a) => a.id)
      .includes('out.explanation-budget'),
  );
});

test('optimized includes minimal-formatting, slim does not', () => {
  assert.ok(
    atomsForMode('optimized')
      .map((a) => a.id)
      .includes('out.minimal-formatting'),
  );
  assert.ok(
    !atomsForMode('slim')
      .map((a) => a.id)
      .includes('out.minimal-formatting'),
  );
});

test('beh.no-reread permits recovering compressed output via markers', () => {
  const atom = getAtom('beh.no-reread');
  assert.ok(atom);
  // must not contradict the engine's own omission-marker recovery mechanism
  assert.match(atom.text, /\[compressor:/);
  assert.match(atom.text, /offset\/limit/);
});

test('atomsForMode orders output atoms before behavior atoms', () => {
  for (const mode of MODES) {
    const categories = atomsForMode(mode).map((a) => a.category);
    const firstBehavior = categories.indexOf('behavior');
    assert.ok(firstBehavior > 0);
    assert.ok(
      categories.slice(firstBehavior).every((c) => c === 'behavior'),
      `output atom after behavior atoms in ${mode}`,
    );
  }
});
