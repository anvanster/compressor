import { applyChanges, renderChanges } from '../../adapters/index.ts';
import type { Adapter } from '../../adapters/index.ts';
import { buildContext, resolveAgents } from './init.ts';
import type { ScopeOptions } from './init.ts';

export interface UninstallOptions extends ScopeOptions {
  agent: string[];
}

export async function uninstallForAgents(
  agents: Adapter[],
  opts: ScopeOptions,
): Promise<void> {
  const ctx = buildContext(opts.global === true, 'optimized', false);
  for (const adapter of agents) {
    const changes = await adapter.uninstall(ctx);
    const rendered = renderChanges(changes);
    if (rendered !== '') {
      console.log(rendered);
    }
    if (opts.dryRun !== true) {
      await applyChanges(changes);
    }
  }
}

export async function runUninstall(opts: UninstallOptions): Promise<void> {
  const agents = resolveAgents(opts.agent);
  await uninstallForAgents(agents, opts);
  const names = agents.map((adapter) => adapter.name).join(', ');
  const suffix = opts.dryRun === true ? ' (dry-run: nothing written)' : '';
  console.log(`Compressor artifacts removed for ${names}.${suffix}`);
}
