import { homedir } from 'node:os';
import process from 'node:process';
import { applyChanges, getAdapter, renderChanges } from '../../adapters/index.ts';
import type { Adapter, AdapterContext } from '../../adapters/index.ts';
import type { AgentName, PackMode } from '../../packs/types.ts';
import {
  describeHookCommand,
  detectHookCommandStyle,
  resolveCopilotHookCommand,
  resolveHookCommand,
} from '../../paths.ts';
import type { HookCommandStyle } from '../../paths.ts';

export interface ScopeOptions {
  global?: boolean;
  dryRun?: boolean;
  /** --hook-command auto|absolute|relocatable (default auto) */
  hookCommand?: string;
}

export interface InitOptions extends ScopeOptions {
  agent: string[];
  mode: string;
}

const AGENT_EFFECT_NOTES: Record<AgentName, string> = {
  'claude-code': 'Claude Code: takes effect on the next session (/clear or new session).',
  copilot: 'Copilot: hook config loads when the CLI starts — restart any running copilot session.',
  cursor: 'Cursor: rules apply to new chats.',
  'agents-md': 'AGENTS.md: read at agent startup.',
};

export function effectNote(agents: readonly Pick<Adapter, 'name'>[]): string {
  return agents.map((a) => AGENT_EFFECT_NOTES[a.name]).join(' ');
}

export function parsePackMode(value: string): PackMode {
  if (value === 'optimized' || value === 'slim') {
    return value;
  }
  throw new Error(`unknown mode '${value}' (expected optimized|slim)`);
}

/**
 * --hook-command value → style. 'auto' (the default) detects: absolute in a
 * source checkout (dogfooding tracks the dev build), relocatable for an
 * npm-installed layout when compressor-hook resolves on PATH, else absolute.
 * An explicit 'relocatable' that does not resolve on PATH fails fast later,
 * in resolveHookCommand/resolveCopilotHookCommand (actionable -g hint).
 */
export function resolveHookCommandStyle(value: string | undefined): HookCommandStyle {
  if (value === undefined || value === 'auto') {
    return detectHookCommandStyle();
  }
  if (value === 'absolute' || value === 'relocatable') {
    return value;
  }
  throw new Error(
    `unknown hook command style '${value}' (expected auto|absolute|relocatable)`,
  );
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
  style?: HookCommandStyle,
): AdapterContext {
  return {
    projectDir: process.cwd(),
    homeDir: homedir(),
    global,
    // status/uninstall only match against the command string — they must work
    // even when the bundle is missing (e.g. removing a broken install)
    hookCommand: requireHookBundle
      ? resolveHookCommand(mode, undefined, style)
      : describeHookCommand(mode, undefined, style),
  };
}

export async function installForAgents(
  agents: Adapter[],
  mode: PackMode,
  opts: ScopeOptions,
): Promise<void> {
  const style = resolveHookCommandStyle(opts.hookCommand);
  // claude-code installs the PostToolUse hook (dist/hook.js) and copilot the
  // postToolUse hook (dist/copilot-hook.js); instruction-only agents (cursor,
  // agents-md) must not require either bundle to exist
  const needsHookBundle = agents.some((adapter) => adapter.name === 'claude-code');
  const ctx = buildContext(opts.global === true, mode, needsHookBundle, style);
  const hasCopilot = agents.some((adapter) => adapter.name === 'copilot');
  if (hasCopilot) {
    // existence check only (both scopes — global installs the hook too):
    // refuses to install a hook command that would fail on every tool call
    // (Copilot postToolUse is fail-open = silent no-op)
    resolveCopilotHookCommand(mode, undefined, style);
  }
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
  // name the installed hook-command form when a hook-bearing agent is present
  const styleNote = !needsHookBundle && !hasCopilot
    ? ''
    : style === 'relocatable'
      ? ' Hook command: relocatable (PATH).'
      : ' Hook command: absolute (this machine).';
  console.log(`Mode ${mode} installed for ${names}.${styleNote} ${effectNote(agents)}${suffix}`);
  if (hasCopilot && opts.global === true) {
    const verb = opts.dryRun === true ? 'would be installed' : 'installed';
    console.log(
      `Copilot --global: hook ${verb} machine-wide (Copilot CLI); instructions were NOT installed (no global mechanism) — run init --agent copilot in each repo for instruction packs.`,
    );
  }
}

export async function runInit(opts: InitOptions): Promise<void> {
  await installForAgents(resolveAgents(opts.agent), parsePackMode(opts.mode), opts);
}
