import { homedir } from 'node:os';
import process from 'node:process';
import { applyChanges, getAdapter, renderChanges } from '../../adapters/index.ts';
import type { Adapter, AdapterContext } from '../../adapters/index.ts';
import type { AgentName, PackMode } from '../../packs/types.ts';
import { describeHookCommand, resolveHookCommand } from '../../paths.ts';

export interface ScopeOptions {
  global?: boolean;
  dryRun?: boolean;
}

export interface InitOptions extends ScopeOptions {
  agent: string[];
  mode: string;
}

export const EFFECT_NOTE =
  'Takes effect on the next Claude Code session (/clear or new session).';

export function parsePackMode(value: string): PackMode {
  if (value === 'optimized' || value === 'slim') {
    return value;
  }
  throw new Error(`unknown mode '${value}' (expected optimized|slim)`);
}

const AGENT_NAMES: readonly AgentName[] = ['claude-code', 'copilot', 'cursor', 'agents-md'];

export function resolveAgents(names: string[]): Adapter[] {
  return names.map((name) => {
    const known = AGENT_NAMES.find((agent) => agent === name);
    const adapter = known === undefined ? undefined : getAdapter(known);
    if (adapter === undefined) {
      throw new Error(`no adapter for agent '${name}' (known: ${AGENT_NAMES.join(', ')})`);
    }
    return adapter;
  });
}

export function buildContext(
  global: boolean,
  mode: PackMode,
  requireHookBundle = true,
): AdapterContext {
  return {
    projectDir: process.cwd(),
    homeDir: homedir(),
    global,
    // status/uninstall only match against the command string — they must work
    // even when the bundle is missing (e.g. removing a broken install)
    hookCommand: requireHookBundle
      ? resolveHookCommand(mode)
      : describeHookCommand(mode),
  };
}

export async function installForAgents(
  agents: Adapter[],
  mode: PackMode,
  opts: ScopeOptions,
): Promise<void> {
  // only claude-code installs the PostToolUse hook; instruction-only agents
  // (copilot, cursor, agents-md) must not require dist/hook.js to exist
  const needsHookBundle = agents.some((adapter) => adapter.name === 'claude-code');
  const ctx = buildContext(opts.global === true, mode, needsHookBundle);
  for (const adapter of agents) {
    const changes = await adapter.install(mode, ctx);
    const rendered = renderChanges(changes);
    if (rendered !== '') {
      console.log(rendered);
    }
    if (opts.dryRun !== true) {
      await applyChanges(changes);
    }
  }
  const names = agents.map((adapter) => adapter.name).join(', ');
  const suffix = opts.dryRun === true ? ' (dry-run: nothing written)' : '';
  console.log(`Mode ${mode} installed for ${names}. ${EFFECT_NOTE}${suffix}`);
}

export async function runInit(opts: InitOptions): Promise<void> {
  await installForAgents(resolveAgents(opts.agent), parsePackMode(opts.mode), opts);
}
