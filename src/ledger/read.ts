import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import type { LedgerEvent } from './write.ts';
import { PROJECT_LABEL_MAX, resolveLedgerDir } from './write.ts';

// Tolerant reader for the monthly JSONL ledger files: unparseable lines and
// wrong-shaped records are skipped, a missing directory is an empty ledger.

export interface ReadLedgerOptions {
  /** ledger directory (default: COMPRESSOR_LEDGER_DIR or ~/.compressor/ledger) */
  dir?: string;
  /** only events at or after this instant */
  since?: Date;
}

const AGENTS = new Set(['claude-code', 'copilot', 'opencode', 'vscode']);
const TOOLS = new Set(['read', 'bash', 'search', 'other', 'mcp']);
const MODES = new Set(['full', 'optimized', 'slim']);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// Control characters would corrupt both renderers (SVG text and the terminal
// report), and an over-long label would stretch the chart without bound.
const PROJECT_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function usableProject(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= PROJECT_LABEL_MAX &&
    !PROJECT_CONTROL_CHARS.test(value)
  );
}

function parseEvent(line: string): LedgerEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const ts = record['ts'];
  const agent = record['agent'];
  const tool = record['tool'];
  const mode = record['mode'];
  const transforms = record['transforms'];
  if (
    typeof ts !== 'string' ||
    typeof agent !== 'string' ||
    !AGENTS.has(agent) ||
    typeof tool !== 'string' ||
    !TOOLS.has(tool) ||
    typeof mode !== 'string' ||
    !MODES.has(mode) ||
    !isFiniteNumber(record['charsIn']) ||
    !isFiniteNumber(record['charsOut']) ||
    !isFiniteNumber(record['estTokensIn']) ||
    !isFiniteNumber(record['estTokensOut']) ||
    !Array.isArray(transforms) ||
    !transforms.every((t): t is string => typeof t === 'string')
  ) {
    return null;
  }
  const event: LedgerEvent = {
    ts,
    agent: agent as LedgerEvent['agent'],
    tool: tool as LedgerEvent['tool'],
    mode: mode as LedgerEvent['mode'],
    charsIn: record['charsIn'],
    charsOut: record['charsOut'],
    estTokensIn: record['estTokensIn'],
    estTokensOut: record['estTokensOut'],
    transforms,
  };
  // Deliberate asymmetry: every field above rejects the whole line when it is
  // wrong, but an unusable project label only drops the label. Discarding real
  // savings data over a cosmetic field would contradict the fail-open posture
  // the rest of the ledger keeps. Unknown fields are still dropped: this
  // rebuild is a whitelist on purpose, since the ledger is a file users share
  // and re-import, and the report renders it.
  const project = record['project'];
  if (usableProject(project)) {
    event.project = project;
  }
  return event;
}

/** Read every monthly file, tolerant of garbage lines; sorted by timestamp. */
export async function readLedger(opts: ReadLedgerOptions = {}): Promise<LedgerEvent[]> {
  const dir = opts.dir ?? resolveLedgerDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const events: LedgerEvent[] = [];
  for (const name of names.filter((n) => n.endsWith('.jsonl')).sort()) {
    let body: string;
    try {
      body = await readFile(path.join(dir, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of body.split('\n')) {
      if (line.trim() === '') {
        continue;
      }
      const event = parseEvent(line);
      if (event === null) {
        continue;
      }
      if (opts.since !== undefined) {
        const when = Date.parse(event.ts);
        if (Number.isNaN(when) || when < opts.since.getTime()) {
          continue;
        }
      }
      events.push(event);
    }
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts));
}
