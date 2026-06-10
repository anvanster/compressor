import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PackMode } from '../packs/types.ts';
import {
  parseAtomManifest,
  renderCursorRules,
  renderMarkedSection,
} from '../packs/render.ts';
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

// Cursor's rules system reads .cursor/rules/*.mdc — a plain .md file there is
// silently ignored, and frontmatter is mandatory (renderCursorRules emits
// description + alwaysApply: true; with alwaysApply: true the other fields are
// ignored by Cursor, but description doubles as our mode manifest). Cursor
// ships a stable hooks system (sessionStart, preToolUse/postToolUse,
// beforeReadFile, ...), but postToolUse can replace output for MCP tools only
// (updated_mcp_tool_output) and beforeReadFile is permission-only, so
// compressor-style rewriting of built-in Read/Shell output is not currently
// possible — only the instruction half of compressor applies.
const ASYMMETRY_NOTE =
  'instructions only — Cursor hooks cannot rewrite built-in tool output (postToolUse replaces MCP output only)';
const MODIFIED_NOTE = 'locally modified — install will overwrite';
const AGENTS_MD_OVERLAP_NOTE =
  'NOTE: Cursor also reads AGENTS.md — both installed means duplicated instructions';

function mdcPath(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, '.cursor', 'rules', 'compressor.mdc');
}

// Deprecated (dropped from Cursor's docs) but still read for back-compat:
// if the user already drives Cursor through it we upsert a marked section
// there too. Never created by us.
function legacyRulesPath(ctx: AdapterContext): string {
  return path.join(ctx.projectDir, '.cursorrules');
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export const cursorAdapter: Adapter = {
  name: 'cursor',

  async detect(ctx: AdapterContext): Promise<boolean> {
    return (
      (await dirExists(path.join(ctx.projectDir, '.cursor'))) ||
      (await fileExists(legacyRulesPath(ctx)))
    );
  },

  async install(mode: PackMode, ctx: AdapterContext): Promise<FileChange[]> {
    if (ctx.global) {
      throw new Error('cursor: Cursor rules are per-project; use project scope');
    }
    const changes: FileChange[] = [];

    // compressor-owned file: overwrite wholesale, no markers needed
    const mdcFile = mdcPath(ctx);
    const mdcBefore = await readFileOrNull(mdcFile);
    const mdcAfter = renderCursorRules(mode).body;
    if (mdcAfter !== mdcBefore) {
      changes.push({ path: mdcFile, before: mdcBefore, after: mdcAfter });
    }

    const legacyFile = legacyRulesPath(ctx);
    const legacyBefore = await readFileOrNull(legacyFile);
    if (legacyBefore !== null) {
      const legacyAfter = upsertMarkedSection(
        legacyBefore,
        renderMarkedSection(mode, 'cursor').body,
      );
      if (legacyAfter !== legacyBefore) {
        changes.push({ path: legacyFile, before: legacyBefore, after: legacyAfter });
      }
    }
    return changes;
  },

  async uninstall(ctx: AdapterContext): Promise<FileChange[]> {
    if (ctx.global) {
      // install refuses global scope, so nothing of ours can exist there
      return [];
    }
    const changes: FileChange[] = [];

    const mdcFile = mdcPath(ctx);
    const mdcBefore = await readFileOrNull(mdcFile);
    if (mdcBefore !== null) {
      changes.push({ path: mdcFile, before: mdcBefore, after: null });
    }

    const legacyFile = legacyRulesPath(ctx);
    const legacyBefore = await readFileOrNull(legacyFile);
    if (legacyBefore !== null && readMarkedSection(legacyBefore) !== null) {
      // never delete .cursorrules — we never create it, only sectioned it
      changes.push({
        path: legacyFile,
        before: legacyBefore,
        after: removeMarkedSection(legacyBefore),
      });
    }
    return changes;
  },

  async status(ctx: AdapterContext): Promise<AdapterStatus> {
    const mdcBody = await readFileOrNull(mdcPath(ctx));
    const legacyBody = await readFileOrNull(legacyRulesPath(ctx));
    const legacySection =
      legacyBody === null ? null : readMarkedSection(legacyBody);
    if (mdcBody === null && legacySection === null) {
      return { agent: 'cursor', installed: false, detail: 'not installed' };
    }

    const mdcMode = mdcBody === null ? undefined : parseAtomManifest(mdcBody)?.mode;
    let mode = mdcMode;
    if (mode === undefined && legacySection !== null) {
      mode = parseAtomManifest(legacySection)?.mode;
    }

    // Hand edits to the compressor-owned .mdc are otherwise invisible: install
    // overwrites wholesale and uninstall deletes unconditionally, so surface
    // any drift from what install would write (including a broken manifest).
    const mdcModified =
      mdcBody !== null &&
      (mdcMode === undefined || mdcBody !== renderCursorRules(mdcMode).body);

    const parts: string[] = [];
    if (mdcBody !== null) {
      parts.push('.cursor/rules/compressor.mdc');
    }
    if (legacySection !== null) {
      parts.push('legacy .cursorrules section');
    }
    let detail = `${parts.join(' + ')} (project) — ${ASYMMETRY_NOTE}`;
    if (mdcModified) {
      detail += `; ${MODIFIED_NOTE}`;
    }
    const agentsMd = await readFileOrNull(agentsMdPath(ctx));
    if (agentsMd !== null && readMarkedSection(agentsMd) !== null) {
      detail += `; ${AGENTS_MD_OVERLAP_NOTE}`;
    }
    return {
      agent: 'cursor',
      installed: true,
      ...(mode !== undefined ? { mode } : {}),
      detail,
    };
  },
};
