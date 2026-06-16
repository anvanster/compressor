import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { aggregate, readRun } from '../../bench/results.ts';
import type { VariantAggregate } from '../../bench/results.ts';
import type { CellResult, RunMeta } from '../../bench/types.ts';
import { WEIGHT_LEGEND, costWeightedContext } from '../../tokens/weight.ts';

export type ReportFormat = 'table' | 'md' | 'json';

export interface ReportCliOptions {
  run?: string;
  out: string;
  compare?: string[];
  format: string;
}

/** Deltas vs a baseline variant — actual usage numbers, never estimates. */
export interface VariantDelta {
  variantId: string;
  /** % change in median output tokens; null when either side has no valid cells or the baseline median is 0 */
  outputPct: number | null;
  /** % change in median cost; null when either side is missing or the baseline is 0 */
  costPct: number | null;
  /** success-rate change in percentage points; null when either side unjudged */
  successPp: number | null;
}

/** Marginal per-atom deltas: <baseline>-minus/plus-<atom> vs that baseline. */
export interface AblationDeltas {
  baselineId: string;
  deltas: VariantDelta[];
}

export interface DataQualityIssues {
  /** tasks whose check passed BEFORE the agent ran — the cell proves nothing */
  vacuousTasks: string[];
  /** cells served by a model other than the requested one (silent fallback) */
  substitutedCells: string[];
  /** cells whose result JSON had no modelUsage — served model unverifiable */
  unknownServedCells: string[];
  /** cells the runner never scheduled (budget ceiling / unenforceable ceiling) */
  skippedCells: string[];
  /** infra failures — separate from task failures, excluded from success% */
  errorCells: string[];
  /** cells with permission denials — the model burned turns on retries, numbers are inflated */
  deniedCells: string[];
}

/** One taskId × variantId cell of the per-task breakdown. */
export interface TaskVariantCell {
  taskId: string;
  variantId: string;
  /** all rows for this pair, including infra errors */
  cells: number;
  /** non-error rows — medians below are over these */
  valid: number;
  /** valid rows with a boolean success verdict */
  judged: number;
  successes: number;
  /** successes / judged; null when nothing was judged */
  successFraction: number | null;
  /** median output tokens over valid rows */
  medianOutput: number;
  /**
   * median cost-weighted input-side context over valid rows: input*1 +
   * cacheCreation*1.25 + cacheRead*0.1 (dollar-proportional input-equiv tokens,
   * NOT a face-value sum — cache-read costs ~0.1x so the raw sum overstated $).
   */
  medianContext: number;
}

/** taskIds × variantIds matrix; cells[i][j] = taskIds[i] × variantIds[j], null = no rows. */
export interface ByTaskBreakdown {
  /** sorted ascending */
  taskIds: string[];
  /** 'full' first when present, then alphabetical */
  variantIds: string[];
  cells: (TaskVariantCell | null)[][];
}

export interface RunReport {
  runId: string;
  meta: RunMeta | null;
  aggregates: VariantAggregate[];
  /** null when the run has no 'full' variant to compare against */
  deltas: VariantDelta[] | null;
  /** per-atom marginal deltas vs each ablation baseline; null when no ablation variants */
  ablationDeltas: AblationDeltas[] | null;
  byTask: ByTaskBreakdown;
  issues: DataQualityIssues;
}

export function parseFormat(value: string): ReportFormat {
  if (value === 'table' || value === 'md' || value === 'json') {
    return value;
  }
  throw new Error(`unknown --format '${value}' (expected table|md|json)`);
}

function deltasAgainst(
  baseline: VariantAggregate,
  others: VariantAggregate[],
): VariantDelta[] {
  return others.map((a) => ({
    variantId: a.variantId,
    // a variant with zero valid cells has medians of 0 by construction —
    // never report that as a -100% win
    outputPct:
      a.valid === 0 || baseline.valid === 0 || baseline.medianOutput === 0
        ? null
        : ((a.medianOutput - baseline.medianOutput) / baseline.medianOutput) * 100,
    costPct:
      a.medianCostUsd === null ||
      baseline.medianCostUsd === null ||
      baseline.medianCostUsd === 0
        ? null
        : ((a.medianCostUsd - baseline.medianCostUsd) / baseline.medianCostUsd) * 100,
    successPp:
      a.successRate === null || baseline.successRate === null
        ? null
        : (a.successRate - baseline.successRate) * 100,
  }));
}

