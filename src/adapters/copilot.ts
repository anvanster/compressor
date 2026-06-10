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

// Copilot reads .github/copilot-instructions.md. Copilot CLI and the cloud
// agent DO support hooks (.github/hooks/*.json; also ~/.copilot/hooks/) with
// a postToolUse hook whose modifiedResult.textResultForLlm replaces the tool
// result the model sees — the same mechanism compressor uses for Claude Code.
// Compressor's compression hook simply has not been ported there yet, so only
// the instruction half applies for now. Documented in status per PLAN.md
// phase 3.
const ASYMMETRY_NOTE =
  "instructions only — compressor's compression hook is not yet ported to Copilot hooks (.github/hooks)";
const AGENTS_MD_OVERLAP_NOTE =
  'NOTE: Copilot also reads AGENTS.md — both installed means duplicated instructions';

function instructionsPath(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, '.github', 'copilot-instructions.md');
}

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

export const copilotAdapter: Adapter = {
  name: 'copilot',

  async detect(ctx: AdapterContext): Promise<boolean> {
    return dirExists(path.join(ctx.projectDir, '.github'));
  },

  async install(mode: PackMode, ctx: AdapterContext): Promise<FileChange[]> {
    if (ctx.global) {
      throw new Error(
        'copilot: no user-global instruction mechanism; use project scope',
      );
    }
    const file = instructionsPath(ctx);
    const before = await readFileOrNull(file);
    const after = upsertMarkedSection(
      before,
      renderMarkedSection(mode, 'copilot').body,
    );
    return after === before ? [] : [{ path: file, before, after }];
  },

  async uninstall(ctx: AdapterContext): Promise<FileChange[]> {
    if (ctx.global) {
      // install refuses global scope, so nothing of ours can exist there
      return [];
    }
    const file = instructionsPath(ctx);
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
    const body = await readFileOrNull(instructionsPath(ctx));
    const section = body === null ? null : readMarkedSection(body);
    if (section === null) {
      return { agent: 'copilot', installed: false, detail: 'not installed' };
    }
    const mode = parseAtomManifest(section)?.mode;
    let detail = `.github/copilot-instructions.md section (project) — ${ASYMMETRY_NOTE}`;
    const agentsMd = await readFileOrNull(agentsMdPath(ctx));
    if (agentsMd !== null && readMarkedSection(agentsMd) !== null) {
      detail += `; ${AGENTS_MD_OVERLAP_NOTE}`;
    }
    return {
      agent: 'copilot',
      installed: true,
      ...(mode !== undefined ? { mode } : {}),
      detail,
    };
  },
};
