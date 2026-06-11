import type { CompressMeta, Estimator, MarkerStyle } from '../types.ts';
import {
  formatMatchLines,
  lineNumberOf,
  omissionMarker,
  scanFailureLines,
  tierResult,
} from './structural.ts';
import type { TierResult } from './structural.ts';

export type CodeLang =
  | 'ts-js'
  | 'rust'
  | 'python'
  | 'go'
  | 'c-like'
  | 'ruby'
  | 'shell'
  | 'css'
  | 'sql'
  | 'config';

const LANG_BY_EXT: Record<string, CodeLang> = {
  ts: 'ts-js', tsx: 'ts-js', js: 'ts-js', jsx: 'ts-js', mjs: 'ts-js', cjs: 'ts-js',
  rs: 'rust',
  py: 'python',
  go: 'go',
  java: 'c-like', c: 'c-like', h: 'c-like', cpp: 'c-like', hpp: 'c-like',
  swift: 'c-like', kt: 'c-like', scala: 'c-like', php: 'c-like',
  rb: 'ruby',
  sh: 'shell', zsh: 'shell',
  css: 'css', scss: 'css',
  sql: 'sql',
  toml: 'config', yaml: 'config', yml: 'config',
};

export function langFromPath(filePath?: string): CodeLang | undefined {
  if (filePath === undefined) return undefined;
  const match = /\.([A-Za-z0-9]+)$/.exec(filePath);
  const ext = match?.[1]?.toLowerCase();
  return ext === undefined ? undefined : LANG_BY_EXT[ext];
}

// Claude Code Read prefixes: "   123→content" (U+2192) or tab-separated variants.
const LINE_NUM_RE = /^ *\d+(?:→|\t)/;

export function hasLineNumbers(content: string): boolean {
  const lines = content.split('\n').filter((l) => l.length > 0);
  if (lines.length < 2) return false;
  return lines.every((l) => LINE_NUM_RE.test(l));
}

function lineText(line: string): string {
  const match = LINE_NUM_RE.exec(line);
  return match === null ? line : line.slice(match[0].length);
}

interface CommentSyntax {
  line: readonly string[];
  block?: { open: string; close: string };
}

const COMMENT_SYNTAX: Record<CodeLang, CommentSyntax> = {
  'ts-js': { line: ['//'], block: { open: '/*', close: '*/' } },
  rust: { line: ['//'], block: { open: '/*', close: '*/' } },
  python: { line: ['#'] },
  go: { line: ['//'], block: { open: '/*', close: '*/' } },
  'c-like': { line: ['//'], block: { open: '/*', close: '*/' } },
  ruby: { line: ['#'] },
  shell: { line: ['#'] },
  css: { line: ['//'], block: { open: '/*', close: '*/' } },
  sql: { line: ['--'], block: { open: '/*', close: '*/' } },
  config: { line: ['#'] },
};

type TripleQuote = '"""' | "'''";

/** Advance python triple-quote string state across one line of code. */
function scanPythonTriples(text: string, open: TripleQuote | null): TripleQuote | null {
  let state = open;
  let i = 0;
  while (i < text.length) {
    if (state === null) {
      const dq = text.indexOf('"""', i);
      const sq = text.indexOf("'''", i);
      const next = dq === -1 ? sq : sq === -1 ? dq : Math.min(dq, sq);
      if (next === -1) break;
      state = text.startsWith('"""', next) ? '"""' : "'''";
      i = next + 3;
    } else {
      const close = text.indexOf(state, i);
      if (close === -1) break;
      i = close + 3;
      state = null;
    }
  }
  return state;
}

function commentStripMarker(
  stripped: number,
  strippedLines: readonly string[],
  style: MarkerStyle,
): string {
  const head = `[compressor: ${stripped} comment/blank lines stripped — line numbers preserved`;
  if (style === 'deterrent') {
    return `${head}; comments are likely irrelevant to the problem you are chasing]`;
  }
  if (style === 'informative') {
    const scan = scanFailureLines(strippedLines);
    return scan.count === 0
      ? `${head}; no error/failure/warning text among them; safe to skip]`
      : `${head}; ${scan.count} stripped lines matching error/fail/warn at lines ${formatMatchLines(scan)}]`;
  }
  return `${head}]`;
}

