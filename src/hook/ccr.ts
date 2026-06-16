import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { constants as fsConstants, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';

// CCR stash store — the durable half of "lossy on the wire, lossless on demand"
// (internal/CCR-PLAN.md §1/§6). When a transform cuts content from a NON-FILE
// output the hook will (Phase 2, not wired here) stash the exact omitted bytes
// keyed by hash(content) and embed the handle in the omission marker; the model
// retrieves the exact slice back instead of re-running the command. This module
// is the store ONLY and is CONTENT-AGNOSTIC — it neither knows nor cares that
// the bytes are tool output; the non-file scoping lives at the hook layer.
//
// Modeled on recovery.ts (call-time env-based dir resolution, fire-and-forget
// writes tracked in `pending` for settle-before-exit, tmp+rename atomics,
// opportunistic enumeration-based sweeping, sessionId sanitization, kill
// switch). The crucial simplification over recovery.ts: chunk files are
// WRITE-ONCE (a handle's bytes never change, since the handle IS their hash),
// so there is NO read-modify-write and NO per-file write chaining — a write
// either lands once or is skipped as a dedup hit.
//
// Layout: <root>/<session>/<handle>. Session-scoping makes whole-session
// eviction a single fs.rm of a directory; the root carries a SENTINEL file so
// the sweep can prove ownership before deleting anything. Retrieval is
// SESSION-LESS by necessity — the CLI `compressor retrieve` process that reads
// a handle back has no session id — so readChunk searches across session dirs.
//
// SECURITY (CCR-PLAN.md §6): deletion is the sharp edge, so no path-to-delete
// is ever supplied from outside. Handles from the model are validated against a
// strict allowlist (reject, never sanitize) then realpath-confined and symlink-
// refused; session ids from the payload are sanitized like recovery.ts. The
// sweep DISCOVERS its targets by enumerating the owned root and never accepts a
// caller-supplied target; it refuses known-sensitive roots and any root lacking
// our sentinel. There is no public evict/delete-by-id surface.
//
// FAIL-OPEN everywhere (mirror recovery.ts): any fs/hash/parse error behaves as
// if CCR is off — stashChunk still returns a handle (the marker can carry it; a
// miss at retrieve time just falls back to today's re-run hint), readChunk
// returns null, sweep is a no-op. CCR trouble is never the agent's problem.

/** Stash entries untouched this long are swept opportunistically (default 6h). */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/** Per-session caps; the oldest chunk files over either cap are evicted first. */
const MAX_BYTES_PER_SESSION = 8 * 1024 * 1024;
const MAX_ENTRIES_PER_SESSION = 512;

/** Throttle for the opportunistic sweep — at most one enumeration per window. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Sentinel file at the root: proof of ownership the sweep checks before deleting. */
const SENTINEL = '.compressor-ccr';

/** A valid content handle: base64url of a sha256 prefix → exactly these chars. */
const HANDLE_RE = /^[A-Za-z0-9_-]{16}$/;

/** Session-dir naming: the same sanitized alphabet sessionDir() can ever emit. */
const SESSION_DIR_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** Kill switch: COMPRESSOR_NO_CCR=1 turns the stash fully off (writes and reads). */
export function ccrDisabled(): boolean {
  return process.env['COMPRESSOR_NO_CCR'] === '1';
}

/**
 * Apply a `--ccr <on|off>` argv override by setting the env var the kill switch
 * (ccrDisabled) reads at call time — argv wins over env with zero signature
 * churn through the protocol layers, exactly like recovery.ts's
 * applyRecoveryBudgetArg. Benchmarks use this to vary CCR PER ARM in ONE run
 * (`--hook-arg-arms "ccr-on=,ccr-off=--ccr off"`): the env is global to a run,
 * but hook commands are per-variant, so the flag toggles the kill switch for
 * just that arm's hook invocations.
 *
 * Fail-open: a missing or unrecognized value changes nothing (the env-level
 * kill switch keeps whatever it already was). `off` sets COMPRESSOR_NO_CCR=1;
 * `on` deletes it (so a later `on` arm re-enables after an `off` arm in the
 * same process, argv-wins-deterministic, mirroring the recovery toggle).
 */
export function applyCcrArg(argv: readonly string[]): void {
  const idx = argv.indexOf('--ccr');
  const value = idx === -1 ? undefined : argv[idx + 1]?.trim();
  if (value === 'off') {
    process.env['COMPRESSOR_NO_CCR'] = '1';
    return;
  }
  if (value === 'on') {
    delete process.env['COMPRESSOR_NO_CCR'];
  }
}

/** Resolved at call time (not module load) so tests can swap the env var. */
export function resolveCcrDir(): string {
  return process.env['COMPRESSOR_CCR_DIR'] ?? path.join(os.tmpdir(), 'compressor-ccr');
}

/**
 * TTL in MILLISECONDS from COMPRESSOR_CCR_TTL (a positive integer count of ms;
 * the env value's unit is ms to match the constant and recovery.ts's epoch-ms
 * convention). Anything else — unset, empty, zero, negative, fractional, junk —
 * falls back to the 6h default.
 */
export function ccrTtlMs(): number {
  const raw = process.env['COMPRESSOR_CCR_TTL'];
  if (raw === undefined) {
    return DEFAULT_TTL_MS;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return DEFAULT_TTL_MS;
  }
  const value = Number(trimmed);
  return value > 0 ? value : DEFAULT_TTL_MS;
}

/**
 * The content handle for a chunk: a sha256 prefix in base64url. base64url emits
 * only [A-Za-z0-9_-] (no '/', '+', or '=' padding), so a 16-char slice always
 * matches HANDLE_RE — no path separators, no traversal characters can appear in
 * a handle we mint. Deterministic ⇒ identical chunks share a handle (dedup) and
 * markers stay byte-stable (prompt-cache friendly). Sync — hashing is sync.
 */
export function handleFor(text: string): string {
  return createHash('sha256').update(text).digest('base64url').slice(0, 16);
}

/**
 * Session subdir name, sanitized for the filesystem exactly like recovery.ts's
 * sessionFile. Hostile or unusable ids (empty, dot-names, absurd length) return
 * null — the stash silently deactivates for that call rather than risking a path
 * surprise. Sanitization collisions between distinct ids are harmless: a chunk
 * is content-addressed, so a shared session dir only ever co-locates chunks, it
 * never corrupts one.
 */
function sessionDir(root: string, sessionId: string): string | null {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
  if (safe === '' || safe === '.' || safe === '..' || safe.length > 128) {
    return null;
  }
  return path.join(root, safe);
}

/**
 * True only when `p` lies strictly inside the directory `base` (an already-
 * resolved/canonical path) — the realpath-confinement assert from §6. The
 * trailing separator ensures a sibling like `<base>-evil` can't match as a mere
 * string prefix of `<base>`. Callers pass a CANONICAL base (realpathOf(root))
 * and, for the final assert, a CANONICAL p (realpathSync of the candidate), so
 * a root whose own ancestor is a symlink (e.g. macOS /var → /private/var) is
 * handled correctly while any symlink escaping the canonical root still fails.
 */
function confinedTo(base: string, p: string): boolean {
  return (path.resolve(p) + path.sep).startsWith(path.resolve(base) + path.sep);
}

/**
 * Canonical (symlink-resolved) form of a path, falling back to a plain resolve
 * when the path does not yet exist or cannot be canonicalized — so callers get
 * a stable base to confine against regardless of fs state.
 */
function realpathOf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * A known-sensitive root the sweep must NEVER operate on, even if a
 * misconfigured COMPRESSOR_CCR_DIR points there: the user's home, the
 * filesystem root, and the process cwd. Compared on CANONICAL (realpath)
 * paths — via the same realpathOf() the read path uses — so `~/.`, trailing
 * slashes, `.`, AND a symlink whose target is one of these sensitive dirs all
 * normalize to the same canonical string and are refused. realpathOf falls
 * back to path.resolve when a path can't be canonicalized, preserving the
 * lexical normalization while also catching symlinked equivalents.
 */
function sensitiveRoot(root: string): boolean {
  const resolved = realpathOf(root);
  // the filesystem root is derived from the canonical resolved value
  const forbidden = [os.homedir(), path.parse(resolved).root, process.cwd()];
  return forbidden.some((f) => {
    try {
      return realpathOf(f) === resolved;
    } catch {
      return false;
    }
  });
}

// In-process write discipline, mirroring recovery.ts/the ledger writer: every
// write is fire-and-forget and tracked in `pending` so settleCcr() can flush it
// before the process exits. Write-once means no per-file chaining is needed —
// concurrent writes of the SAME handle race harmlessly to the same final bytes
// (each writes its own uniquely-named tmp then renames; the loser's rename just
// replaces identical content).
const pending = new Set<Promise<void>>();

function track(task: Promise<void>): void {
  const guarded = task.then(
    () => undefined,
    () => undefined,
  );
  pending.add(guarded);
  void guarded.finally(() => {
    pending.delete(guarded);
  });
}

/**
 * Resolves when all stash writes in flight at call time have finished (each
 * task swallows its own errors, so this never rejects). The shared exit path
 * (settleThenExit) races this — alongside settleLedger/settleRecovery — against
 * the 250ms cap, so a stuck disk can never hang the agent on a CCR write.
 */
export async function settleCcr(): Promise<void> {
  try {
    await Promise.all([...pending]);
  } catch {
    // unreachable (tasks never reject), kept for fail-open symmetry
  }
}

// Last-sweep marker (in-process) so the opportunistic GC runs at most once per
// SWEEP_INTERVAL_MS instead of on every stash. Cheap gate; the actual sweep is
// fully enumeration-based and idempotent.
let lastSweepAt = 0;

/**
 * Write one chunk file at <root>/<session>/<handle>, IF ABSENT (write-once ⇒
 * dedup: an existing file is left untouched and the write is skipped). Ensures
 * the owned root + session dir exist (0700) and the root carries our sentinel.
 * tmp+rename keeps a SIGKILL from the exit cap from leaving a torn chunk as the
 * durable file. Best-effort: any error is swallowed (the handle was already
 * returned to the caller).
 */
async function writeChunk(root: string, dir: string, handle: string, text: string): Promise<void> {
  try {
    const target = path.join(dir, handle);
    try {
      // write-once: a present file is a dedup hit, nothing to do
      await stat(target);
      return;
    } catch {
      // absent → fall through and write it
    }
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // (re)assert the sentinel so an enumeration sweep can prove ownership
    await writeFile(path.join(root, SENTINEL), '', { mode: 0o600 }).catch(() => undefined);
    const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, text, { mode: 0o600 });
    await rename(tmp, target);
  } catch {
    // FAIL-OPEN: a stash trouble only costs a future retrieve miss.
  }
}

