import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { PROJECT_LABEL_MAX } from './write.ts';

// Shared project labelling for every writer into the ledger: the VS Code
// extension and the CLI hooks must produce the SAME label for the same folder,
// or one project appears twice in the 'by project' breakdown. That means one
// algorithm and one key, which is why both live here rather than in a consumer.
//
// The key is deliberately NOT in the ledger directory. A savings report (and
// sometimes the ledger itself) gets shared; if the key travelled with it, a
// recipient could hash candidate project names until one matched, and plausible
// project names are a small, guessable space. Keeping the key in a fixed home
// location means a shared ledger carries digests nobody else can test against.

export type ProjectLabelMode = 'hashed' | 'name';

/** Settings and env are user-editable text: anything odd keeps the safe mode. */
export function normalizeProjectLabelMode(value: unknown): ProjectLabelMode {
  return value === 'name' ? 'name' : 'hashed';
}

/** Marks a digest, so a ledger that mixes modes stays readable. */
export const HASHED_PREFIX = '#';

const SALT_BYTES = 32;
const SALT_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Fixed home location, never derived from COMPRESSOR_LEDGER_DIR: the ledger
 * directory is the shareable unit, so the key must not sit inside it.
 */
export function resolveProjectSaltPath(): string {
  return (
    process.env['COMPRESSOR_PROJECT_SALT'] ??
    path.join(os.homedir(), '.compressor', 'project-salt')
  );
}

/** The key if one exists and is well-formed; undefined otherwise. */
export async function readProjectSalt(): Promise<string | undefined> {
  try {
    const salt = (await readFile(resolveProjectSaltPath(), 'utf8')).trim();
    return SALT_PATTERN.test(salt) ? salt : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the key, creating it on first use. Hook processes and the extension can
 * race here, so creation is exclusive (`wx`) and a loser re-reads the winner's
 * key rather than overwriting it — two keys would split one project in two.
 *
 * Returns undefined when the key can neither be read nor created (a read-only
 * home, for instance). Callers must then record NO label: an unsalted digest
 * would be brute-forceable, which is the one thing this is here to prevent.
 *
 * Delegates to the synchronous form so the race policy exists exactly once:
 * two copies of "wx, then re-read the winner, then replace a corrupt file"
 * would be two chances to converge on different keys. The work is one 65-byte
 * write, once per machine.
 */
export async function ensureProjectSalt(): Promise<string | undefined> {
  return ensureProjectSaltSync();
}

/**
 * Synchronous read of the key. A hook process often lives for exactly one tool
 * call, so an asynchronous load would miss the only event it will ever record.
 * The file is 65 bytes; reading it costs less than the ledger append it feeds.
 */
export function readProjectSaltSync(): string | undefined {
  try {
    const salt = readFileSync(resolveProjectSaltPath(), 'utf8').trim();
    return SALT_PATTERN.test(salt) ? salt : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the key, creating it on first use, without ever yielding. This is the
 * real implementation of the creation policy; see {@link ensureProjectSalt}.
 *
 * Synchronous because the only caller that creates the key is a hook process,
 * which is terminated (SIGKILL on a slow settle) as soon as its output is
 * delivered: a background creation can be cut between mkdir and write, so the
 * key is never made and every run stays unlabelled. Doing it inline costs one
 * mkdir plus one 65-byte write, once per machine, and labels THIS run.
 */
export function ensureProjectSaltSync(): string | undefined {
  const existing = readProjectSaltSync();
  if (existing !== undefined) {
    return existing;
  }
  const file = resolveProjectSaltPath();
  const salt = randomBytes(SALT_BYTES).toString('hex');
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${salt}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return salt;
  } catch {
    // Either another process won the race, or a file is sitting there that
    // readProjectSaltSync rejected.
  }
  const winner = readProjectSaltSync();
  if (winner !== undefined) {
    return winner; // lost the race: use the key that is already in use
  }
  // A corrupt (or truncated: a hook killed mid-write leaves a zero-byte file)
  // key would otherwise mean no labels ever again, so replace it. Labels
  // written under the previous key remain in the ledger as their own group;
  // that is a cosmetic split, and preferable to recording nothing.
  try {
    writeFileSync(file, `${salt}\n`, { encoding: 'utf8', mode: 0o600, flag: 'w' });
    return salt;
  } catch {
    return undefined; // unwritable home: the caller records no label
  }
}

/**
 * Label for the working directory, for writers with no project of their own —
 * the CLI hooks, where the agent's cwd is the project. Never throws: labelling
 * must never break a hook, so anything unexpected records no label at all.
 *
 * `COMPRESSOR_PROJECT_LABEL=name` opts into clear-text folder names, matching
 * the extension's `compressor.projectLabel` setting. Hashed by default, because
 * a savings report gets shared.
 */
export function currentProjectLabel(cwd: string = process.cwd()): string | undefined {
  try {
    // Mode first: name mode needs no key, so a home directory that cannot be
    // read or written (container, CI, sandboxed agent) must not disable the
    // one labelling mode that never touches it.
    const mode = normalizeProjectLabelMode(process.env['COMPRESSOR_PROJECT_LABEL']);
    if (mode === 'name') {
      return projectLabel(cwd, mode, '');
    }
    // Deliberately uncached: the read is 65 bytes, and a cached key would keep
    // labelling with a stale value after the user rotates it.
    const salt = ensureProjectSaltSync();
    if (salt === undefined) {
      return undefined; // unreadable, unwritable home: an unsalted digest is worse
    }
    return projectLabel(cwd, mode, salt);
  } catch {
    return undefined; // labelling must never break a hook
  }
}

/**
 * One folder, one spelling. Purely textual on purpose: the digest has to come
 * out identical on every platform (see the pinned shared vector in the tests),
 * so this may not reach for `path` (separator- and cwd-dependent) or the
 * filesystem. It closes the two deterministic ways one folder arrives spelled
 * two ways — a trailing separator, and a Windows drive letter in either case —
 * which would otherwise show up as two undistinguishable digest rows.
 */
function canonicalPath(workspacePath: string): string {
  const trimmed = workspacePath.replace(/(?!^)[/\\]+$/, '');
  return /^[a-z]:/.test(trimmed) ? trimmed[0]!.toUpperCase() + trimmed.slice(1) : trimmed;
}

/**
 * The label recorded on a ledger event. Hashed mode keys the digest so it
 * cannot be reproduced without the key; name mode records the folder name only,
 * never the absolute path, and is capped so the reader cannot drop it. Name
 * mode ignores `salt` — it has no key to hide behind.
 */
export function projectLabel(
  workspacePath: string,
  mode: ProjectLabelMode,
  salt: string,
): string {
  const canonical = canonicalPath(workspacePath);
  if (mode === 'name') {
    return path.basename(canonical).slice(0, PROJECT_LABEL_MAX);
  }
  const digest = createHash('sha256')
    .update(salt)
    .update('\0') // domain separator: key and path can never run together
    .update(canonical)
    .digest('hex')
    .slice(0, 12);
  return `${HASHED_PREFIX}${digest}`;
}
