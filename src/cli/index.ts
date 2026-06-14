#!/usr/bin/env node
import process from 'node:process';
import { Command } from 'commander';

const program = new Command();

program
  .name('compressor')
  .description(
    'Token optimization for AI coding agents: instruction packs, tool-output compression, measured savings',
  )
  .version('0.3.0');

program
  .command('init')
  .description('install the instruction pack + PostToolUse hook for the given agents')
  .option('--agent <name...>', 'agent adapters to target', ['claude-code'])
  .option('--mode <mode>', 'pack mode (optimized|slim)', 'optimized')
  .option('--global', 'install at user level instead of project level')
  .option('--dry-run', 'print planned changes without writing')
  .option('-y, --yes', 'apply without the interactive confirmation prompt')
  .option('--no-backup', 'do not back up changed files before applying')
  .option(
    '--hook-command <style>',
    'hook command style: auto|absolute|relocatable (auto: relocatable when compressor-hook is on PATH and this is not a source checkout)',
    'auto',
  )
  .action(
    async (opts: {
      agent: string[];
      mode: string;
      global?: boolean;
      dryRun?: boolean;
      yes?: boolean;
      backup?: boolean;
      hookCommand?: string;
    }) => {
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
  .option('-y, --yes', 'apply without the interactive confirmation prompt')
  .option('--no-backup', 'do not back up changed files before applying')
  .option(
    '--hook-command <style>',
    'hook command style: auto|absolute|relocatable (auto: relocatable when compressor-hook is on PATH and this is not a source checkout)',
    'auto',
  )
  .action(
    async (
      mode: string,
      opts: {
        agent: string[];
        global?: boolean;
        dryRun?: boolean;
        yes?: boolean;
        backup?: boolean;
        hookCommand?: string;
      },
    ) => {
      const { runSetMode } = await import('./commands/set-mode.ts');
      await runSetMode(mode, opts);
    },
  );

program
  .command('status')
  .description('show installation state per agent')
  .option('--global', 'report user-level (machine-wide) state instead of project state')
  .action(async (opts: { global?: boolean }) => {
    const { runStatus } = await import('./commands/status.ts');
    await runStatus(opts.global === true);
  });

program
  .command('uninstall')
  .description('remove all compressor-owned artifacts')
  .option('--agent <name...>', 'agent adapters to target', ['claude-code'])
  .option('--global', 'apply at user level instead of project level')
  .option('--dry-run', 'print planned changes without writing')
  .option('-y, --yes', 'apply without the interactive confirmation prompt')
  .option('--no-backup', 'do not back up changed files before applying')
  .action(
    async (opts: {
      agent: string[];
      global?: boolean;
      dryRun?: boolean;
      yes?: boolean;
      backup?: boolean;
    }) => {
      const { runUninstall } = await import('./commands/uninstall.ts');
      await runUninstall(opts);
    },
  );

program
  .command('restore')
  .description('restore files from a backup taken by init/set-mode/uninstall')
  .option('--from <file>', 'restore a specific backup manifest (default: the most recent)')
  .option('--list', 'list available backups instead of restoring')
  .option('--dry-run', 'print planned changes without writing')
  .option('-y, --yes', 'restore without the interactive confirmation prompt')
  .action(async (opts: { from?: string; list?: boolean; dryRun?: boolean; yes?: boolean }) => {
    const { runRestore } = await import('./commands/restore.ts');
    await runRestore(opts);
  });

program
  .command('compress')
  .description('compress stdin to stdout via the engine; stats on stderr')
  .option('--mode <mode>', 'full|optimized|slim', 'optimized')
  .option('--kind <kind>', 'read|bash|search|other', 'other')
  .option('--file-path <path>', 'source path hint (drives code detection)')
  .option('--marker-style <style>', 'plain|deterrent|informative (default: policy value)')
  .action(
    async (opts: { mode: string; kind: string; filePath?: string; markerStyle?: string }) => {
      const { runCompress } = await import('./commands/compress.ts');
      await runCompress(opts);
    },
  );

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
  .command('savings')
  .description('show what the compression hook saved (live ledger, estimated tokens)')
  .option('--since <window>', "lookback window: e.g. 7d, 30d, or 'all'", '30d')
  .option('--by <dimension>', 'aggregate by day|tool|mode|agent', 'day')
  .option('--html <path>', 'also write a self-contained HTML report (inline SVG, no JS)')
  .option('--ledger-dir <dir>', 'ledger directory (default: COMPRESSOR_LEDGER_DIR or ~/.compressor/ledger)')
  .action(async (opts: { since?: string; by?: string; html?: string; ledgerDir?: string }) => {
    const { runSavings } = await import('./commands/savings.ts');
    await runSavings(opts);
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
  .option(
    '--hook-args <args>',
    "extra args appended to the hook command in every hook-bearing variant (e.g. '--marker-style informative')",
  )
  .option(
    '--marker-styles <styles>',
    'comma-separated plain|deterrent|informative: each hook-bearing variant fans out into one arm per style IN THE SAME RUN (one budget ceiling, balanced task×trial groups)',
  )
  .option(
    '--hook-arg-arms <arms>',
    "comma-separated '<label>=<args>' arms: each hook-bearing variant fans out into one arm per entry IN THE SAME RUN (empty args = control), e.g. 'budget-on=,budget-off=--recovery-budget off'",
  )
  .option(
    '--hook-arms',
    'fan each hook-bearing variant into hook-on/hook-off arms IN THE SAME RUN (the pure compression-hook A/B, instructions held constant)',
  )
  .option('--concurrency <n>', 'cells run in parallel', '2')
  .option('--max-budget-usd <usd>', 'hard cost ceiling; scheduling stops when reached', '5')
  .option(
    '--auth <mode>',
    "api (ANTHROPIC_API_KEY, dollar ceiling) or subscription (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`; bills your Claude plan's usage windows, ceiling via --max-cells)",
    'api',
  )
  .option(
    '--max-cells <n>',
    'subscription mode: hard executed-cell ceiling, aligned to task×trial groups (default: all planned cells)',
  )
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
      hookArgs?: string;
      markerStyles?: string;
      hookArgArms?: string;
      hookArms?: boolean;
      concurrency: string;
      maxBudgetUsd: string;
      auth?: string;
      maxCells?: string;
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
  .option('--marker-style <style>', 'plain|deterrent|informative (default: policy value)')
  .action(async (opts: { mode?: string; markerStyle?: string }) => {
    const { runHookPostToolUse } = await import('./commands/hook.ts');
    await runHookPostToolUse(opts);
  });
hook
  .command('copilot-post-tool-use')
  .description('Copilot postToolUse protocol: payload on stdin, modifiedResult JSON on stdout')
  .option('--mode <mode>', 'full|optimized|slim', 'optimized')
  .option('--marker-style <style>', 'plain|deterrent|informative (default: policy value)')
  .action(async (opts: { mode?: string; markerStyle?: string }) => {
    const { runHookCopilotPostToolUse } = await import('./commands/hook.ts');
    await runHookCopilotPostToolUse(opts);
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
