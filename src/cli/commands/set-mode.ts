import { effectNote, installForAgents, parsePackMode, resolveAgents } from './init.ts';
import type { ScopeOptions } from './init.ts';
import { uninstallForAgents } from './uninstall.ts';

export interface SetModeOptions extends ScopeOptions {
  agent: string[];
}

export async function runSetMode(mode: string, opts: SetModeOptions): Promise<void> {
  const agents = resolveAgents(opts.agent);
  if (mode === 'full') {
    const outcome = await uninstallForAgents(agents, opts);
    if (outcome === 'aborted') {
      return;
    }
    const names = agents.map((adapter) => adapter.name).join(', ');
    if (outcome === 'empty') {
      console.log(`Mode full: no compressor artifacts to remove for ${names}.`);
      return;
    }
    const suffix = outcome === 'dryRun' ? ' (dry-run: nothing written)' : '';
    console.log(
      `Mode full: compressor artifacts removed for ${names} (true baseline, no instruction pack, no hook). ${effectNote(agents)}${suffix}`,
    );
    return;
  }
  await installForAgents(agents, parsePackMode(mode), opts);
}
