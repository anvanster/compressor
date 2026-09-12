import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
 */
export async function ensureProjectSalt(): Promise<string | undefined> {
  const existing = await readProjectSalt();
  if (existing !== undefined) {
    return existing;
  }
  const file = resolveProjectSaltPath();
  const salt = randomBytes(SALT_BYTES).toString('hex');
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${salt}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return salt;
  } catch {
    // Either another process won the race, or a file is sitting there that
    // readProjectSalt rejected.
  }
  const winner = await readProjectSalt();
  if (winner !== undefined) {
    return winner; // lost the race: use the key that is already in use
  }
  // A corrupt key file would otherwise mean no labels ever again, so replace
  // it. Labels written under the previous key remain in the ledger as their own
  // group; that is a cosmetic split, and preferable to recording nothing.
  try {
    await writeFile(file, `${salt}\n`, { encoding: 'utf8', mode: 0o600, flag: 'w' });
    return salt;
  } catch {
    return undefined; // unwritable home: the caller records no label
  }
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
 * Label for the working directory, for writers with no project of their own —
 * the CLI hooks, where the agent's cwd is the project. Never blocks and never
 * throws: a missing key is created in the background so the next run is
 * labelled, and this run simply records none.
 *
 * `COMPRESSOR_PROJECT_LABEL=name` opts into clear-text folder names, matching
 * the extension's `compressor.projectLabel` setting. Hashed by default, because
 * a savings report gets shared.
 */
export function currentProjectLabel(cwd: string = process.cwd()): string | undefined {
  try {
    // Deliberately uncached: the read is 65 bytes, and a cached key would keep
    // labelling with a stale value after the user rotates it.
    const salt = readProjectSaltSync();
    if (salt === undefined) {
      void ensureProjectSalt().catch(() => {}); // ready for the next run
      return undefined;
    }
    const mode = normalizeProjectLabelMode(process.env['COMPRESSOR_PROJECT_LABEL']);
    return projectLabel(cwd, mode, salt);
  } catch {
    return undefined; // labelling must never break a hook
  }
}

/**
 * The label recorded on a ledger event. Hashed mode keys the digest so it
 * cannot be reproduced without the key; name mode records the folder name only,
 * never the absolute path, and is capped so the reader cannot drop it.
 */
export function projectLabel(
  workspacePath: string,
  mode: ProjectLabelMode,
  salt: string,
): string {
  if (mode === 'name') {
    return path.basename(workspacePath).slice(0, PROJECT_LABEL_MAX);
  }
  const digest = createHash('sha256')
    .update(salt)
    .update('\0') // domain separator: key and path can never run together
    .update(workspacePath)
    .digest('hex')
    .slice(0, 12);
  return `${HASHED_PREFIX}${digest}`;
}
