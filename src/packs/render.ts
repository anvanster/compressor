import type { AgentName, Atom, PackMode, RenderedArtifact } from './types.ts';
import { atomsForMode, MODE_DESCRIPTIONS } from './modes.ts';

export const MARKER_BEGIN_PREFIX = '<!-- compressor:begin';
export const MARKER_END = '<!-- compressor:end -->';

export function markerBegin(mode: PackMode): string {
  return `${MARKER_BEGIN_PREFIX} mode=${mode} v=1 -->`;
}

export function atomManifest(atomIds: string[]): string {
  return `<!-- atoms: ${atomIds.join(',')} -->`;
}

const BEGIN_RE = /<!-- compressor:begin mode=(\S+) v=\d+ -->/;
const MANIFEST_RE = /<!-- atoms: ([^>]*) -->/;
const DESCRIPTION_RE = /^description: (.+)$/m;

function isPackMode(value: string): value is PackMode {
  return value === 'optimized' || value === 'slim';
}

function parseMode(text: string): PackMode | null {
  const fromMarker = BEGIN_RE.exec(text)?.[1];
  if (fromMarker !== undefined && isPackMode(fromMarker)) {
    return fromMarker;
  }
  const description = DESCRIPTION_RE.exec(text)?.[1];
  if (description !== undefined) {
    const modes: readonly PackMode[] = ['optimized', 'slim'];
    return modes.find((m) => MODE_DESCRIPTIONS[m] === description) ?? null;
  }
  return null;
}

export function parseAtomManifest(
  text: string,
): { mode: PackMode; atomIds: string[] } | null {
  const idsRaw = MANIFEST_RE.exec(text)?.[1];
  if (idsRaw === undefined) {
    return null;
  }
  const mode = parseMode(text);
  if (mode === null) {
    return null;
  }
  const atomIds = idsRaw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return { mode, atomIds };
}

function bullet(atom: Atom): string {
  return `- ${atom.text}`;
}

/** Atoms slim pulls out into a leading '## Code-first responses' section. */
const CODE_FIRST_IDS: ReadonlySet<string> = new Set([
  'out.explanation-budget',
  'out.code-only-default',
]);

/**
 * Output style over an explicit atom list (benchmark ablation variants).
 * styleName is validated only: Claude Code resolves styles by file name
 * (`<styleName>.md`), and a `name:` frontmatter field is deliberately omitted.
 */
export function renderOutputStyleFromAtoms(
  atoms: Atom[],
  styleName: string,
  description: string,
): RenderedArtifact {
  if (styleName === '' || /[/\\]/.test(styleName)) {
    throw new Error(
      `invalid output-style name ${JSON.stringify(styleName)} — becomes the file name <styleName>.md`,
    );
  }
  const codeFirst = atoms.filter((a) => CODE_FIRST_IDS.has(a.id));
  const output = atoms.filter(
    (a) => a.category === 'output' && !CODE_FIRST_IDS.has(a.id),
  );
  const behavior = atoms.filter((a) => a.category === 'behavior');
  const atomIds = [...codeFirst, ...output, ...behavior].map((a) => a.id);

  const lines: string[] = [
    '---',
    `description: ${description}`,
    'keep-coding-instructions: true',
    '---',
    '',
    atomManifest(atomIds),
    '',
  ];
  if (codeFirst.length > 0) {
    lines.push('## Code-first responses', ...codeFirst.map(bullet), '');
  }
  lines.push('## Output discipline', ...output.map(bullet), '');
  lines.push('## Context discipline', ...behavior.map(bullet));
  return { body: `${lines.join('\n')}\n`, atomIds };
}

export function renderOutputStyle(mode: PackMode): RenderedArtifact {
  return renderOutputStyleFromAtoms(
    atomsForMode(mode, 'claude-code'),
    `compressor-${mode}`,
    MODE_DESCRIPTIONS[mode],
  );
}

export function renderMarkedSection(
  mode: PackMode,
  agent: AgentName,
): RenderedArtifact {
  const atoms = atomsForMode(mode, agent);
  const atomIds = atoms.map((a) => a.id);
  const lines = [
    markerBegin(mode),
    atomManifest(atomIds),
    '## Response & context discipline (compressor)',
    ...atoms.map(bullet),
    MARKER_END,
  ];
  return { body: lines.join('\n'), atomIds };
}

export function renderCursorRules(mode: PackMode): RenderedArtifact {
  const atoms = atomsForMode(mode, 'cursor');
  const atomIds = atoms.map((a) => a.id);
  const lines = [
    '---',
    `description: ${MODE_DESCRIPTIONS[mode]}`,
    'alwaysApply: true',
    '---',
    '',
    atomManifest(atomIds),
    '',
    ...atoms.map(bullet),
  ];
  return { body: `${lines.join('\n')}\n`, atomIds };
}
