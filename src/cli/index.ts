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

const hook = program.command('hook').description('hook protocol entry points (read stdin)');
hook
  .command('post-tool-use')
  .description('PostToolUse protocol: payload on stdin, updated output on stdout')
  .option('--mode <mode>', 'full|optimized|slim', 'optimized')
  .action(async (opts: { mode?: string }) => {
    const { runHookPostToolUse } = await import('./commands/hook.ts');
    await runHookPostToolUse(opts);
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
