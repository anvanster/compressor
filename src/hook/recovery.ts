import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';

// Recovery-read budget state — the structural fix for the measured pagination
// bimodality (bench-20260610-114234/-181302): after the hook truncates a big
// read, the model sometimes recovers the omitted content via offset/limit
// pagination, and because targeted reads pass through uncompressed BY DESIGN
// the loop re-acquires everything (worst cells exceeded the uncompressed
// baseline). Marker phrasing was measured dead. Instead: recovery stays
// legitimate in moderation — the first N targeted reads of a previously
// truncated file pass through, the N+1th gets compressed like any other read.
//
// State is session-scoped JSON under os.tmpdir()/compressor-recovery (one
// file per session id; override dir via COMPRESSOR_RECOVERY_DIR for tests).
// EVERYTHING here is FAIL-OPEN: any fs/parse error behaves as if no state
// exists, which only ever means "pass through as today". Writes follow the
// ledger's fire-and-forget + settle pattern (src/ledger/write.ts): callers
// never await on the hot path; the shared exit path (src/hook/exit.ts) races
// settleRecovery() against the 250ms cap before the process exits.
//
// Known acceptable race: concurrent hook processes (parallel tool calls) can
// lose an increment to last-writer-wins. Undercounting only grants extra
// passthrough — the conservative direction for a budget heuristic.

interface FileRecord {
  /** epoch ms of the most recent content-cutting compression of this file */
  truncatedAt: number;
  /** targeted (offset/limit) reads of this file since it was first truncated */
  recoveryReads: number;
}

interface SessionRecord {
  files: Record<string, FileRecord>;
  updatedAt: number;
}

/** Targeted reads of a truncated file that pass through before compression kicks in. */
export const DEFAULT_RECOVERY_BUDGET = 3;

/** A truncation record older than this no longer constrains targeted reads. */
const FILE_ENTRY_TTL_MS = 6 * 60 * 60 * 1000;
/** Session state files untouched this long are deleted opportunistically. */
const SESSION_FILE_TTL_MS = 24 * 60 * 60 * 1000;
/** Cap per-session record size; oldest truncation entries are dropped first. */
const MAX_FILES_PER_SESSION = 200;

/** Kill switch: COMPRESSOR_NO_RECOVERY_BUDGET=1 turns the feature fully off. */
export function recoveryDisabled(): boolean {
  return process.env['COMPRESSOR_NO_RECOVERY_BUDGET'] === '1';
}

/**
 * Apply a `--recovery-budget <n|off>` argv override by setting the env vars
 * the resolvers above read at call time — argv wins over env with zero
 * signature churn through the protocol layers. Benchmarks use this to vary
 * the budget PER ARM (env is global to a run; hook commands are per-variant).
 * Fail-open: a missing or invalid value changes nothing.
 */
export function applyRecoveryBudgetArg(argv: readonly string[]): void {
  const idx = argv.indexOf('--recovery-budget');
  const value = idx === -1 ? undefined : argv[idx + 1]?.trim();
  if (value === undefined || value === '') {
    return;
  }
  if (value === 'off') {
    process.env['COMPRESSOR_NO_RECOVERY_BUDGET'] = '1';
    return;
  }
  if (/^\d+$/.test(value)) {
    process.env['COMPRESSOR_RECOVERY_BUDGET'] = value;
    delete process.env['COMPRESSOR_NO_RECOVERY_BUDGET'];
  }
}

/**
 * Budget from COMPRESSOR_RECOVERY_BUDGET: a non-negative integer (0 =
 * compress ALL targeted reads of truncated files). Anything else — unset,
 * empty, negative, fractional, junk — falls back to the measured default.
 */
export function recoveryBudget(): number {
  const raw = process.env['COMPRESSOR_RECOVERY_BUDGET'];
  if (raw === undefined) {
    return DEFAULT_RECOVERY_BUDGET;
  }
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : DEFAULT_RECOVERY_BUDGET;
}

