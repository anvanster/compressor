import type { Adapter, FileChange } from '../../adapters/index.ts';
import { buildContext, confirmAndApply, resolveAgents } from './init.ts';
import type { ApplyOutcome, ScopeOptions } from './init.ts';

export interface UninstallOptions extends ScopeOptions {
  agent: string[];
}

export async function uninstallForAgents(
  agents: Adapter[],
  opts: ScopeOptions,
): Promise<ApplyOutcome> {
  const ctx = buildContext(opts.global === true, 'optimized', false);
  const changes: FileChange[] = [];
  for (const adapter of agents) {
    changes.push(...(await adapter.uninstall(ctx)));
  }
  const { outcome } = await confirmAndApply(changes, {
    command: `uninstall${opts.global === true ? ' --global' : ''}`,
    scopeLabel: opts.global === true ? 'your user config (~)' : 'this project',
    dryRun: opts.dryRun,
    yes: opts.yes,
    backup: opts.backup,
  });
  return outcome;
}

export async function runUninstall(opts: UninstallOptions): Promise<void> {
  const agents = resolveAgents(opts.agent);
  const outcome = await uninstallForAgents(agents, opts);
  if (outcome === 'aborted') {
    return;
  }
  const names = agents.map((adapter) => adapter.name).join(', ');
  if (outcome === 'empty') {
    console.log(`No compressor artifacts to remove for ${names}.`);
    return;
  }
  const suffix = outcome === 'dryRun' ? ' (dry-run: nothing written)' : '';
  console.log(`Compressor artifacts removed for ${names}.${suffix}`);
}
