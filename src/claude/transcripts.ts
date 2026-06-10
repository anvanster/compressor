import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';

export interface UsageTotals {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

export interface SessionUsage {
  sessionId: string;
  file: string;
  turns: number;
  totals: UsageTotals;
  byModel: Record<string, UsageTotals>;
  sidechain: UsageTotals;
  firstTimestamp?: string;
  lastTimestamp?: string;
}

const ENCODED_DIR_MAX = 200;

/** 32-bit java-style string hash, matching Claude Code's long-path suffix. */
function hash32(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Claude Code encodes the project cwd as replace(/[^a-zA-Z0-9]/g, '-'); when
 * the result exceeds 200 chars it is truncated and suffixed with a base36
 * hash of the ORIGINAL path (verified against the 2.1.170 binary).
 */
export function encodeProjectDir(absPath: string): string {
  const dashed = absPath.replace(/[^a-zA-Z0-9]/g, '-');
  if (dashed.length <= ENCODED_DIR_MAX) {
    return dashed;
  }
  return `${dashed.slice(0, ENCODED_DIR_MAX)}-${Math.abs(hash32(absPath)).toString(36)}`;
}

const emptyTotals = (): UsageTotals => ({
  input: 0,
  output: 0,
  cacheCreation: 0,
  cacheRead: 0,
});

export function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

export function aggregateUsage(sessions: SessionUsage[]): UsageTotals {
  return sessions.reduce((acc, s) => addUsage(acc, s.totals), emptyTotals());
}

export async function findTranscripts(opts: {
  projectDir: string;
  configDir?: string;
  since?: Date;
}): Promise<string[]> {
  const configDir =
    opts.configDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const dir = join(configDir, 'projects', encodeProjectDir(opts.projectDir));

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const name of names.filter((n) => n.endsWith('.jsonl')).sort()) {
    const full = join(dir, name);
    if (opts.since) {
      try {
        const info = await stat(full);
        if (info.mtimeMs < opts.since.getTime()) continue;
      } catch {
        continue;
      }
    }
    files.push(full);
  }
  return files;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function usageFrom(usage: Record<string, unknown>): UsageTotals {
  return {
    input: num(usage['input_tokens']),
    output: num(usage['output_tokens']),
    cacheCreation: num(usage['cache_creation_input_tokens']),
    cacheRead: num(usage['cache_read_input_tokens']),
  };
}

interface Turn {
  usage: UsageTotals;
  model: string;
  sidechain: boolean;
}

export async function readSessionUsage(file: string): Promise<SessionUsage> {
  // The same requestId appears on multiple lines for streamed updates; the
  // last occurrence carries final usage, so Map.set overwrites earlier ones.
  const turns = new Map<string, Turn>();
  let sessionId = '';
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let anonCounter = 0;

  const rl = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || parsed['type'] !== 'assistant') continue;

    const message = parsed['message'];
    if (!isRecord(message)) continue;
    const usage = message['usage'];
    if (!isRecord(usage)) continue;

    if (sessionId === '' && typeof parsed['sessionId'] === 'string') {
      sessionId = parsed['sessionId'];
    }
    const ts = parsed['timestamp'];
    if (typeof ts === 'string') {
      firstTimestamp ??= ts;
      lastTimestamp = ts;
    }

    const key =
      typeof parsed['requestId'] === 'string'
        ? parsed['requestId']
        : typeof message['id'] === 'string'
          ? message['id']
          : `anon-${anonCounter++}`;

    turns.set(key, {
      usage: usageFrom(usage),
      model: typeof message['model'] === 'string' ? message['model'] : 'unknown',
      sidechain: parsed['isSidechain'] === true,
    });
  }

  let totals = emptyTotals();
  let sidechain = emptyTotals();
  const byModel: Record<string, UsageTotals> = {};
  for (const turn of turns.values()) {
    totals = addUsage(totals, turn.usage);
    byModel[turn.model] = addUsage(byModel[turn.model] ?? emptyTotals(), turn.usage);
    if (turn.sidechain) sidechain = addUsage(sidechain, turn.usage);
  }

  return {
    sessionId: sessionId === '' ? basename(file, '.jsonl') : sessionId,
    file,
    turns: turns.size,
    totals,
    byModel,
    sidechain,
    firstTimestamp,
    lastTimestamp,
  };
}