/** Resolved at call time (not module load) so tests can swap the env var. */
export function resolveRecoveryDir(): string {
  return process.env['COMPRESSOR_RECOVERY_DIR'] ?? path.join(os.tmpdir(), 'compressor-recovery');
}

/**
 * State file for a session id, sanitized for the filesystem. Hostile or
 * unusable ids (empty, dot-names, absurd length) return null — the feature
 * silently deactivates rather than risking a path surprise. Sanitization
 * collisions between distinct ids are harmless for a budget heuristic.
 */
function sessionFile(dir: string, sessionId: string): string | null {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
  if (safe === '' || safe === '.' || safe === '..' || safe.length > 128) {
    return null;
  }
  return path.join(dir, `${safe}.json`);
}

function isRec(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse + validate state JSON; malformed documents/entries vanish (fail-open). */
function parseState(json: string): SessionRecord | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isRec(parsed) || !isRec(parsed['files'])) {
      return null;
    }
    const files: Record<string, FileRecord> = {};
    for (const [key, value] of Object.entries(parsed['files'])) {
      if (
        isRec(value) &&
        typeof value['truncatedAt'] === 'number' &&
        typeof value['recoveryReads'] === 'number'
      ) {
        files[key] = {
          truncatedAt: value['truncatedAt'],
          recoveryReads: value['recoveryReads'],
        };
      }
    }
    const updatedAt = typeof parsed['updatedAt'] === 'number' ? parsed['updatedAt'] : 0;
    return { files, updatedAt };
  } catch {
    return null;
  }
}

/** A file entry that exists AND is still within the truncation TTL. */
function freshEntry(state: SessionRecord, filePath: string): FileRecord | undefined {
  const entry = state.files[filePath];
  if (entry === undefined || Date.now() - entry.truncatedAt > FILE_ENTRY_TTL_MS) {
    return undefined;
  }
  return entry;
}

/**
 * Synchronous budget check for the hot path: true only when this session has
 * a live truncation record for the file AND its recovery reads have reached
 * the budget. Every failure mode (no state, torn write, junk JSON, fs error,
 * kill switch) returns false = pass through, exactly today's behavior.
 */
export function recoveryBudgetExceeded(
  sessionId: string,
  filePath: string,
  budget: number,
): boolean {
  try {
    if (recoveryDisabled() || sessionId === '' || filePath === '') {
      return false;
    }
    const file = sessionFile(resolveRecoveryDir(), sessionId);
    if (file === null) {
      return false;
    }
    const state = parseState(readFileSync(file, 'utf8'));
    if (state === null) {
      return false;
    }
    const entry = freshEntry(state, filePath);
    return entry !== undefined && entry.recoveryReads >= budget;
  } catch {
    return false;
  }
}

// In-process write discipline, mirroring the ledger writer: every mutation is
// queued (chained per state file so read-modify-write never races itself) and
// tracked in `pending` so settleRecovery() can flush before exit.
const pending = new Set<Promise<void>>();
const chains = new Map<string, Promise<void>>();

function enqueue(file: string, task: () => Promise<void>): void {
  const prev = chains.get(file) ?? Promise.resolve();
  const next = prev.then(task, task).then(
    () => undefined,
    () => undefined,
  );
  chains.set(file, next);
  pending.add(next);
  void next.finally(() => {
    pending.delete(next);
    if (chains.get(file) === next) {
      chains.delete(file);
    }
  });
}

/**
 * Resolves when all state writes in flight at call time have finished (each
 * task swallows its own errors, so this never rejects). The shared exit path
 * races this — together with settleLedger() — against the 250ms cap.
 */
export async function settleRecovery(): Promise<void> {
  try {
    await Promise.all([...pending]);
  } catch {
    // unreachable (tasks never reject), kept for fail-open symmetry
  }
}

