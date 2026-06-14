import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { FileChange } from './types.ts';
import { applyChanges } from './apply.ts';

// Backup/restore for the mutating commands (init, set-mode, uninstall). A
// FileChange already carries `before` — the file's pre-change content (null =
// did not exist) — so a backup is just the recorded `before` state of every
// change, and a restore writes it back (or deletes, when before was null),
// exactly inverting applyChanges. Manifests are JSON under ~/.compressor/backups
// (override COMPRESSOR_BACKUP_DIR). The agent config files compressor touches
// are small, so `before` is stored inline.

export interface BackupEntry {
  path: string;
  /** the file's content before the change; null means it did not exist */
  before: string | null;
}

export interface BackupManifest {
  version: 1;
  createdAt: string;
  /** the command that produced this backup, e.g. 'init --mode optimized' */
  command?: string;
  entries: BackupEntry[];
}

export interface ApplyResult {
  /** path of the backup manifest written before applying (absent if none) */
  backupPath?: string;
  changed: number;
}

export function resolveBackupDir(): string {
  return (
    process.env['COMPRESSOR_BACKUP_DIR'] ?? path.join(os.homedir(), '.compressor', 'backups')
  );
}

/** Filesystem-safe manifest filename from an instant. */
function stampName(date: Date): string {
  return `${date.toISOString().replace(/[:.]/g, '-')}.json`;
}

/** Persist the pre-change state of every change as a restorable manifest. */
export async function writeBackup(
  changes: readonly FileChange[],
  opts: { dir?: string; command?: string; now?: Date } = {},
): Promise<string> {
  const dir = opts.dir ?? resolveBackupDir();
  const now = opts.now ?? new Date();
  await mkdir(dir, { recursive: true });
  const manifest: BackupManifest = {
    version: 1,
    createdAt: now.toISOString(),
    ...(opts.command === undefined ? {} : { command: opts.command }),
    entries: changes.map((c) => ({ path: c.path, before: c.before })),
  };
  const file = path.join(dir, stampName(now));
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return file;
}

export interface ApplyOptions {
  /** default true; false skips the safety backup */
  backup?: boolean;
  backupDir?: string;
  command?: string;
  now?: Date;
}

/**
 * applyChanges with a safety backup taken FIRST (default on). If the backup
 * cannot be written, nothing is modified — better to fail loudly than mutate
 * config files with no way back.
 */
export async function applyWithBackup(
  changes: FileChange[],
  opts: ApplyOptions = {},
): Promise<ApplyResult> {
  if (changes.length === 0) {
    return { changed: 0 };
  }
  let backupPath: string | undefined;
  if (opts.backup !== false) {
    try {
      backupPath = await writeBackup(changes, {
        dir: opts.backupDir,
        command: opts.command,
        now: opts.now,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `backup failed (${reason}); aborting before any file is modified — ` +
          'fix the backup location (COMPRESSOR_BACKUP_DIR) or re-run with --no-backup',
      );
    }
  }
  await applyChanges(changes);
  return { ...(backupPath === undefined ? {} : { backupPath }), changed: changes.length };
}

export interface BackupSummary {
  file: string;
  createdAt: string;
  command?: string;
  entries: number;
}

/** Manifests in the backup dir, newest first (lexical sort on ISO stamp). */
export async function listBackups(dir = resolveBackupDir()): Promise<BackupSummary[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const summaries: BackupSummary[] = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort().reverse()) {
    const file = path.join(dir, name);
    try {
      const m = JSON.parse(await readFile(file, 'utf8')) as BackupManifest;
      summaries.push({
        file,
        createdAt: m.createdAt,
        ...(m.command === undefined ? {} : { command: m.command }),
        entries: Array.isArray(m.entries) ? m.entries.length : 0,
      });
    } catch {
      // skip corrupt/foreign json
    }
  }
  return summaries;
}

export async function readManifest(file: string): Promise<BackupManifest> {
  const m = JSON.parse(await readFile(file, 'utf8')) as BackupManifest;
  if (m.version !== 1 || !Array.isArray(m.entries)) {
    throw new Error(`not a compressor backup manifest: ${file}`);
  }
  return m;
}

/**
 * FileChanges that restore the manifest's recorded state from current disk:
 * each entry's `before` becomes the target `after`, and the current content is
 * the `before` (so the restore itself can be backed up). Entries already at the
 * recorded state are skipped.
 */
export async function planRestore(manifest: BackupManifest): Promise<FileChange[]> {
  const changes: FileChange[] = [];
  for (const entry of manifest.entries) {
    let current: string | null;
    try {
      current = await readFile(entry.path, 'utf8');
    } catch {
      current = null;
    }
    if (current === entry.before) {
      continue;
    }
    changes.push({ path: entry.path, before: current, after: entry.before });
  }
  return changes;
}