export function stripComments(
  content: string,
  lang: CodeLang | undefined,
  style: MarkerStyle = 'plain',
): TierResult {
  if (lang === undefined || !hasLineNumbers(content)) return { content };
  // yaml/toml '#' lines inside block scalars are data, not comments — never strip config.
  if (lang === 'config') return { content };
  const syntax = COMMENT_SYNTAX[lang];
  const block = syntax.block;
  const lines = content.split('\n');
  const kept: string[] = [];
  const strippedLines: string[] = [];
  let stripped = 0;
  let inBlock = false;
  let tripleOpen: TripleQuote | null = null;
  for (const line of lines) {
    if (line.length === 0) {
      kept.push(line);
      continue;
    }
    const text = lineText(line);
    if (lang === 'python' && tripleOpen !== null) {
      // inside a triple-quoted string: '#' and blank lines are literal data
      tripleOpen = scanPythonTriples(text, tripleOpen);
      kept.push(line);
      continue;
    }
    const trimmed = text.trim();
    let drop = false;
    if (inBlock && block !== undefined) {
      const closeIdx = trimmed.indexOf(block.close);
      if (closeIdx >= 0) {
        inBlock = false;
        drop = trimmed.slice(closeIdx + block.close.length).trim() === '';
      } else {
        drop = true;
      }
    } else if (trimmed === '') {
      drop = true;
    } else if (trimmed.startsWith('#!')) {
      drop = false;
    } else if (syntax.line.some((p) => trimmed.startsWith(p))) {
      drop = true;
    } else if (block !== undefined && trimmed.startsWith(block.open)) {
      const rest = trimmed.slice(block.open.length);
      const closeIdx = rest.indexOf(block.close);
      if (closeIdx >= 0) {
        drop = rest.slice(closeIdx + block.close.length).trim() === '';
      } else {
        drop = true;
        inBlock = true;
      }
    }
    if (drop) {
      stripped += 1;
      strippedLines.push(line);
    } else {
      if (lang === 'python') tripleOpen = scanPythonTriples(text, null);
      kept.push(line);
    }
  }
  if (stripped === 0) return { content };
  const marker = commentStripMarker(stripped, strippedLines, style);
  const trailing = kept.length > 0 && kept[kept.length - 1] === '' ? kept.pop() : undefined;
  kept.push(marker);
  if (trailing !== undefined) kept.push(trailing);
  return tierResult(content, kept.join('\n'), 'comment-strip');
}

type SignatureTest = (text: string) => boolean;

const SIGNATURE_TESTS: Partial<Record<CodeLang, SignatureTest>> = {
  'ts-js': (t) => /^(import|export|function|async function|class|interface|type)\b/.test(t),
  rust: (t) => /^\s*(use|pub|fn|struct|enum|trait|impl|mod)\b/.test(t),
  python: (t) => /^\s*(import|from|def|class|async def)\b/.test(t),
  go: (t) => /^(package|import|func|type)\b/.test(t),
};

export function skeleton(
  content: string,
  lang: CodeLang | undefined,
  meta: CompressMeta,
  estimate: Estimator,
  style: MarkerStyle = 'plain',
): TierResult {
  if (lang === undefined || !hasLineNumbers(content)) return { content };
  const isSignature = SIGNATURE_TESTS[lang];
  if (isSignature === undefined) return { content };
  const lines = content.split('\n');
  const out: string[] = [];
  let gap: string[] = [];
  const flushGap = (): void => {
    if (gap.length === 0) return;
    const first = gap[0];
    const last = gap[gap.length - 1];
    const a = first === undefined ? undefined : lineNumberOf(first);
    const b = last === undefined ? undefined : lineNumberOf(last);
    if (gap.length < 2 || a === undefined || b === undefined) {
      out.push(...gap);
    } else {
      out.push(omissionMarker(a, b, estimate(gap.join('\n')), meta, style, gap));
    }
    gap = [];
  };
  for (const line of lines) {
    if (line.length === 0) {
      flushGap();
      out.push(line);
      continue;
    }
    if (isSignature(lineText(line))) {
      flushGap();
      out.push(line);
    } else {
      gap.push(line);
    }
  }
  flushGap();
  return tierResult(content, out.join('\n'), 'skeleton');
}
