import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PackMode } from '../packs/types.ts';
import { markerBegin } from '../packs/render.ts';
import { packageRoot } from '../paths.ts';
import type {
  Adapter,
  AdapterContext,
  AdapterStatus,
  FileChange,
} from './types.ts';

// OpenCode adapter — COMPRESSION ONLY. OpenCode loads JS/TS plugins from
// .opencode/plugins/ (project) and ~/.config/opencode/plugins/ (global, XDG
// path — NOT ~/.opencode) at startup; the loader scans {plugin,plugins}/*.{ts,js}
// under each config dir (verified from sst/opencode
// packages/opencode/src/config/plugin.ts, fetched 2026-06-12). Our artifact
// is ONE compressor-owned file: the dist/opencode-plugin.js bundle prefixed
// with a mode prologue (anatomy documented in src/opencode-plugin-entry.ts):
//
//   // <!-- compressor:begin mode=<mode> v=1 -->
//   const COMPRESSOR_MODE = '<mode>';
//   <bundle body>
//
// Owned-file pattern (mirrors cursor's .mdc): overwrite wholesale on
// install, delete unconditionally on uninstall, mode parsed from the header
// marker for status. Instructions are NOT installed here — OpenCode reads
// AGENTS.md natively, which the agents-md adapter owns.
const PLUGIN_FILE = 'compressor.js';

const HONESTY_NOTE =
  'instructions come from AGENTS.md (OpenCode reads it natively; run init --agent agents-md); ' +
  'plugin format doc-verified 2026-06-12, not yet live-verified against an OpenCode install';
const MODIFIED_NOTE = 'locally modified — install will overwrite';
const GLOBAL_CROSS_NOTE = 'installed globally (~/.config/opencode/plugins)';

function projectPluginPath(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, '.opencode', 'plugins', PLUGIN_FILE);
}

function globalPluginPath(ctx: AdapterContext): string {
  return path.join(ctx.homeDir, '.config', 'opencode', 'plugins', PLUGIN_FILE);
}

function pluginPath(ctx: AdapterContext): string {
  return ctx.global ? globalPluginPath(ctx) : projectPluginPath(ctx);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/** The installed file: mode prologue + bundle body (see opencode-plugin-entry.ts). */
export function renderOpencodePlugin(mode: PackMode, bundle: string): string {
  return [`// ${markerBegin(mode)}`, `const COMPRESSOR_MODE = '${mode}';`, bundle].join(
    '\n',
  );
}

/**
 * Mode from the installed file's header marker (first line). Header-only on
 * purpose: a marker string deeper in the file (e.g. inside the bundled
 * engine's own constants) must never masquerade as the install marker.
 */
export function parseInstalledMode(body: string): PackMode | undefined {
  const header = body.split('\n', 1)[0] ?? '';
  const modes: readonly PackMode[] = ['optimized', 'slim'];
  return modes.find((mode) => header.includes(markerBegin(mode)));
}

/**
 * Adapter factory with an injectable package root (default-parameter style,
 * like the paths.ts resolvers) so tests can point at a fixture bundle. The
 * root is resolved lazily at plan time, never at import time.
 */
export function createOpencodeAdapter(root?: string): Adapter {
  async function readBundle(): Promise<string> {
    const bundlePath = path.join(root ?? packageRoot(), 'dist', 'opencode-plugin.js');
    const bundle = await readFileOrNull(bundlePath);
    if (bundle === null) {
      // mirrors resolveHookCommand's discipline: never install an artifact
      // that cannot work (a missing bundle would be a broken plugin file)
      throw new Error(
        `opencode plugin bundle missing at ${bundlePath} — run 'npm run build' in the compressor package, then re-run`,
      );
    }
    return bundle;
  }

  return {
    name: 'opencode',

    async detect(ctx: AdapterContext): Promise<boolean> {
      if (ctx.global) {
        return dirExists(path.join(ctx.homeDir, '.config', 'opencode'));
      }
      return (
        (await dirExists(path.join(ctx.projectDir, '.opencode'))) ||
        (await fileExists(path.join(ctx.projectDir, 'opencode.json')))
      );
    },

    async install(mode: PackMode, ctx: AdapterContext): Promise<FileChange[]> {
      const bundle = await readBundle();
      const file = pluginPath(ctx);
      const before = await readFileOrNull(file);
      const after = renderOpencodePlugin(mode, bundle);
      return after === before ? [] : [{ path: file, before, after }];
    },

    async uninstall(ctx: AdapterContext): Promise<FileChange[]> {
      // compressor-owned file name — delete unconditionally (cursor precedent);
      // applyChanges prunes now-empty plugins/.opencode (.config) dirs after
      const file = pluginPath(ctx);
      const before = await readFileOrNull(file);
      return before === null ? [] : [{ path: file, before, after: null }];
    },

    async status(ctx: AdapterContext): Promise<AdapterStatus> {
      const body = await readFileOrNull(pluginPath(ctx));
      if (body === null) {
        if (!ctx.global) {
          // scope-faithful cross-scope note (copilot precedent): the global
          // plugin still compresses OpenCode sessions in this project
          const globalBody = await readFileOrNull(globalPluginPath(ctx));
          if (globalBody !== null) {
            const globalMode = parseInstalledMode(globalBody);
            return {
              agent: 'opencode',
              installed: true,
              ...(globalMode !== undefined ? { mode: globalMode } : {}),
              detail: `not installed (project); ${GLOBAL_CROSS_NOTE}`,
            };
          }
        }
        return { agent: 'opencode', installed: false, detail: 'not installed' };
      }

      const mode = parseInstalledMode(body);

      // Hand edits to the compressor-owned plugin are otherwise invisible
      // (install overwrites wholesale, uninstall deletes unconditionally), so
      // surface drift from what install would write. A missing bundle (status
      // must work without it) skips the byte comparison; a broken header is
      // drift by itself.
      let modified = mode === undefined;
      if (mode !== undefined) {
        try {
          modified = body !== renderOpencodePlugin(mode, await readBundle());
        } catch {
          modified = false;
        }
      }

      const where = ctx.global
        ? '~/.config/opencode/plugins/compressor.js (global)'
        : '.opencode/plugins/compressor.js (project)';
      let detail = `${where} — compression plugin; ${HONESTY_NOTE}`;
      if (modified) {
        detail += `; ${MODIFIED_NOTE}`;
      }
      return {
        agent: 'opencode',
        installed: true,
        ...(mode !== undefined ? { mode } : {}),
        detail,
      };
    },
  };
}

export const opencodeAdapter: Adapter = createOpencodeAdapter();
