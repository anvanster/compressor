import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import type { LedgerEvent } from './write.ts';
import { resolveLedgerDir } from './write.ts';

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
  return {
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