/**
 * Stash one chunk and return its handle (sync — the hash is sync; the file
 * write is fire-and-forget). The handle is ALWAYS returned, even if writing is
 * disabled or fails, so the marker can carry it: a later retrieve miss simply
 * falls back to today's re-run hint (fail-open by construction). The session id
 * scopes the chunk's directory for cheap whole-session eviction; a hostile or
 * unusable id skips the write (handle still returned).
 */
export function stashChunk(sessionId: string, text: string): string {
  // The hash itself can THROW at the untyped JSON/tool-output boundary (e.g.
  // createHash().update(non-string) → TypeError), so it must sit INSIDE the
  // try — line 238 outside it would let that throw escape into the hook,
  // violating this function's never-propagate invariant and §1 fail-open.
  let handle = '';
  try {
    handle = handleFor(text);
    if (ccrDisabled()) {
      return handle;
    }
    const root = resolveCcrDir();
    const dir = sessionDir(root, sessionId);
    if (dir === null) {
      return handle;
    }
    track(writeChunk(root, dir, handle, text));
    maybeSweep(dir);
  } catch {
    // FAIL-OPEN: never let stash trouble propagate to the caller. A thrown
    // hash (bad input) yields the '' fallback handle — a guaranteed retrieve
    // miss, which just degrades to today's re-run hint.
  }
  return handle;
}

