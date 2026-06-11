import process from 'node:process';
import { adapters } from '../../adapters/index.ts';
import { buildContext } from './init.ts';

export async function runStatus(global = false): Promise<void> {
  const ctx = buildContext(global, 'optimized', false);
  // status reports whether compressor is CONFIGURED INTO each agent at this
  // scope — not whether the compressor CLI itself is installed. Name the scope
  // so a global package install + empty project doesn't read as "broken".
  const scope = global ? 'user-level (machine-wide)' : `project: ${process.cwd()}`;
  console.log(`compressor status — ${scope}`);

  let anyInstalled = false;
  for (const adapter of adapters) {
    const status = await adapter.status(ctx);
    const detail = status.detail.trim();
    // The adapter's `installed` flag is true if installed at EITHER scope; the
    // detail is scope-faithful. When the detail leads with "not installed", it
    // is authoritative for THIS scope (avoids "installed — not installed").
    const installedHere = status.installed && !detail.startsWith('not installed');
    if (installedHere) {
      anyInstalled = true;
      const mode = status.mode === undefined ? '' : ` (mode=${status.mode})`;
      console.log(`  ${status.agent}: installed${mode} — ${detail}`);
    } else if (detail === '' || detail === 'not installed') {
      console.log(`  ${status.agent}: not installed`);
    } else {
      // self-complete detail, e.g. "not installed (global); installed at project level"
      console.log(`  ${status.agent}: ${detail}`);
    }
  }

  if (!anyInstalled) {
    console.log(
      global
        ? "\nNothing configured at user level. Run `compressor init --agent copilot --global` for a machine-wide Copilot hook."
        : "\nNothing configured in this project. Run `compressor init` (Claude Code) or add `--agent copilot --agent cursor --agent agents-md`; `--global` installs a machine-wide Copilot hook.",
    );
  }
}