/** Drop entries past the truncation TTL, then cap the record size (oldest out). */
function pruneEntries(state: SessionRecord): void {
  const now = Date.now();
  let entries = Object.entries(state.files).filter(
    ([, record]) => now - record.truncatedAt <= FILE_ENTRY_TTL_MS,
  );
  if (entries.length > MAX_FILES_PER_SESSION) {
    entries.sort((a, b) => b[1].truncatedAt - a[1].truncatedAt);
    entries = entries.slice(0, MAX_FILES_PER_SESSION);
  }
  state.files = Object.fromEntries(entries);
}

/** Opportunistic GC of other sessions' state files; best-effort, never throws. */
async function sweepSessions(dir: string, keep: string): Promise<void> {
  try {
    const cutoff = Date.now() - SESSION_FILE_TTL_MS;
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.json')) {
        continue;
      }
      const file = path.join(dir, name);
      if (file === keep) {
        continue;
      }
      try {
        const info = await stat(file);
        if (info.mtimeMs < cutoff) {
          await rm(file, { force: true });
        }
      } catch {
        // best-effort per file
      }
    }
  } catch {
    // best-effort: a missing/unreadable dir is fine
  }
}

/**
 * Read-modify-write of one session record. `mutate` returns false to skip the
 * write entirely (e.g. counting a read of a never-truncated file must not
 * create state). Writes go through tmp+rename so a SIGKILL from the exit
 * cap can never leave a torn file as the durable state.
 */
async function updateState(
  dir: string,
  file: string,
  mutate: (state: SessionRecord) => boolean,
): Promise<void> {
  try {
    let state: SessionRecord | null = null;
    try {
      state = parseState(await readFile(file, 'utf8'));
    } catch {
      // missing or unreadable → fresh record
    }
    const record = state ?? { files: {}, updatedAt: 0 };
    if (!mutate(record)) {
      return;
    }
    pruneEntries(record);
    record.updatedAt = Date.now();
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(record), 'utf8');
    await rename(tmp, file);
    await sweepSessions(dir, file);
  } catch {
    // FAIL-OPEN: state problems are never the agent's problem.
  }
}

/**
 * Record that the hook cut content from a READ of filePath (truncate or
 * skeleton actually ran). Fire-and-forget. An existing live record keeps its
 * recoveryReads counter — resetting it on the re-truncation of a
 * budget-exceeded read would restart the budget and re-open the pagination
 * loop the feature exists to close.
 */
export function noteTruncation(sessionId: string, filePath: string): void {
  try {
    if (recoveryDisabled() || sessionId === '' || filePath === '') {
      return;
    }
    const dir = resolveRecoveryDir();
    const file = sessionFile(dir, sessionId);
    if (file === null) {
      return;
    }
    enqueue(file, () =>
      updateState(dir, file, (state) => {
        const prior = freshEntry(state, filePath);
        state.files[filePath] = {
          truncatedAt: Date.now(),
          recoveryReads: prior?.recoveryReads ?? 0,
        };
        return true;
      }),
    );
  } catch {
    // FAIL-OPEN
  }
}

/**
 * Count one targeted read of filePath against its recovery budget.
 * Fire-and-forget. Reads of files with no live truncation record are NOT
 * counted and create no state — only recovery of previously-cut content is
 * budgeted.
 */
export function noteRecoveryRead(sessionId: string, filePath: string): void {
  try {
    if (recoveryDisabled() || sessionId === '' || filePath === '') {
      return;
    }
    const dir = resolveRecoveryDir();
    const file = sessionFile(dir, sessionId);
    if (file === null) {
      return;
    }
    enqueue(file, () =>
      updateState(dir, file, (state) => {
        const entry = freshEntry(state, filePath);
        if (entry === undefined) {
          return false;
        }
        entry.recoveryReads += 1;
        return true;
      }),
    );
  } catch {
    // FAIL-OPEN
  }
}