export function computeDeltas(aggregates: VariantAggregate[]): VariantDelta[] | null {
  const full = aggregates.find((a) => a.variantId === 'full');
  if (full === undefined) {
    return null;
  }
  return deltasAgainst(
    full,
    aggregates.filter((a) => a.variantId !== 'full'),
  );
}

/**
 * The ablation gate question: for each <baseline>-minus/plus-<atom> variant,
 * the marginal output & success delta vs that baseline — not vs full.
 */
export function computeAblationDeltas(
  aggregates: VariantAggregate[],
): AblationDeltas[] | null {
  const groups: AblationDeltas[] = [];
  for (const baselineId of ['optimized', 'slim']) {
    const prefix = `${baselineId}-`;
    const members = aggregates.filter(
      (a) =>
        a.variantId.startsWith(`${prefix}minus-`) ||
        a.variantId.startsWith(`${prefix}plus-`),
    );
    if (members.length === 0) {
      continue;
    }
    const baseline = aggregates.find((a) => a.variantId === baselineId);
    if (baseline === undefined) {
      continue;
    }
    groups.push({ baselineId, deltas: deltasAgainst(baseline, members) });
  }
  return groups.length === 0 ? null : groups;
}

/** Linear-interpolated median (matches results.ts aggregation); 0 on empty input. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * 0.5;
  const lo = Math.floor(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[Math.ceil(pos)] ?? a;
  return a + (b - a) * (pos - lo);
}

function orderVariantIds(ids: Iterable<string>): string[] {
  const unique = [...new Set(ids)];
  const rest = unique.filter((id) => id !== 'full').sort();
  return unique.includes('full') ? ['full', ...rest] : rest;
}

/**
 * Composite map key for a task x variant pair. taskIds may legally contain
 * spaces (tasks.ts only requires a non-empty string), so the separator must
 * be a character that cannot appear in either id: NUL - always written as
 * the escape '\u0000', never a raw byte (a raw NUL makes this file binary
 * to git and invisibly fragile to retyping).
 */
function pairKey(taskId: string, variantId: string): string {
  return `${taskId}\u0000${variantId}`;
}

export function computeByTask(results: CellResult[]): ByTaskBreakdown {
  const byPair = new Map<string, CellResult[]>();
  for (const row of results) {
    const key = pairKey(row.taskId, row.variantId);
    const rows = byPair.get(key);
    if (rows === undefined) {
      byPair.set(key, [row]);
    } else {
      rows.push(row);
    }
  }
  const taskIds = [...new Set(results.map((r) => r.taskId))].sort();
  const variantIds = orderVariantIds(results.map((r) => r.variantId));
  const cells = taskIds.map((taskId) =>
    variantIds.map((variantId): TaskVariantCell | null => {
      const rows = byPair.get(pairKey(taskId, variantId));
      if (rows === undefined) {
        return null;
      }
      const valid = rows.filter((r) => r.error === undefined || r.error === null);
      const judged = valid.filter((r) => typeof r.success === 'boolean');
      const successes = judged.filter((r) => r.success === true).length;
      return {
        taskId,
        variantId,
        cells: rows.length,
        valid: valid.length,
        judged: judged.length,
        successes,
        successFraction: judged.length === 0 ? null : successes / judged.length,
        medianOutput: medianOf(valid.map((r) => r.usage.output)),
        // cost-weighted (dollar-proportional) input-side context, NOT a
        // face-value (input + cacheCreation + cacheRead) sum: cache-read costs
        // ~0.1x of base input, so the raw sum overstated dollars up to ~10x.
        medianContext: medianOf(valid.map((r) => costWeightedContext(r.usage))),
      };
    }),
  );
  return { taskIds, variantIds, cells };
}

/** A served model matching the requested one, allowing alias→dated-ID forms
 * (requested 'claude-haiku-4-5' served 'claude-haiku-4-5-20251001'). */
function servedMatchesRequested(served: string[], requested: string): boolean {
  return served.some((model) => model === requested || model.includes(requested));
}

export function findIssues(results: CellResult[]): DataQualityIssues {
  const vacuous = new Set<string>();
  const substituted: string[] = [];
  const unknownServed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const denied: string[] = [];
  for (const row of results) {
    const cell = `${row.taskId} × ${row.variantId} trial ${row.trial}`;
    if (row.baselineCheckPassed === true) {
      vacuous.add(row.taskId);
    }
    if (row.permissionDenials > 0) {
      denied.push(`${cell}: ${row.permissionDenials} permission denial(s) — usage inflated by retries`);
    }
    if (row.error !== undefined && row.error !== null) {
      if (row.error.startsWith('skipped: ')) {
        skipped.push(`${cell}: ${row.error}`);
      } else {
        errors.push(`${cell}: ${row.error}`);
      }
    } else if (row.servedModels.length === 0) {
      unknownServed.push(`${cell}: result JSON reported no modelUsage`);
    } else if (!servedMatchesRequested(row.servedModels, row.model)) {
      substituted.push(
        `${cell}: requested ${row.model}, served [${row.servedModels.join(', ')}]`,
      );
    }
  }
  return {
    vacuousTasks: [...vacuous].sort(),
    substitutedCells: substituted,
    unknownServedCells: unknownServed,
    skippedCells: skipped,
    errorCells: errors,
    deniedCells: denied,
  };
}

