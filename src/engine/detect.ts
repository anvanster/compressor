import type { ContentKind } from './types.ts';

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'rs', 'py', 'go', 'java', 'c', 'h', 'cpp', 'hpp',
  'rb', 'php', 'swift', 'kt', 'scala',
  'sh', 'zsh', 'css', 'scss', 'sql', 'toml', 'yaml', 'yml',
]);

// Checkmark bullets (/^\s*[✓✗√×✘]\s/) alone are NOT a test-log signal: docs,
// checklists, and CLI summaries use them too. Require an unambiguous runner
// header/summary before classifying (and thus lossily filtering) as test-log.
const TEST_LOG_RES: readonly RegExp[] = [
  /^(PASS|FAIL)\s/m,
  /^Tests:\s/m,
  /\d+\s+pass(?:ed|ing)\b/,
  /\d+\s+fail(?:ed|ing)\b/,
  /^test result:/m,
  /--- FAIL/,
  /^test\s+\S+\s+\.\.\.\s+(?:ok|FAILED)\s*$/m,
  // node:test spec ('ℹ pass 118') and tap ('# pass 118') summary counters
  /^(?:ℹ|#) (?:tests|suites|pass|fail|cancelled|skipped|todo) \d+\s*$/m,
];

const BUILD_LOG_RES: readonly RegExp[] = [
  /error\[E\d+\]/,
  /^\s*(error|warning)(\s+TS\d+)?:/m,
  /\bCompiling\s/,
  /npm ERR!/,
];

const STACK_FRAME_RE = /^\s+at .+:\d+:\d+/m;

export function detectKind(content: string, filePath?: string): ContentKind {
  if (filePath !== undefined) {
    const ext = extensionOf(filePath);
    if (ext !== undefined && CODE_EXTENSIONS.has(ext)) return 'code';
  }
  if (content.startsWith('#!')) return 'code';
  if (TEST_LOG_RES.some((re) => re.test(content))) return 'test-log';
  if (BUILD_LOG_RES.some((re) => re.test(content))) return 'build-log';
  if (STACK_FRAME_RE.test(content) && /\berror\b/i.test(content)) return 'build-log';
  return 'generic';
}

function extensionOf(filePath: string): string | undefined {
  const match = /\.([A-Za-z0-9]+)$/.exec(filePath);
  return match?.[1]?.toLowerCase();
}
