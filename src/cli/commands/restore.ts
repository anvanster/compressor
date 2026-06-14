import path from 'node:path';
import {
  applyWithBackup,
  listBackups,
  planRestore,
  readManifest,
  renderChanges,
  resolveBackupDir,
} from '../../adapters/index.ts';
import { isInteractive, promptYesNo } from '../confirm.ts';

export interface RestoreOptions {
  /** restore a specific manifest file (default: the most recent backup) */
  from?: string;
  /** list available backups instead of restoring */
  list?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  /** backup dir override (test seam; default COMPRESSOR_BACKUP_DIR or ~/.compressor/backups) */
  backupDir?: string;
}

export async function runRestore(opts: RestoreOptions): Promise<void> {
  const dir = opts.backupDir ?? resolveBackupDir();
  const backups = await listBackups(dir);

  if (opts.list === true) {
    if (backups.length === 0) {
      console.log(`No backups in ${dir}.`);
      return;
    }
    console.log(`Backups in ${dir} (newest first):`);
    for (const b of backups) {
      const cmd = b.command === undefined ? '' : `  ${b.command}`;
      console.log(`  ${path.basename(b.file)}  ${b.createdAt}  (${b.entries} file(s))${cmd}`);
    }
    console.log('\nRestore the latest with `compressor restore`, or a specific one with --from <file>.');
    return;
  }

  const target = opts.from ?? backups[0]?.file;
  if (target === undefined) {
    console.log(`No backups to restore in ${dir} (set COMPRESSOR_BACKUP_DIR to look elsewhere).`);
    return;
  }

  const manifest = await readManifest(target);
  const changes = await planRestore(manifest);
  if (changes.length === 0) {
    console.log(`Nothing to restore from ${target} — files already match the backup.`);
    return;
  }

  const taken = manifest.command === undefined ? '' : `, ${manifest.command}`;
  console.log(`Restoring ${changes.length} file(s) from ${path.basename(target)} (taken ${manifest.createdAt}${taken}):`);
  console.log(renderChanges(changes));
  if (opts.dryRun === true) {
    console.log('(dry-run: nothing written)');
    return;
  }

  console.error('\n⚠ this overwrites the current files with the backed-up versions.');
  if (opts.yes !== true && isInteractive()) {
    if (!(await promptYesNo('Proceed with restore? [y/N]'))) {
      console.error('Aborted; nothing changed.');
      return;
    }
  }

  // the restore is itself backed up first, so it can be undone in turn
  const result = await applyWithBackup(changes, {
    command: `restore ${path.basename(target)}`,
    ...(opts.backupDir === undefined ? {} : { backupDir: opts.backupDir }),
  });
  const note = result.backupPath === undefined ? '' : ` (a pre-restore backup was saved: ${result.backupPath})`;
  console.log(`Restored ${changes.length} file(s) from ${path.basename(target)}.${note}`);
}
