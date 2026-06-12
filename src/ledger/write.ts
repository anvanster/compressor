import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { appendFile, mkdir } from 'node:fs/promises';
import type { Mode, ToolKind } from '../engine/types.ts';

// Append-only savings ledger written by the hook protocol layers. Privacy:
// events carry sizes/transform ids only — NO file paths, NO content. The
// writer is fire-and-forget and FAIL-OPEN: a broken ledger must never break
// the user's agent. Kill switch: COMPRESSOR_NO_LEDGER=1 disables everything
// before any IO is attempted.

export interface LedgerEvent {
  /** ISO timestamp of the compression event */
  ts: string;
  agent: 'claude-code' | 'copilot' | 'opencode';
  tool: ToolKind;
  mode: Mode;
  charsIn: number;
  charsOut: number;
  estTokensIn: number;
  estTokensOut: number;
  /** AppliedTransform ids, e.g. ['dedupe-lines', 'truncate'] */
  transforms: string[];
}

/** Resolved at call time (not module load) so tests can swap the env var. */
export function resolveLedgerDir(): string {
  return (
    process.env['COMPRESSOR_LEDGER_DIR'] ?? path.join(os.homedir(), '.compressor', 'ledger')
  );
}

/** Monthly file name from the event timestamp; falls back to 'unknown'. */
function monthOf(ts: string): string {
  const month = ts.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : 'unknown';
}

// mkdir -p once per directory (keyed by dir: tests point COMPRESSOR_LEDGER_DIR
// at fresh temp dirs within one process). Errors are swallowed here AND
// surfaced again by appendFile, which is also swallowed.
const mkdirCache = new Map<string, Promise<void>>();
const pending = new Set<Promise<void>>();

/**
 * Append one event to the monthly ledger file. Never rejects; every error is
 * swallowed (fail-open). When COMPRESSOR_NO_LEDGER=1 this returns before any
 * filesystem work.
 */
export async function appendLedger(event: LedgerEvent): Promise<void> {
  if (process.env['COMPRESSOR_NO_LEDGER'] === '1') {
    return;
  }
  const task = (async (): Promise<void> => {
    try {
      const dir = resolveLedgerDir();
      let made = mkdirCache.get(dir);
      if (made === undefined) {
        made = mkdir(dir, { recursive: true }).then(
          () => undefined,
          () => undefined,
        );
        mkdirCache.set(dir, made);
      }
      await made;
      const file = path.join(dir, `${monthOf(event.ts)}.jsonl`);
      await appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
    } catch {
      // FAIL-OPEN: ledger problems are never the agent's problem.
    }
  })();
  pending.add(task);
  void task.finally(() => pending.delete(task));
  return task;
}

/**
 * Resolves when all appends in flight at call time have finished (each one
 * already swallows its own errors, so this never rejects). Hook entries race
 * this against a hard 250ms timer before exiting so writes flush without
 * ever delaying the agent meaningfully.
 */
export async function settleLedger(): Promise<void> {
  try {
    await Promise.all([...pending]);
  } catch {
    // unreachable (tasks never reject), kept for fail-open symmetry
  }
}
