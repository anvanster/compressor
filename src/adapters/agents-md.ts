import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PackMode } from '../packs/types.ts';
import { parseAtomManifest, renderMarkedSection } from '../packs/render.ts';
import {
  readMarkedSection,
  removeMarkedSection,
  upsertMarkedSection,
} from './markers.ts';
import type {
  Adapter,
  AdapterContext,
  AdapterStatus,
  FileChange,
} from './types.ts';

// AGENTS.md is plain Markdown read verbatim by 25+ tools (agents.md standard);
// our marked section is just text to those models. No tool offers a hook
// mechanism through it, so only the instruction half of compressor applies.
const READERS_NOTE =
  'instructions only — read natively by Cursor, Copilot, Codex, Windsurf; Claude Code does NOT read AGENTS.md';

function agentsMdPath(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, 'AGENTS.md');
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

export const agentsMdAdapter: Adapter = {
  name: 'agents-md',

  async detect(ctx: AdapterContext): Promise<boolean> {
    // AGENTS.md already present, or an agent that reads it is plausibly in
    // use (.cursor → Cursor, .github → Copilot) — the standard is useful
    // exactly when such agents are around.
    return (
      (await fileExists(agentsMdPath(ctx))) ||
      (await dirExists(path.join(ctx.projectDir, '.cursor'))) ||
      (await dirExists(path.join(ctx.projectDir, '.github')))
    );
  },

  async install(mode: PackMode, ctx: AdapterContext): Promise<FileChange[]> {
    if (ctx.global) {
      throw new Error('agents-md: AGENTS.md is a per-project standard; use project scope');
    }
    const file = agentsMdPath(ctx);
    const before = await readFileOrNull(file);
    const after = upsertMarkedSection(
      before,
      renderMarkedSection(mode, 'agents-md').body,
    );
    return after === before ? [] : [{ path: file, before, after }];
  },

  async uninstall(ctx: AdapterContext): Promise<FileChange[]> {
    if (ctx.global) {
      // install refuses global scope, so nothing of ours can exist there
      return [];
    }
    const file = agentsMdPath(ctx);
    const before = await readFileOrNull(file);
    if (before === null || readMarkedSection(before) === null) {
      return [];
    }
    // Never delete the file: whether WE created it is not derivable from
    // disk (a user-created empty file that received our section is
    // byte-identical to one we created), so err KEEP — worst case an empty
    // file remains. Matches the cursor .cursorrules precedent.
    return [{ path: file, before, after: removeMarkedSection(before) }];
  },

  async status(ctx: AdapterContext): Promise<AdapterStatus> {
    const body = await readFileOrNull(agentsMdPath(ctx));
    const section = body === null ? null : readMarkedSection(body);
    if (section === null) {
      return { agent: 'agents-md', installed: false, detail: 'not installed' };
    }
    const mode = parseAtomManifest(section)?.mode;
    return {
      agent: 'agents-md',
      installed: true,
      ...(mode !== undefined ? { mode } : {}),
      detail: `AGENTS.md section (project) — ${READERS_NOTE}`,
    };
  },
};
