import type { AgentName } from '../packs/types.ts';
import type { Adapter } from './types.ts';
import { claudeCodeAdapter } from './claude-code.ts';
import { copilotAdapter } from './copilot.ts';
import { cursorAdapter } from './cursor.ts';
import { agentsMdAdapter } from './agents-md.ts';
import { opencodeAdapter } from './opencode.ts';

export const adapters: Adapter[] = [
  claudeCodeAdapter,
  copilotAdapter,
  cursorAdapter,
  agentsMdAdapter,
  opencodeAdapter,
];

export function getAdapter(name: AgentName): Adapter | undefined {
  return adapters.find((adapter) => adapter.name === name);
}

export { claudeCodeAdapter } from './claude-code.ts';
export { copilotAdapter } from './copilot.ts';
export { cursorAdapter } from './cursor.ts';
export { agentsMdAdapter } from './agents-md.ts';
export { createOpencodeAdapter, opencodeAdapter } from './opencode.ts';
export { applyChanges, renderChanges } from './apply.ts';
export {
  applyWithBackup,
  writeBackup,
  listBackups,
  readManifest,
  planRestore,
  resolveBackupDir,
} from './backup.ts';
export type { ApplyOptions, ApplyResult, BackupManifest, BackupSummary } from './backup.ts';
export {
  upsertMarkedSection,
  removeMarkedSection,
  readMarkedSection,
} from './markers.ts';
export type {
  Adapter,
  AdapterContext,
  AdapterStatus,
  FileChange,
  ModeArg,
} from './types.ts';
