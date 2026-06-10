import type { AgentName, PackMode } from '../packs/types.ts';

/** Mode argument accepted by the CLI; 'full' maps to uninstall (true baseline). */
export type ModeArg = PackMode | 'full';

export interface AdapterContext {
  /** project root (cwd) */
  projectDir: string;
  /** os.homedir() in production; overridden in tests */
  homeDir: string;
  /** install at user level instead of project level */
  global: boolean;
  /** command line for the PostToolUse hook entry, resolved at install time */
  hookCommand: string;
}

/**
 * A planned file mutation. `before === null` means the file did not exist;
 * `after === null` means the file is deleted. The CLI renders these as diffs
 * for --dry-run and applies them otherwise. Adapters never write directly.
 */
export interface FileChange {
  path: string;
  before: string | null;
  after: string | null;
}

export interface AdapterStatus {
  agent: AgentName;
  installed: boolean;
  mode?: PackMode;
  /** human line, e.g. 'output style + hook installed (project)' or 'unknown layout — not touching' */
  detail: string;
}

/**
 * Adapters are pure planners: every method returns the FileChanges that WOULD
 * make the target state true, computed from current disk content. Idempotent:
 * planning install over an existing install yields replace-in-place, never
 * duplicates. Uninstall touches only compressor-owned files/sections/entries.
 */
export interface Adapter {
  name: AgentName;
  /** is this agent plausibly used in this project/home? */
  detect(ctx: AdapterContext): Promise<boolean>;
  install(mode: PackMode, ctx: AdapterContext): Promise<FileChange[]>;
  uninstall(ctx: AdapterContext): Promise<FileChange[]>;
  status(ctx: AdapterContext): Promise<AdapterStatus>;
}
