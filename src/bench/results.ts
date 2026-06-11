import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CellResult, RunMeta } from './types.ts';

export function runFilePath(outDir: string, runId: string): string {
  return path.join(outDir, `${runId}.jsonl`);
}

function metaFilePath(outDir: string, runId: string): string {
  return path.join(outDir, `${runId}.meta.json`);
}

export function newRunId(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `bench-${date}-${time}`;
}

export async function appendResult(
  outDir: string,
  runId: string,
  row: CellResult,
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const file = runFilePath(outDir, runId);
  await appendFile(file, `${JSON.stringify(row)}\n`, 'utf8');
  return file;
}

export async function writeRunMeta(outDir: string, meta: RunMeta): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const file = metaFilePath(outDir, meta.runId);
  await writeFile(file, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return file;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readRun(
  outDir: string,
  runId: string,
): Promise<{ meta: RunMeta | null; results: CellResult[] }> {
  let meta: RunMeta | null = null;
  try {
    const parsed: unknown = JSON.parse(await readFile(metaFilePath(outDir, runId), 'utf8'));
    if (isRecord(parsed) && typeof parsed['runId'] === 'string') {
      meta = parsed as unknown as RunMeta;
    }
  } catch {
    meta = null;
  }

  let text = '';
  try {
    text = await readFile(runFilePath(outDir, runId), 'utf8');
  } catch {
    text = '';
  }

  const results: CellResult[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (
      isRecord(parsed) &&
      typeof parsed['taskId'] === 'string' &&
      typeof parsed['variantId'] === 'string'
    ) {
      results.push(parsed as unknown as CellResult);
    }
  }
  return { meta, results };
}

/**
 * Post-run balance assertion: cross-variant comparison is valid only when
 * every variant executed the same number of cells (the runner schedules
 * variants innermost and stops group-atomically, so an imbalance means
 * something defeated that — e.g. results concatenated from separate arm runs
 * with independent budget ceilings, each truncating at its own point).
 * Returns a warning string, or null when balanced. Skipped cells (budget
 * ceiling / no-cost breaker) are not counted as executed.
 */
export function balanceWarning(results: readonly CellResult[]): string | null {
  const counts = new Map<string, number>();
  for (const row of results) {
    if (row.error?.startsWith('skipped:') === true) continue;
    counts.set(row.variantId, (counts.get(row.variantId) ?? 0) + 1);
  }
  const values = [...counts.values()];
  const first = values[0];
  if (first === undefined || values.every((count) => count === first)) {
    return null;
  }
  const detail = [...counts.entries()]
    .map(([variantId, count]) => `${variantId}=${count}`)
    .join(', ');
  return `WARNING: unbalanced variants — executed cell counts differ (${detail}); drop task×trial groups missing from any variant before comparing`;
}

export interface VariantAggregate {
  variantId: string;
  cells: number;
  errors: number;
  /** non-error cells — medians are 0-on-empty, so deltas must check this */
  valid: number;
  successRate: number | null;
  medianInput: number;
  medianOutput: number;
  medianCacheCreation: number;
  medianCacheRead: number;
  medianCostUsd: number | null;
  medianDurationMs: number;
  medianTurns: number;
  iqrOutput: [number, number];
  toolCallTotals: Record<string, number>;
}

/** Linear-interpolated quantile (numpy default); 0 on empty input. */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[Math.ceil(pos)] ?? a;
  return a + (b - a) * (pos - lo);
}

function sortedAsc(values: number[]): number[] {
  return [...values].sort((x, y) => x - y);
}

function median(values: number[]): number {
  return quantile(sortedAsc(values), 0.5);
}

export function aggregate(results: CellResult[]): VariantAggregate[] {
  const byVariant = new Map<string, CellResult[]>();
  for (const row of results) {
    const rows = byVariant.get(row.variantId);
    if (rows === undefined) {
      byVariant.set(row.variantId, [row]);
    } else {
      rows.push(row);
    }
  }

  const aggregates: VariantAggregate[] = [];
  for (const [variantId, rows] of byVariant) {
    const valid = rows.filter((r) => r.error === undefined || r.error === null);
    const judged = valid.filter((r) => typeof r.success === 'boolean');
    const successRate =
      judged.length === 0
        ? null
        : judged.filter((r) => r.success === true).length / judged.length;

    const costs = valid
      .map((r) => r.costUsd)
      .filter((c): c is number => typeof c === 'number');
    const outputs = sortedAsc(valid.map((r) => r.usage.output));

    const toolCallTotals: Record<string, number> = {};
    for (const r of valid) {
      for (const [name, count] of Object.entries(r.toolCalls)) {
        toolCallTotals[name] = (toolCallTotals[name] ?? 0) + count;
      }
    }

    aggregates.push({
      variantId,
      cells: rows.length,
      errors: rows.length - valid.length,
      valid: valid.length,
      successRate,
      medianInput: median(valid.map((r) => r.usage.input)),
      medianOutput: quantile(outputs, 0.5),
      medianCacheCreation: median(valid.map((r) => r.usage.cacheCreation)),
      medianCacheRead: median(valid.map((r) => r.usage.cacheRead)),
      medianCostUsd: costs.length === 0 ? null : median(costs),
      medianDurationMs: median(valid.map((r) => r.durationMs)),
      medianTurns: median(valid.map((r) => r.numTurns)),
      iqrOutput: [quantile(outputs, 0.25), quantile(outputs, 0.75)],
      toolCallTotals,
    });
  }
  return aggregates;
}