export function buildRunReport(
  runId: string,
  meta: RunMeta | null,
  results: CellResult[],
): RunReport {
  const aggregates = aggregate(results);
  return {
    runId,
    meta,
    aggregates,
    deltas: computeDeltas(aggregates),
    ablationDeltas: computeAblationDeltas(aggregates),
    byTask: computeByTask(results),
    issues: findIssues(results),
  };
}

export async function loadRunReport(outDir: string, runId: string): Promise<RunReport> {
  const { meta, results } = await readRun(outDir, runId);
  if (meta === null && results.length === 0) {
    throw new Error(`run '${runId}' not found in ${outDir}`);
  }
  return buildRunReport(runId, meta, results);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function runTimestamp(outDir: string, runId: string): Promise<number | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(path.join(outDir, `${runId}.meta.json`), 'utf8'),
    );
    if (isRecord(parsed) && typeof parsed['startedAt'] === 'string') {
      const t = Date.parse(parsed['startedAt']);
      if (Number.isFinite(t)) {
        return t;
      }
    }
  } catch {
    // fall through to mtime
  }
  for (const suffix of ['.jsonl', '.meta.json']) {
    try {
      return (await stat(path.join(outDir, `${runId}${suffix}`))).mtimeMs;
    } catch {
      continue;
    }
  }
  return null;
}

export async function latestRunId(outDir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(outDir);
  } catch {
    return null;
  }
  const ids = new Set<string>();
  for (const name of entries) {
    const match = /^(.+)\.meta\.json$/.exec(name) ?? /^(.+)\.jsonl$/.exec(name);
    const id = match?.[1];
    if (id !== undefined) {
      ids.add(id);
    }
  }
  let best: { id: string; at: number } | null = null;
  for (const id of ids) {
    const at = await runTimestamp(outDir, id);
    if (at !== null && (best === null || at > best.at)) {
      best = { id, at };
    }
  }
  return best?.id ?? null;
}

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');
const fmtPct = (rate: number | null): string =>
  rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`;
const fmtMoney = (usd: number | null): string =>
  usd === null ? 'n/a' : `$${usd.toFixed(4)}`;
const fmtSigned = (value: number | null, unit: string): string =>
  value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}${unit}`;

const TABLE_HEADERS = [
  'variant',
  'cells',
  'errors',
  'success%',
  'in',
  'out',
  'out IQR',
  'cacheW',
  'cacheR',
  'cost',
  'turns',
  'duration',
];

function aggregateRow(a: VariantAggregate): string[] {
  return [
    a.variantId,
    String(a.cells),
    String(a.errors),
    fmtPct(a.successRate),
    fmtInt(a.medianInput),
    fmtInt(a.medianOutput),
    `${fmtInt(a.iqrOutput[0])}–${fmtInt(a.iqrOutput[1])}`,
    fmtInt(a.medianCacheCreation),
    fmtInt(a.medianCacheRead),
    fmtMoney(a.medianCostUsd),
    fmtInt(a.medianTurns),
    `${fmtInt(a.medianDurationMs)}ms`,
  ];
}

function plainTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? '').length)),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ').trimEnd();
  return [line(headers), ...rows.map(line)].join('\n');
}

function pipeTable(headers: string[], rows: string[][]): string {
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  return [
    line(headers),
    line(headers.map(() => '---')),
    ...rows.map(line),
  ].join('\n');
}

function deltaLines(deltas: VariantDelta[]): string[] {
  return deltas.map(
    (d) =>
      `${d.variantId}: output ${fmtSigned(d.outputPct, '%')}, cost ${fmtSigned(d.costPct, '%')}, success ${fmtSigned(d.successPp, 'pp')}`,
  );
}

