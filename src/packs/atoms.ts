import type { Atom } from './types.ts';

export const ATOMS: readonly Atom[] = [
  {
    id: 'out.no-preamble',
    category: 'output',
    text: `Start every response with the answer or the action. No preamble ("I'll help you...", "Let me...", "Great question"), no plan narration for single-step work.`,
    modes: ['optimized', 'slim'],
  },
  {
    id: 'out.no-postamble',
    category: 'output',
    text: `No filler, hedging, or politeness padding. No "feel free to ask", no recap closings.`,
    modes: ['optimized', 'slim'],
  },
  {
    id: 'out.answer-first',
    category: 'output',
    text: 'Lead with the conclusion. Supporting detail comes after, only if it changes what the reader does next.',
    modes: ['optimized', 'slim'],
  },
  {
    id: 'out.no-recap',
    category: 'output',
    text: `Do not summarize what you just did unless asked. After edits, state the result in one line at most ("Fixed the null check in parser.ts:142").`,
    modes: ['optimized', 'slim'],
  },
  {
    id: 'out.no-code-echo',
    category: 'output',
    text: `Never restate code in prose. The diff or the file is the explanation. Don't quote code you just wrote back to the user.`,
    modes: ['optimized', 'slim'],
  },
  {
    id: 'out.minimal-formatting',
    category: 'output',
    text: 'Use plain sentences for short answers. Reserve headers and bullets for genuinely multi-part responses.',
    modes: ['optimized'],
  },
  {
    id: 'out.explanation-budget',
    category: 'output',
    text: 'Hard budget: at most ~10% of your response may be explanation. For a 40-line diff, that is 2-4 short lines. When in doubt, omit the explanation.',
    modes: ['slim'],
  },
  {
    id: 'out.code-only-default',
    category: 'output',
    text: `Respond with code, diffs, commands, and file paths. Prose is for what code cannot express: a decision between alternatives, a risk, a required manual step. Acceptable response shapes: a bare code block; a path followed by a diff; a one-line answer. "Done." is a complete response to a completed task. Never explain what standard code does — only flag the non-obvious: side effects, breaking changes, things the user must do themselves. If the task is ambiguous enough that proceeding risks wasted work, ask one terse question instead of writing a hedged essay.`,
    modes: ['slim'],
  },
  {
    id: 'beh.targeted-reads',
    category: 'behavior',
    text: 'Read only what you need: prefer Grep/Glob to locate, then Read with offset/limit for the relevant range. Read a whole file only when it is small or you must edit broadly across it.',
    modes: ['optimized', 'slim'],
  },
  {
    id: 'beh.no-reread',
    category: 'behavior',
    text: 'Never re-read a file you already have in context, unless it changed or earlier output was compressed — a [compressor: ...] marker means lines were omitted and tells you the exact offset/limit to Read if you need them.',
    modes: ['optimized', 'slim'],
  },
  {
    id: 'beh.no-tool-echo',
    category: 'behavior',
    text: `Do not quote tool output back in your response; reference it ("tests pass", "3 matches in src/").`,
    modes: ['optimized', 'slim'],
  },
  {
    id: 'beh.surgical-edits',
    category: 'behavior',
    text: 'Prefer surgical edits to full-file rewrites. Batch related edits to the same file into one operation.',
    modes: ['optimized', 'slim'],
  },
  {
    id: 'beh.bounded-commands',
    category: 'behavior',
    text: 'Bound command output: use flags like --quiet, head -50, or targeted test selection rather than dumping full logs.',
    modes: ['optimized', 'slim'],
  },
  {
    id: 'tokens.drop-articles',
    category: 'output',
    text: 'Omit articles (a, an, the) and filler words from responses.',
    modes: ['optimized', 'slim'],
    rejected: {
      reason:
        '~1 token saved per article, output-only; degrades grammar and pushes the model off its training distribution for single-digit savings. Empirically refuted: bench-20260610-124626 (sonnet, 9 tasks ×2 trials) measured optimized-plus-tokens-drop-articles at −2.2% output vs optimized — noise, no benefit on top of a concise baseline. Kept for --ablate-add reproduction.',
    },
  },
  {
    id: 'tokens.no-politeness-words',
    category: 'output',
    text: 'Never use the words please or thank you.',
    modes: ['optimized', 'slim'],
    rejected: {
      reason:
        'Micro-optimization already subsumed by out.no-postamble; word-level bans distract the model more than they save.',
    },
  },
];

const byId = new Map<string, Atom>();
for (const atom of ATOMS) {
  if (byId.has(atom.id)) {
    throw new Error(`duplicate atom id: ${atom.id}`);
  }
  byId.set(atom.id, atom);
}

export function getAtom(id: string): Atom | undefined {
  return byId.get(id);
}