/**
 * Resolve a validated handle to a real, confined, non-symlink chunk file under
 * `root` by SEARCHING the session dirs (retrieval has no session id). Returns
 * the readable path or null. Every guard from §6 is applied per candidate:
 * realpath confinement, lstat symlink refusal on both the session dir and the
 * file. Enumeration is sync (one shallow readdir) — readChunk is sync-friendly
 * and only reads bytes async below.
 */
function locateChunk(root: string, handle: string): string | null {
  try {
    // the root itself must be a real dir, or there is nothing to read. The
    // CANONICAL root is the confinement boundary (handles a symlinked ancestor
    // like macOS /var → /private/var without ever following a symlink we plant
    // INSIDE the root — those are caught by the per-entry lstat refusals below).
    if (!lstatSync(root).isDirectory()) {
      return null;
    }
    const realRoot = realpathOf(root);
    for (const session of readdirSync(root)) {
      if (!SESSION_DIR_RE.test(session)) {
        continue;
      }
      const dir = path.join(root, session);
      try {
        // refuse a symlinked session dir — lstat (no follow) reports a symlink
        // as a symlink, never a directory, so !isDirectory() rejects it.
        const dirInfo = lstatSync(dir);
        if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }
      const candidate = path.join(dir, handle);
      try {
        const info = lstatSync(candidate);
        // refuse a symlinked chunk file (no following outside the root) and
        // anything that isn't a plain file
        if (info.isSymbolicLink() || !info.isFile()) {
          continue;
        }
        // realpath-confinement assert: the canonical candidate must lie inside
        // the canonical root (defends against a symlinked ancestor we didn't
        // lstat individually). Compares canonical-vs-canonical — see confinedTo.
        if (!confinedTo(realRoot, realpathSync(candidate))) {
          continue;
        }
        return candidate;
      } catch {
        // candidate absent in this session dir → try the next
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Slice a chunk by a 1-based inclusive line range. When the chunk carries Read
 * "N→" coordinate prefixes (the format file/agent reads embed), the range is
 * matched against those ORIGINAL line numbers so a request for "lines 400-410"
 * lands on the original coordinates; otherwise the range indexes positions
 * within the chunk (1 = first line of the chunk). A range that selects nothing
 * yields '' (still a non-null hit — the handle was valid).
 */
function sliceLines(text: string, range: { start: number; end: number }): string {
  const lines = text.split('\n');
  const start = Math.max(1, Math.floor(range.start));
  const end = Math.floor(range.end);
  if (end < start) {
    return '';
  }
  // detect embedded "N→" Read prefixes (e.g. "  123→const x")
  const prefixed = lines.every((line) => line === '' || /^\s*\d+→/.test(line));
  if (prefixed) {
    return lines
      .filter((line) => {
        const match = /^\s*(\d+)→/.exec(line);
        if (match === null) {
          return false;
        }
        const n = Number(match[1]);
        return n >= start && n <= end;
      })
      .join('\n');
  }
  // chunk-relative: 1-based inclusive positions within the chunk
  return lines.slice(start - 1, end).join('\n');
}

/**
 * Read a file WITHOUT following a symlink at its final component — the
 * TOCTOU-hardened read for the model-facing path. locateChunk validates a
 * candidate by PATH (lstat no-follow + realpath confinement) and returns a path
 * STRING; re-opening that path by NAME would re-resolve it and could follow a
 * symlink swapped in AFTER the check (a check→use race). Opening with O_NOFOLLOW
 * makes check-and-use atomic on one inode: a symlinked final component fails the
 * open (ELOOP), and fstat on the fd confirms a regular file before any bytes are
 * read. O_NOFOLLOW is POSIX; where it is unavailable (Windows, where
 * fs.constants.O_NOFOLLOW is undefined) this degrades to a plain open — accepted,
 * since the shared-uid tmpdir threat model is POSIX. Returns null on a symlink,
 * a non-regular file, or any error (fail-open).
 */
async function readFileNoFollow(file: string): Promise<string | null> {
  let fh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fh = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    if (!(await fh.stat()).isFile()) {
      return null;
    }
    return await fh.readFile('utf8');
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

// Exported under a leading-underscore alias ONLY for the module's own TOCTOU test
// (parity with _clearAllForTest); NOT part of any model- or user-facing API.
export { readFileNoFollow as _readFileNoFollowForTest };

/**
 * Retrieve the exact bytes for a handle, or a 1-based inclusive line sub-range.
 * The handle is VALIDATED against the strict allowlist and REJECTED (null) if
 * it doesn't match — a handle is never sanitized, because a sanitized handle is
 * no longer the hash of anything and a malformed one (`../`, absolute, overlong)
 * is an attack, not a typo. Returns null on a kill switch, validation failure,
 * miss, or any error (fail-open). Path safety lives in locateChunk; the final
 * read is O_NOFOLLOW-hardened (readFileNoFollow) to close the lstat→read
 * symlink-swap TOCTOU.
 */
export async function readChunk(
  handle: string,
  lines?: { start: number; end: number },
): Promise<string | null> {
  try {
    if (ccrDisabled()) {
      return null;
    }
    // strict allowlist — reject, never sanitize
    if (typeof handle !== 'string' || !HANDLE_RE.test(handle)) {
      return null;
    }
    const root = resolveCcrDir();
    const file = locateChunk(root, handle);
    if (file === null) {
      return null;
    }
    const text = await readFileNoFollow(file);
    if (text === null) {
      return null;
    }
    if (lines === undefined) {
      return text;
    }
    return sliceLines(text, lines);
  } catch {
    return null;
  }
}

/** A session dir whose contents the cap-eviction may trim, with its file list. */
interface SessionFiles {
  dir: string;
  files: Array<{ path: string; mtimeMs: number; size: number }>;
}

/**
 * Enumerate the real, our-named, non-symlink session dirs under `root` along
 * with their plain chunk files. Used by the sweep; sync (shallow walk) and
 * best-effort per entry.
 */
function enumerateSessions(root: string): SessionFiles[] {
  const out: SessionFiles[] = [];
  for (const session of readdirSync(root)) {
    if (!SESSION_DIR_RE.test(session)) {
      continue;
    }
    const dir = path.join(root, session);
    try {
      // must be a REAL directory (skip symlinks — never follow them)
      if (!lstatSync(dir).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    const files: SessionFiles['files'] = [];
    try {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        try {
          const info = lstatSync(p);
          if (info.isFile()) {
            files.push({ path: p, mtimeMs: info.mtimeMs, size: info.size });
          }
        } catch {
          // best-effort per file
        }
      }
    } catch {
      // unreadable session dir → no files to cap
    }
    out.push({ dir, files });
  }
  return out;
}

/**
 * Enforce the per-session byte/entry cap by evicting the OLDEST chunk files
 * (by mtime) until both caps are satisfied. fs.rm with a path argument — no
 * shell, no glob. Best-effort.
 */
async function capSession(session: SessionFiles): Promise<void> {
  const sorted = [...session.files].sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
  let bytes = sorted.reduce((sum, f) => sum + f.size, 0);
  let count = sorted.length;
  for (const f of sorted) {
    if (bytes <= MAX_BYTES_PER_SESSION && count <= MAX_ENTRIES_PER_SESSION) {
      break;
    }
    try {
      await rm(f.path, { force: true });
      bytes -= f.size;
      count -= 1;
    } catch {
      // best-effort per file
    }
  }
}

/**
 * Enumeration-based GC of the owned root (§6). Discovers its targets — never
 * accepts a caller-supplied path to delete. For each REAL, our-named session
 * dir: if older than ccrTtlMs() by mtime AND not keepSession, remove the whole
 * dir via fs.rm (recursive, force; NO shell, NO glob); otherwise enforce the
 * per-session byte/entry cap (oldest chunks out). REFUSES to operate unless the
 * root is non-sensitive AND carries our sentinel — a misconfigured
 * COMPRESSOR_CCR_DIR can never cause foreign deletion. Depth-1 only (no
 * input-driven recursion). Never throws (fail-open).
 *
 * `keepSession` only EXCLUDES the live session from TTL removal (mirrors
 * recovery.ts's `keep`); it never selects a target to delete.
 */
export async function sweep(keepSession?: string): Promise<void> {
  try {
    if (ccrDisabled()) {
      return;
    }
    const root = resolveCcrDir();
    // refuse a root whose FINAL component is a symlink — a symlinked
    // COMPRESSOR_CCR_DIR could otherwise let an enumeration delete real children
    // inside its target. lstat (no follow) reports the link as a link. NB: a
    // symlinked ANCESTOR (e.g. macOS /var → /private/var) is fine and handled by
    // canonicalizing below — only the root entry itself being a link is refused.
    try {
      if (lstatSync(root).isSymbolicLink()) {
        return;
      }
    } catch {
      // root absent/unstattable → nothing to sweep
      return;
    }
    // operate on the CANONICAL root throughout (parity with locateChunk's read
    // path), so a symlinked ancestor resolves correctly while any escaping path
    // still fails the per-delete confinement assert below.
    const realRoot = realpathOf(root);
    // refuse known-sensitive roots outright, compared on the CANONICAL root so a
    // symlink to $HOME/cwd/'/' is refused too (sensitiveRoot canonicalizes).
    if (sensitiveRoot(realRoot)) {
      return;
    }
    // ownership proof: the sentinel must be a real file directly under the root
    try {
      const sentinel = path.join(realRoot, SENTINEL);
      if (!lstatSync(sentinel).isFile()) {
        return;
      }
    } catch {
      // no sentinel → not our root → refuse to touch it
      return;
    }
    const keepDir =
      keepSession === undefined ? null : (sessionDir(realRoot, keepSession) ?? null);
    const cutoff = Date.now() - ccrTtlMs();
    for (const session of enumerateSessions(realRoot)) {
      try {
        if (keepDir !== null && path.resolve(session.dir) === path.resolve(keepDir)) {
          // live session: never TTL-remove it; still cap it below
          await capSession(session);
          continue;
        }
        const info = statSync(session.dir);
        if (info.mtimeMs < cutoff) {
          // realpath-confinement assert, parity with locateChunk's read path:
          // the canonical session dir must lie strictly inside the canonical
          // root before we ever rm it. A symlinked child (already skipped by
          // enumerateSessions' lstat) or any escaping path is refused here too.
          if (!confinedTo(realRoot, realpathSync(session.dir))) {
            continue;
          }
          // stale → remove the whole session dir (path argument, no shell)
          await rm(session.dir, { recursive: true, force: true });
        } else {
          await capSession(session);
        }
      } catch {
        // best-effort per session
      }
    }
  } catch {
    // FAIL-OPEN: GC is best-effort; worst case is "didn't clean up."
  }
}

/**
 * Opportunistic sweep gated by the cheap in-process last-sweep marker so it does
 * not run on every stash. Fire-and-forget and tracked so settleCcr() waits on
 * it. The marker is advanced BEFORE the async sweep so a burst of stashes in the
 * same window triggers exactly one enumeration.
 */
function maybeSweep(keepDir: string): void {
  try {
    const now = Date.now();
    if (now - lastSweepAt < SWEEP_INTERVAL_MS) {
      return;
    }
    lastSweepAt = now;
    // recover the session name from the dir to pass as keepSession (exclude-only);
    // sweep() re-resolves the root from the env at call time.
    track(sweep(path.basename(keepDir)));
  } catch {
    // FAIL-OPEN
  }
}

/**
 * Remove the ENTIRE owned root (NO argument — the future no-arg
 * `compressor ccr clear`). Internal: not part of the model-facing surface and
 * never takes a target, so there is no traversal entry point. Refuses sensitive
 * roots and any root lacking our sentinel, exactly like sweep(). Best-effort.
 */
async function clearAll(): Promise<void> {
  try {
    const root = resolveCcrDir();
    // refuse a root whose FINAL component is a symlink (parity with sweep):
    // never rm through a symlink to wipe its target. A symlinked ancestor is
    // fine — canonicalized below.
    try {
      if (lstatSync(root).isSymbolicLink()) {
        return;
      }
    } catch {
      return;
    }
    const realRoot = realpathOf(root);
    // sensitive-root refusal on the CANONICAL root (sensitiveRoot canonicalizes)
    if (sensitiveRoot(realRoot)) {
      return;
    }
    try {
      if (!lstatSync(path.join(realRoot, SENTINEL)).isFile()) {
        return;
      }
    } catch {
      return;
    }
    await rm(realRoot, { recursive: true, force: true });
  } catch {
    // FAIL-OPEN
  }
}

// clearAll backs a future no-arg `compressor ccr clear`; unexported in Phase 1
// (no CLI surface yet) and never takes a target, so there is no traversal entry
// point. Exported under a leading-underscore alias only so the module's own
// adversarial test can assert it refuses sensitive/sentinel-less roots — it is
// NOT part of the model- or user-facing API and must not be called elsewhere.
export { clearAll as _clearAllForTest };

/**
 * Reset the in-process opportunistic-sweep throttle marker. TEST-ONLY (leading
 * underscore): the throttle is a module-global that earlier tests advance, so a
 * deterministic throttle test must reset it to a known state. Not part of any
 * model- or user-facing API.
 */
export function _resetSweepThrottleForTest(): void {
  lastSweepAt = 0;
}
