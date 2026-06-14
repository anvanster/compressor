import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Variant } from './types.ts';

// Competitor instruction packs, run as benchmark variants for head-to-head
// comparison. A competitor's real pack body is delivered through the SAME
// output-style (system-prompt) channel compressor uses, keep-coding-
// instructions:true, so the ONLY variable vs a compressor arm is the
// instruction text. hook:false on purpose — these tools are output-shaping
// only and have no input-compression mechanism; that asymmetry is exactly what
// the comparison measures. Pack assets live in <suiteDir>/../competitors/ as
// verbatim copies of the upstream source (attribution in the asset header).

export const COMPETITORS = ['caveman'] as const;
export type CompetitorName = (typeof COMPETITORS)[number];

interface CompetitorSpec {
  file: string;
  description: string;
}

const SPECS: Record<CompetitorName, CompetitorSpec> = {
  caveman: {
    file: 'caveman-skill.md',
    description:
      'Caveman skill (juliusbrussee/caveman) as an always-on output style — the viral output-token-saving instruction pack, delivered via the same system-prompt channel as compressor for a fair head-to-head',
  },
};

export function isCompetitor(value: string): value is CompetitorName {
  return (COMPETITORS as readonly string[]).includes(value);
}

/** Drop a leading `---\n … \n---` YAML frontmatter block, returning the body. */
export function stripFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return match === null ? text : text.slice(match[0].length);
}

export async function competitorVariant(name: CompetitorName, dir: string): Promise<Variant> {
  const spec = SPECS[name];
  const assetPath = path.join(dir, spec.file);
  let raw: string;
  try {
    raw = await readFile(assetPath, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `competitor '${name}': pack asset missing at ${assetPath} (competitors live in <suiteDir>/../competitors): ${reason}`,
    );
  }
  const body = stripFrontmatter(raw).trim();
  if (body === '') {
    throw new Error(
      `competitor '${name}': pack body is empty after stripping frontmatter (${assetPath})`,
    );
  }
  const styleBody = `---\ndescription: ${spec.description}\nkeep-coding-instructions: true\n---\n\n${body}\n`;
  return { id: name, baseMode: 'full', styleBody, styleName: name, hook: false };
}
