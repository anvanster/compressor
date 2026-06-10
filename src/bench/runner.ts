import { runCell } from './cell.ts';
import { appendResult, newRunId, runFilePath, writeRunMeta } from './results.ts';
import type { CellResult, CellSpec, SuiteSpec, Variant } from './types.ts';

export interface RunOptions {
  suite: SuiteSpec;
  variants: Variant[];
  trials: number;
  model: string;
  maxBudgetUsd: number;
  concurrency: number;
  outDir: string;
  fixturesDir: string;
  onProgress?: (line: string) => void;
}

/**
 * Cells that report no cost (timeouts, errors, subscription/Bedrock auth)
 * still bill real API spend, so the dollar ceiling cannot see them. After
 * this many consecutive no-cost cells the ceiling is unenforceable and the
 * runner stops scheduling instead of burning the whole grid.
 */
export const MAX_CONSECUTIVE_NO_COST_CELLS = 3;

function zeroedResult(runId: string, cell: CellSpec, error: string): CellResult {
  return {
    runId,
    taskId: cell.task.id,
    variantId: cell.variant.id,
    trial: cell.trial,
    model: cell.model,
    servedModels: [],
    baselineCheckPassed: null,
    success: null,
    usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    costUsd: null,
    durationMs: 0,
    numTurns: 0,
    toolCalls: {},
    sessionId: null,
    error,
    timestamp: new Date().toISOString(),
  };
}

function statusOf(row: CellResult): string {
  if (row.error !== undefined) return row.error;
  if (row.success === null) return 'unchecked';
  return row.success ? 'pass' : 'fail';
}

export async function runBenchmark(
  opts: RunOptions,
): Promise<{ runId: string; results: CellResult[]; resultsFile: string }> {
  const runId = newRunId();
  const resultsFile = runFilePath(opts.outDir, runId);

  await writeRunMeta(opts.outDir, {
    runId,
    suite: opts.suite.name,
    variantIds: opts.variants.map((v) => v.id),
    model: opts.model,
    trials: opts.trials,
    startedAt: new Date().toISOString(),
    maxBudgetUsd: opts.maxBudgetUsd,
  });

  // variants innermost: an early budget stop still covers every variant on
  // the tasks that did run
  const cells: CellSpec[] = [];
  for (let trial = 1; trial <= opts.trials; trial += 1) {
    for (const task of opts.suite.tasks) {
      for (const variant of opts.variants) {
        cells.push({ task, variant, trial, model: opts.model });
      }
    }
  }

  const results: CellResult[] = new Array<CellResult>(cells.length);
  let spentUsd = 0;
  let noCostStreak = 0;
  let next = 0;
  const progress = (line: string): void => opts.onProgress?.(line);

  const worker = async (): Promise<void> => {
    while (next < cells.length) {
      const index = next;
      next += 1;
      const cell = cells[index];
      if (cell === undefined) return;
      const label = `${cell.task.id} × ${cell.variant.id} trial ${cell.trial}`;

      let row: CellResult;
      if (spentUsd >= opts.maxBudgetUsd) {
        row = zeroedResult(
          runId,
          cell,
          `skipped: budget ceiling ${opts.maxBudgetUsd} USD reached`,
        );
      } else if (noCostStreak >= MAX_CONSECUTIVE_NO_COST_CELLS) {
        row = zeroedResult(
          runId,
          cell,
          `skipped: ${MAX_CONSECUTIVE_NO_COST_CELLS} consecutive cells reported no cost — budget ceiling ${opts.maxBudgetUsd} USD is unenforceable`,
        );
      } else {
        try {
          row = await runCell(cell, { runId, fixturesDir: opts.fixturesDir });
        } catch (error) {
          // runCell catches internally; this guards the pool regardless
          row = zeroedResult(
            runId,
            cell,
            error instanceof Error ? error.message : String(error),
          );
        }
        if (typeof row.costUsd === 'number') {
          spentUsd += row.costUsd;
          noCostStreak = 0;
        } else {
          noCostStreak += 1;
        }
      }

      results[index] = row;
      await appendResult(opts.outDir, runId, row);
      progress(
        `[${index + 1}/${cells.length}] ${label}: ${statusOf(row)} (spent $${spentUsd.toFixed(4)})`,
      );
    }
  };

  const poolSize = Math.min(
    Math.max(1, Math.floor(opts.concurrency) || 2),
    Math.max(1, cells.length),
  );
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  return { runId, results, resultsFile };
}
