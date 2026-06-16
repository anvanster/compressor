import path from 'node:path';
import process from 'node:process';
import {
  addUsage,
  aggregateUsage,
  findTranscripts,
  readSessionUsage,
} from '../../claude/transcripts.ts';
import type { SessionUsage, UsageTotals } from '../../claude/transcripts.ts';
import { EFFECTIVE_UNIT, WEIGHT_LEGEND, weightedTokens } from '../../tokens/weight.ts';

export interface StatsOptions {
  project?: string;
  since?: string;
}

function parseSinceDays(value: string): number {
  const days = /^(\d+)d$/.exec(value)?.[1];
  if (days === undefined) {
    throw new Error(`invalid --since '${value}' (expected e.g. 7d, 30d)`);
  }
  return Number(days);
}

const fmt = (n: number): string => n.toLocaleString('en-US');

export async function runStats(opts: StatsOptions): Promise<void> {
  const days = parseSinceDays(opts.since ?? '30d');
  const projectDir = path.resolve(opts.project ?? process.cwd());
  const since = new Date(Date.now() - days * 86_400_000);

  const files = await findTranscripts({ projectDir, since });
  const sessions: SessionUsage[] = [];
  for (const file of files) {
    sessions.push(await readSessionUsage(file));
  }

  const totals = aggregateUsage(sessions);
  const turns = sessions.reduce((acc, s) => acc + s.turns, 0);
  const byModel: Record<string, UsageTotals> = {};
  for (const session of sessions) {
    for (const [model, usage] of Object.entries(session.byModel)) {
      byModel[model] = addUsage(
        byModel[model] ?? { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
        usage,
      );
    }
  }

  const rows: Array<[string, string]> = [
    ['sessions', fmt(sessions.length)],
    ['turns', fmt(turns)],
    ['input', fmt(totals.input)],
    ['output', fmt(totals.output)],
    ['cacheCreation', fmt(totals.cacheCreation)],
    ['cacheRead', fmt(totals.cacheRead)],
    // Cost-weighted summary: raw tiers above overstate dollars because
    // cache-read costs ~0.1x of base input. weightedTokens collapses every
    // tier to input-equivalent (dollar-proportional) tokens. Raw rows stay.
    ['effective', `${fmt(weightedTokens(totals))} ${EFFECTIVE_UNIT}  (cost-weighted)`],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    console.log(`${label.padEnd(width)}  ${value}`);
  }
  console.log(WEIGHT_LEGEND);

  const models = Object.entries(byModel);
  if (models.length > 0) {
    console.log('');
    console.log('by model:');
    for (const [model, u] of models) {
      console.log(
        `  ${model}: input=${fmt(u.input)} output=${fmt(u.output)} cacheCreation=${fmt(u.cacheCreation)} cacheRead=${fmt(u.cacheRead)}`,
      );
    }
  }

  console.log('');
  console.log(`actual usage from Claude Code transcripts (last ${days}d, ${projectDir})`);
}