function issueLines(issues: DataQualityIssues): string[] {
  const lines: string[] = [];
  for (const taskId of issues.vacuousTasks) {
    lines.push(
      `VACUOUS FIXTURE: task '${taskId}' — its check passed BEFORE the agent ran; cells prove nothing`,
    );
  }
  for (const cell of issues.substitutedCells) {
    lines.push(`MODEL SUBSTITUTION: ${cell}`);
  }
  for (const cell of issues.unknownServedCells) {
    lines.push(`SERVED MODEL UNKNOWN: ${cell}`);
  }
  for (const cell of issues.deniedCells) {
    lines.push(`PERMISSION DENIALS: ${cell}`);
  }
  if (issues.skippedCells.length > 0) {
    lines.push(
      `SKIPPED (${issues.skippedCells.length} cells, never scheduled):`,
      ...issues.skippedCells.map((cell) => `  ${cell}`),
    );
  }
  if (issues.errorCells.length > 0) {
    lines.push(
      `INFRA ERRORS (${issues.errorCells.length} cells, excluded from success%):`,
      ...issues.errorCells.map((cell) => `  ${cell}`),
    );
  }
  return lines;
}

function toolCallLines(aggregates: VariantAggregate[]): string[] {
  const lines: string[] = [];
  for (const a of aggregates) {
    const entries = Object.entries(a.toolCallTotals).sort(([x], [y]) =>
      x.localeCompare(y),
    );
    if (entries.length === 0) {
      continue;
    }
    lines.push(`${a.variantId}: ${entries.map(([name, n]) => `${name} ${n}`).join(', ')}`);
  }
  return lines;
}

function byTaskMatrix(
  byTask: ByTaskBreakdown,
  pick: (cell: TaskVariantCell) => string,
): { headers: string[]; rows: string[][] } {
  const headers = ['task', ...byTask.variantIds];
  const rows = byTask.taskIds.map((taskId, i) => [
    taskId,
    ...byTask.variantIds.map((_, j) => {
      const cell = byTask.cells[i]?.[j] ?? null;
      // a pair with no rows, or whose every row errored, has nothing to report
      return cell === null || cell.valid === 0 ? '—' : pick(cell);
    }),
  ]);
  return { headers, rows };
}

function headerLines(report: RunReport): string[] {
  const lines = [`run ${report.runId}`];
  if (report.meta !== null) {
    lines.push(
      `suite ${report.meta.suite} | model ${report.meta.model} | trials ${report.meta.trials} | started ${report.meta.startedAt}`,
    );
    if (report.meta.authMode === 'subscription') {
      lines.push(
        'auth: subscription — plan-billed; cost columns are API-equivalent figures, not dollars billed',
      );
    }
  }
  return lines;
}

const USAGE_NOTE = 'medians of actual usage reported by claude (result JSON)';

export function formatReport(report: RunReport, format: ReportFormat): string {
  if (format === 'json') {
    return JSON.stringify(
      {
        runId: report.runId,
        meta: report.meta,
        aggregates: report.aggregates,
        deltas: report.deltas,
        ablationDeltas: report.ablationDeltas,
        byTask: report.byTask,
        issues: report.issues,
      },
      null,
      2,
    );
  }
  const table = format === 'md' ? pipeTable : plainTable;
  const rows = report.aggregates.map(aggregateRow);
  const sections: string[] = [
    headerLines(report).join('\n'),
    `${table(TABLE_HEADERS, rows)}\n\n${USAGE_NOTE}`,
  ];
  if (report.byTask.taskIds.length > 0) {
    const out = byTaskMatrix(
      report.byTask,
      (c) => `${fmtInt(c.medianOutput)} (${c.successes}/${c.judged})`,
    );
    const ctx = byTaskMatrix(report.byTask, (c) => fmtInt(c.medianContext));
    sections.push(
      format === 'md'
        ? `## per-task median output tokens (success)\n\n${table(out.headers, out.rows)}`
        : `per-task median output tokens (success):\n${table(out.headers, out.rows)}`,
      format === 'md'
        ? `## per-task median context (cost-weighted)\n\n${table(ctx.headers, ctx.rows)}\n\n${WEIGHT_LEGEND}`
        : `per-task median context (cost-weighted):\n${table(ctx.headers, ctx.rows)}\n${WEIGHT_LEGEND}`,
    );
  }
  const toolCalls = toolCallLines(report.aggregates);
  if (toolCalls.length > 0) {
    sections.push(
      format === 'md'
        ? `## Tool calls by tool\n\n${toolCalls.map((l) => `- ${l}`).join('\n')}`
        : `tool calls by tool:\n${toolCalls.map((l) => `  ${l}`).join('\n')}`,
    );
  }
  if (report.deltas !== null && report.deltas.length > 0) {
    const body = deltaLines(report.deltas);
    sections.push(
      format === 'md'
        ? `## Deltas vs full\n\n${body.map((l) => `- ${l}`).join('\n')}`
        : `deltas vs full:\n${body.map((l) => `  ${l}`).join('\n')}`,
    );
  }
  for (const group of report.ablationDeltas ?? []) {
    const body = deltaLines(group.deltas);
    sections.push(
      format === 'md'
        ? `## Ablation deltas vs ${group.baselineId}\n\n${body.map((l) => `- ${l}`).join('\n')}`
        : `ablation deltas vs ${group.baselineId} (marginal per-atom impact):\n${body.map((l) => `  ${l}`).join('\n')}`,
    );
  }
  const issues = issueLines(report.issues);
  if (issues.length > 0) {
    sections.push(
      format === 'md'
        ? `## Data quality\n\n${issues.map((l) => `- ${l}`).join('\n')}`
        : `DATA QUALITY:\n${issues.map((l) => `  ${l}`).join('\n')}`,
    );
  }
  return sections.join('\n\n');
}

