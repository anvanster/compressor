import type { AgentName, Atom, PackMode } from './types.ts';
import { getAtom } from './atoms.ts';

/** Curated render order — explicit so object-key order can never reorder output. */
const MODE_ORDER: readonly string[] = [
  'out.no-preamble',
  'out.answer-first',
  'out.no-recap',
  'out.no-code-echo',
  'out.no-postamble',
  'out.minimal-formatting',
  'out.explanation-budget',
  'out.code-only-default',
  'beh.targeted-reads',
  'beh.no-reread',
  'beh.no-tool-echo',
  'beh.surgical-edits',
  'beh.bounded-commands',
];

const ORDERED_ATOMS: readonly Atom[] = MODE_ORDER.map((id) => {
  const atom = getAtom(id);
  if (atom === undefined) {
    throw new Error(`unknown atom id in mode order: ${id}`);
  }
  return atom;
});

export function atomsForMode(mode: PackMode, agent?: AgentName): Atom[] {
  return ORDERED_ATOMS.filter(
    (atom) =>
      atom.rejected === undefined &&
      atom.modes.includes(mode) &&
      (atom.agents === undefined ||
        (agent !== undefined && atom.agents.includes(agent))),
  );
}

export const MODE_DESCRIPTIONS: Record<PackMode, string> = {
  optimized: 'Concise answer-first responses with disciplined context use',
  slim: 'Code-first responses under a hard explanation budget',
};
