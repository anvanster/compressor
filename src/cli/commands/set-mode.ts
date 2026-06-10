import { EFFECT_NOTE, installForAgents, parsePackMode, resolveAgents } from './init.ts';
import type { ScopeOptions } from './init.ts';
import { uninstallForAgents } from './uninstall.ts';

export interface SetModeOptions extends ScopeOptions {
  agent: string[];
}

export async function runSetMode(mode: string, opts: SetModeOptions): Promise<void> {
  const agents = resolveAgents(opts.agent);
  if (mode === 'full') {
    await uninstallForAgents(agents, opts);
    const names = agents.map((adapter) => adapter.name).join(', ');
    const suffix = opts.dryRun === true ? ' (dry-run: nothing written)' : '';
    console.log(
      `Mode full: compressor artifacts removed for ${names} (true baseline, no instruction pack, no hook). ${EFFECT_NOTE}${suffix}`,
    );
    return;
  }
  await installForAgents(agents, parsePackMode(mode), opts);
}