export function formatComparison(
  a: RunReport,
  b: RunReport,
  format: ReportFormat,
): string {
  if (format === 'json') {
    return JSON.stringify(
      {
        runA: { runId: a.runId, aggregates: a.aggregates, issues: a.issues },
        runB: { runId: b.runId, aggregates: b.aggregates, issues: b.issues },
      },
      null,
      2,
    );
  }
  const byIdA = new Map(a.aggregates.map((agg) => [agg.variantId, agg]));
  const byIdB = new Map(b.aggregates.map((agg) => [agg.variantId, agg]));
  const variantIds = [...new Set([...byIdA.keys(), ...byIdB.keys()])];

  const pair = (
    agg: VariantAggregate | undefined,
    pick: (agg: VariantAggregate) => string,
  ): string => (agg === undefined ? '—' : pick(agg));
  const headers = [
    'variant',
    `cells ${a.runId}`,
    `cells ${b.runId}`,
    'success% A',
    'success% B',
    'out A',
    'out B',
    'cost A',
    'cost B',
  ];
  const rows = variantIds.map((variantId) => {
    const aggA = byIdA.get(variantId);
    const aggB = byIdB.get(variantId);
    return [
      variantId,
      pair(aggA, (agg) => String(agg.cells)),
      pair(aggB, (agg) => String(agg.cells)),
      pair(aggA, (agg) => fmtPct(agg.successRate)),
      pair(aggB, (agg) => fmtPct(agg.successRate)),
      pair(aggA, (agg) => fmtInt(agg.medianOutput)),
      pair(aggB, (agg) => fmtInt(agg.medianOutput)),
      pair(aggA, (agg) => fmtMoney(agg.medianCostUsd)),
      pair(aggB, (agg) => fmtMoney(agg.medianCostUsd)),
    ];
  });
  const table = format === 'md' ? pipeTable : plainTable;
  const issues = [
    ...issueLines(a.issues).map((l) => `${a.runId}: ${l}`),
    ...issueLines(b.issues).map((l) => `${b.runId}: ${l}`),
  ];
  const sections = [
    `compare A=${a.runId} vs B=${b.runId}`,
    `${table(headers, rows)}\n\n${USAGE_NOTE}`,
  ];
  if (issues.length > 0) {
    sections.push(
      format === 'md'
        ? `## Data quality\n\n${issues.map((l) => `- ${l}`).join('\n')}`
        : `DATA QUALITY:\n${issues.map((l) => `  ${l}`).join('\n')}`,
    );
  }
  return sections.join('\n\n');
}

export async function runReport(opts: ReportCliOptions): Promise<void> {
  const format = parseFormat(opts.format);
  const outDir = path.resolve(opts.out);

  if (opts.compare !== undefined) {
    if (opts.compare.length !== 2) {
      throw new Error(`--compare takes exactly two run ids, got ${opts.compare.length}`);
    }
    const [runA, runB] = opts.compare;
    if (runA === undefined || runB === undefined) {
      throw new Error('--compare takes exactly two run ids');
    }
    const [reportA, reportB] = await Promise.all([
      loadRunReport(outDir, runA),
      loadRunReport(outDir, runB),
    ]);
    console.log(formatComparison(reportA, reportB, format));
    return;
  }

  const runId = opts.run ?? (await latestRunId(outDir));
  if (runId === null) {
    throw new Error(`no benchmark runs found in ${outDir} — run 'compressor benchmark' first`);
  }
  console.log(formatReport(await loadRunReport(outDir, runId), format));
}
