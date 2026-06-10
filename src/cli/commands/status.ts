import { adapters } from '../../adapters/index.ts';
import { buildContext } from './init.ts';

export async function runStatus(): Promise<void> {
  const ctx = buildContext(false, 'optimized', false);
  for (const adapter of adapters) {
    const status = await adapter.status(ctx);
    const installed = status.installed ? 'installed' : 'not installed';
    const mode = status.mode === undefined ? '' : ` (mode=${status.mode})`;
    console.log(`${status.agent}: ${installed}${mode} — ${status.detail}`);
  }
}
