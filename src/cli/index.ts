#!/usr/bin/env node
import process from 'node:process';
import { Command } from 'commander';

const program = new Command();

program
  .name('compressor')
  .description(
    'Token optimization for AI coding agents: instruction packs, tool-output compression, measured savings',
  )
  .version('0.1.0');

program
  .command('init')
  .description('install the instruction pack + PostToolUse hook for the given agents')
  .option('--agent <name...>', 'agent adapters to target', ['claude-code'])
  .option('--mode <mode>', 'pack mode (optimized|slim)', 'optimized')
  .option('--global', 'install at user level instead of project level')
  .option('--dry-run', 'print planned changes without writing')
  .action(
    async (opts: { agent: string[]; mode: string; global?: boolean; dryRun?: boolean }) => {
      const { runInit } = await import('./commands/init.ts');
      await runInit(opts);
    },
  );

program
  .command('set-mode')
  .description("switch mode; 'full' removes all compressor artifacts (true baseline)")
  .argument('<mode>', 'full|optimized|slim')
  .option('--agent <name...>', 'agent adapters to target', ['claude-code'])
  .option('--global', 'apply at user level instead of project level')
  .option('--dry-run', 'print planned changes without writing')
  .action(
    async (mode: string, opts: { agent: string[]; global?: boolean; dryRun?: boolean }) => {
      const { runSetMode } = await import('./commands/set-mode.ts');
      await runSetMode(mode, opts);
    },
  );

program
  .command('status')
  .description('show installation state per agent')
  .action(async () => {
    const { runStatus } = await import('./commands/status.ts');
    await runStatus();
  });

program
  .command('uninstall')
  .description('remove all compressor-owned artifacts')
  .option('--agent <name...>', 'agent adapters to target', ['claude-code'])
  .option('--global', 'apply at user level instead of project level')
  .option('--dry-run', 'print planned changes without writing')
  .action(async (opts: { agent: string[]; global?: boolean; dryRun?: boolean }) => {
    const { runUninstall } = await import('./commands/uninstall.ts');
    await runUninstall(opts);
  });

program
  .command('compress')
  .description('compress stdin to stdout via the engine; stats on stderr')
  .option('--mode <mode>', 'full|optimized|slim', 'optimized')
  .option('--kind <kind>', 'read|bash|search|other', 'other')
  .option('--file-path <path>', 'source path hint (drives code detection)')
  .action(async (opts: { mode: string; kind: string; filePath?: string }) => {
    const { runCompress } = await import('./commands/compress.ts');
    await runCompress(opts);
  });

program
  .command('count')
  .description('count tokens per file (estimated by default, --exact via Anthropic API)')
  .argument('<file...>', 'files to count')
  .option('--exact', 'use the Anthropic count_tokens endpoint (needs ANTHROPIC_API_KEY)')
  .option('--model <model>', 'model for --exact counts', 'claude-sonnet-4-6')
  .action(async (files: string[], opts: { exact?: boolean; model?: string }) => {
    const { runCount } = await import('./commands/count.ts');
    await runCount(files, opts);
  });

program
  .command('stats')
  .description('aggregate actual token usage from Claude Code transcripts')
  .option('--project <path>', 'project directory (default: cwd)')
  .option('--since <window>', 'lookback window, e.g. 7d or 30d', '30d')
  .action(async (opts: { project?: string; since?: string }) => {
    const { runStats } = await import('./commands/stats.ts');
    await runStats(opts);
  });

program
  .command('benchmark')
  .description('run the benchmark suite: cells = task × variant × trial, results as JSONL')
  .option('--suite <path>', 'suite JSON file', 'bench/suites/basic.json')
  .option('--modes <modes>', 'comma-separated full|optimized|slim', 'full,optimized,slim')
  .option('--trials <n>', 'trials per task × variant', '5')
  .option('--model <model>', 'requested model (served model verified per cell)', 'claude-sonnet-4-6')
  .option(
    '--ablate <ids>',
    'comma-separated atom ids: adds optimized-minus-<id> variants (slim-minus-<id> for slim-only atoms)',
  )
  .option('--ablate-add <ids>', 'comma-separated REJECTED atom ids: adds optimized-plus-<id> variants')
  .option(
    '--ablate-group <groups>',
    'comma-separated atom categories (output|behavior): adds optimized-minus-<group>-atoms variants with every atom of that category removed',
  )
  .option('--no-hook', 'skip the compression hook in optimized/slim cells')
  .option('--concurrency <n>', 'cells run in parallel', '2')
  .option('--max-budget-usd <usd>', 'hard cost ceiling; scheduling stops when reached', '5')
  .option('--out <dir>', 'results directory', 'bench/results')
  .action(
    async (opts: {
      suite: string;
      modes: string;
      trials: string;
      model: string;
      ablate?: string;
      ablateAdd?: string;
      ablateGroup?: string;
      hook: boolean;
      concurrency: string;
      maxBudgetUsd: string;
      out: string;
    }) => {
      const { runBenchmarkCommand } = await import('./commands/benchmark.ts');
      await runBenchmarkCommand(opts);
    },
  );

program
  .command('report')
  .description(
    'aggregate a benchmark run: per-variant medians+IQR, deltas vs full, per-atom ablation deltas vs their baseline',
  )
  .option('--run <id>', 'run id (default: latest run in --out)')
  .option('--out <dir>', 'results directory', 'bench/results')
  .option('--compare <runs...>', 'compare two runs side-by-side by variant')
  .option('--format <format>', 'table|md|json', 'table')
  .action(
    async (opts: { run?: string; out: string; compare?: string[]; format: string }) => {
      const { runReport } = await import('./commands/report.ts');
      await runReport(opts);
    },
  );

const hook = program.command('hook').description('hook protocol entry points (read stdin)');
hook
  .command('post-tool-use')
  .description('PostToolUse protocol: payload on stdin, updated output on stdout')
  .option('--mode <mode>', 'full|optimized|slim', 'optimized')
  .action(async (opts: { mode?: string }) => {
    const { runHookPostToolUse } = await import('./commands/hook.ts');
    await runHookPostToolUse(opts);
  });
hook
  .command('copilot-post-tool-use')
  .description('Copilot postToolUse protocol: payload on stdin, modifiedResult JSON on stdout')
  .option('--mode <mode>', 'full|optimized|slim', 'optimized')
  .action(async (opts: { mode?: string }) => {
    const { runHookCopilotPostToolUse } = await import('./commands/hook.ts');
    await runHookCopilotPostToolUse(opts);
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
