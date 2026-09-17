// Reader for VS Code's chat debug logs — the JSONL files Copilot Chat writes
// under `<workspaceStorage>/GitHub.copilot-chat/debug-logs/<sessionId>/`.
//
// The entry shape is a published type (IDebugLogEntry in vscode-copilot-chat),
// but this project does not control it and cannot ship in lockstep with it, so
// nothing here trusts the schema blindly: {@link probeDebugLog} reports which
// types and attribute keys were actually present, and callers surface that
// instead of quietly reporting zeros when a future version moves a field.
//
// Token counters are OPTIONAL by design — the writer omits the key when the
// provider reported nothing. Absent is not zero, and conflating the two would
// understate usage without any visible symptom, so unknown counters are counted
// separately rather than summed as 0.
//
// PURE: no fs, no process. Callers hand over file contents.

/** Schema version this reader was written against (IDebugLogEntry.v). */
export const KNOWN_SCHEMA_VERSION = 1;

/** Entry types the upstream union declares, in its own order. */
export const KNOWN_ENTRY_TYPES = [
  'session_start',
  'tool_call',
  'llm_request',
  'user_message',
  'agent_response',
  'subagent',
  'discovery',
  'error',
  'generic',
  'child_session_ref',
  'hook',
  'turn_start',
  'turn_end',
] as const;

export type DebugLogEntryType = (typeof KNOWN_ENTRY_TYPES)[number];

/** One model call, as recorded by an `llm_request` entry. */
export interface LlmRequest {
  /** epoch ms */
  ts: number;
  /** chat session id */
  sessionId: string;
  model: string;
  /** absent when the provider reported no count — NOT zero */
  inputTokens?: number;
  /**
   * Prompt tokens served from the provider's cache, a subset of inputTokens.
   * Decisive for cost: a cache read is an order of magnitude cheaper than a
   * fresh prompt token, and in a long agent session almost the whole prompt is
   * a cache hit.
   */
  cachedTokens?: number;
  outputTokens?: number;
  /**
   * Copilot AI Units billed for this call, in nano units, as reported by the
   * provider. This is measured spend, not a rate-card estimate.
   */
  nanoAiu?: number;
  /** request duration in ms */
  durationMs: number;
  status: 'ok' | 'error';
}

/**
 * What a log actually contained. Its purpose is falsifiability: a caller that
 * finds zero `llm_request` entries can tell "logging was off" (no entries at
 * all) from "the schema moved" (entries present, ours absent or without the
 * attributes we read).
 */
export interface DebugLogProbe {
  /** well-formed entries seen */
  entries: number;
  /** lines that were not parseable entries */
  malformed: number;
  /** entry count per `type`, including types this reader does not know */
  byType: Record<string, number>;
  /** attribute keys observed per `type`, sorted */
  attrsByType: Record<string, string[]>;
  /** distinct schema versions seen (absent `v` counts as 1) */
  versions: number[];
  /** a `type` outside KNOWN_ENTRY_TYPES appeared */
  unknownTypes: string[];
  /** a schema version newer than this reader appeared */
  unknownSchema: boolean;
  /** llm_request entries whose token counters were absent */
  requestsMissingInputTokens: number;
  requestsMissingOutputTokens: number;
}

export function emptyProbe(): DebugLogProbe {
  return {
    entries: 0,
    malformed: 0,
    byType: {},
    attrsByType: {},
    versions: [],
    unknownTypes: [],
    unknownSchema: false,
    requestsMissingInputTokens: 0,
    requestsMissingOutputTokens: 0,
  };
}

interface RawEntry {
  v?: unknown;
  ts: unknown;
  dur: unknown;
  sid: unknown;
  type: unknown;
  name: unknown;
  status: unknown;
  attrs?: unknown;
}

/** Minimal structural check: the fields every entry type carries. */
function asEntry(line: string): RawEntry | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const raw = parsed as RawEntry;
  if (typeof raw.ts !== 'number' || typeof raw.sid !== 'string' || typeof raw.type !== 'string') {
    return undefined;
  }
  return raw;
}

function attrsOf(raw: RawEntry): Record<string, unknown> {
  return typeof raw.attrs === 'object' && raw.attrs !== null && !Array.isArray(raw.attrs)
    ? (raw.attrs as Record<string, unknown>)
    : {};
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Accumulate a probe over one file's contents. Pass the previous result to
 * fold several files (a session directory, or a whole window) into one report.
 */
export function probeDebugLog(text: string, into: DebugLogProbe = emptyProbe()): DebugLogProbe {
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    const raw = asEntry(line);
    if (raw === undefined) {
      into.malformed += 1;
      continue;
    }
    into.entries += 1;

    const version = typeof raw.v === 'number' ? raw.v : 1;
    if (!into.versions.includes(version)) {
      into.versions.push(version);
      into.versions.sort((a, b) => a - b);
    }
    if (version > KNOWN_SCHEMA_VERSION) {
      into.unknownSchema = true;
    }

    const type = raw.type as string;
    into.byType[type] = (into.byType[type] ?? 0) + 1;
    if (
      !(KNOWN_ENTRY_TYPES as readonly string[]).includes(type) &&
      !into.unknownTypes.includes(type)
    ) {
      into.unknownTypes.push(type);
    }

    const attrs = attrsOf(raw);
    const seen = into.attrsByType[type] ?? [];
    for (const key of Object.keys(attrs)) {
      if (!seen.includes(key)) {
        seen.push(key);
      }
    }
    seen.sort();
    into.attrsByType[type] = seen;

    if (type === 'llm_request') {
      if (tokenCount(attrs['inputTokens']) === undefined) {
        into.requestsMissingInputTokens += 1;
      }
      if (tokenCount(attrs['outputTokens']) === undefined) {
        into.requestsMissingOutputTokens += 1;
      }
    }
  }
  return into;
}

/**
 * Model calls from one file's contents, oldest first.
 *
 * Entries other than `llm_request` are skipped, as is anything malformed —
 * a partially flushed tail line is normal, since the writer appends on a timer.
 */
export function readLlmRequests(text: string, sinceMs?: number): LlmRequest[] {
  const requests: LlmRequest[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    const raw = asEntry(line);
    if (raw === undefined || raw.type !== 'llm_request') {
      continue;
    }
    const ts = raw.ts as number;
    if (sinceMs !== undefined && ts < sinceMs) {
      continue;
    }
    const attrs = attrsOf(raw);
    const model = attrs['model'];
    const request: LlmRequest = {
      ts,
      sessionId: raw.sid as string,
      model: typeof model === 'string' && model !== '' ? model : 'unknown',
      durationMs: typeof raw.dur === 'number' ? raw.dur : 0,
      status: raw.status === 'error' ? 'error' : 'ok',
    };
    const inputTokens = tokenCount(attrs['inputTokens']);
    if (inputTokens !== undefined) {
      request.inputTokens = inputTokens;
    }
    const cachedTokens = tokenCount(attrs['cachedTokens']);
    if (cachedTokens !== undefined) {
      request.cachedTokens = cachedTokens;
    }
    const outputTokens = tokenCount(attrs['outputTokens']);
    if (outputTokens !== undefined) {
      request.outputTokens = outputTokens;
    }
    const nanoAiu = tokenCount(attrs['copilotUsageNanoAiu']);
    if (nanoAiu !== undefined) {
      request.nanoAiu = nanoAiu;
    }
    requests.push(request);
  }
  return requests.sort((a, b) => a.ts - b.ts);
}
