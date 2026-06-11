#!/usr/bin/env node
// Deterministic stand-in for the claude CLI — never touches the network.
// Knobs: FAKE_CLAUDE_SUCCEED, FAKE_CLAUDE_FAIL, FAKE_CLAUDE_GARBAGE,
// FAKE_CLAUDE_OUTPUT_TOKENS, FAKE_CLAUDE_NO_COST, FAKE_CLAUDE_DUP_LINES,
// FAKE_CLAUDE_FAIL_ON_RESUME (fail only --resume invocations — exercises
// mid-conversation turn failure), FAKE_CLAUDE_FORK_ON_RESUME (each --resume
// returns a NEW session id whose transcript holds ONLY that turn — the
// dangerous fork-without-history topology the usage cross-check must flag),
// FAKE_CLAUDE_ENV_FILE (write selected env vars seen by this process to the
// given path — proves what the runner exports to cells), and
// FAKE_CLAUDE_FIXTURES_DIR (where fix.patch.json answer keys live — the
// runner must NEVER copy them into the workspace).
// --resume <id>: reuses that session id, APPENDS to the existing transcript
// (fresh requestIds per turn), and emits the usual result JSON.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);

if (argv.includes('--version')) {
  console.log('fake-claude 1.0');
  process.exit(0);
}

function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const prompt = argValue('-p') ?? '';
const model = argValue('--model') ?? 'unknown-model';
const settingsPath = argValue('--settings');
const resumeId = argValue('--resume');

if (process.env.FAKE_CLAUDE_FAIL === '1') {
  console.error('fake-claude: simulated failure');
  process.exit(1);
}
if (process.env.FAKE_CLAUDE_FAIL_ON_RESUME === '1' && resumeId !== undefined) {
  console.error('fake-claude: simulated resume failure');
  process.exit(1);
}
if (process.env.FAKE_CLAUDE_GARBAGE === '1') {
  console.log('this is definitely not JSON {');
  process.exit(0);
}

let settings = {};
if (settingsPath !== undefined) {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null) settings = parsed;
  } catch {
    // unreadable settings: behave as if empty
  }
}
const outputStyle = typeof settings.outputStyle === 'string' ? settings.outputStyle : 'none';
const permMode = settings.permissions?.defaultMode ?? 'none';
const configDir = process.env.CLAUDE_CONFIG_DIR ?? 'none';

// A patch "fits" the workspace when every non-create entry's target exists in
// cwd and contains the find text — fixture contents are disjoint, so at most
// one fixture's answer key fits a given workspace.
function patchFits(patches) {
  const editEntries = patches.filter((p) => p.find !== '');
  if (editEntries.length === 0) return false;
  for (const patch of editEntries) {
    const target = join(process.cwd(), patch.file);
    if (!existsSync(target)) return false;
    if (!readFileSync(target, 'utf8').includes(patch.find)) return false;
  }
  return true;
}

function applyPatch(patches) {
  for (const patch of patches) {
    const target = join(process.cwd(), patch.file);
    if (patch.find === '') {
      // empty find = create/overwrite the file (e.g. refactor-extract's validate.mjs)
      writeFileSync(target, patch.replace);
      continue;
    }
    const before = readFileSync(target, 'utf8');
    writeFileSync(target, before.split(patch.find).join(patch.replace));
  }
}

// "solve" the task: apply the fixture's scripted fix. The answer key is read
// from the fixture SOURCE dir (FAKE_CLAUDE_FIXTURES_DIR) — a real benchmark
// workspace must not contain fix.patch.json. Only the OPENING turn solves:
// once patched, the workspace is no longer a pristine fixture and the
// disjointness assumption breaks (another fixture's key can spuriously fit
// the modified files and corrupt them on resumed turns).
if (process.env.FAKE_CLAUDE_SUCCEED === '1' && resumeId === undefined) {
  const fixturesDir = process.env.FAKE_CLAUDE_FIXTURES_DIR;
  if (fixturesDir !== undefined && existsSync(fixturesDir)) {
    try {
      for (const name of readdirSync(fixturesDir).sort()) {
        const patchFile = join(fixturesDir, name, 'fix.patch.json');
        if (!existsSync(patchFile)) continue;
        const patches = JSON.parse(readFileSync(patchFile, 'utf8'));
        if (!Array.isArray(patches) || !patchFits(patches)) continue;
        applyPatch(patches);
        break;
      }
    } catch {
      // unsolvable fixture: leave files as-is
    }
  }
}

function hash36(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

if (process.env.FAKE_CLAUDE_ENV_FILE !== undefined) {
  try {
    writeFileSync(
      process.env.FAKE_CLAUDE_ENV_FILE,
      JSON.stringify({
        noLedger: process.env.COMPRESSOR_NO_LEDGER ?? null,
        configDir: process.env.CLAUDE_CONFIG_DIR ?? null,
      }),
    );
  } catch {
    // probe is best-effort
  }
}

const rawTokens = Number.parseInt(process.env.FAKE_CLAUDE_OUTPUT_TOKENS ?? '', 10);
const outputTokens = Number.isFinite(rawTokens) ? rawTokens : 400;
// --resume reuses the session id it was given (stable across the conversation)
// unless FAKE_CLAUDE_FORK_ON_RESUME simulates a print-mode fork: a fresh id
// per resumed turn whose transcript does NOT carry the prior history
const forkOnResume = process.env.FAKE_CLAUDE_FORK_ON_RESUME === '1' && resumeId !== undefined;
const sessionId = forkOnResume
  ? `${resumeId.replace(/-fork-.*$/, '')}-fork-${hash36(prompt)}`
  : (resumeId ?? `fake-${hash36(prompt + model + outputStyle)}`);

// deterministic turn counter, persisted per session id under CLAUDE_CONFIG_DIR
let turn = resumeId === undefined ? 1 : 2;
if (configDir !== 'none') {
  try {
    const stateFile = join(
      configDir,
      `fake-session-${sessionId.replace(/[^a-zA-Z0-9-]/g, '_')}.json`,
    );
    if (resumeId !== undefined && existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      if (Number.isInteger(state.turn)) turn = state.turn + 1;
    }
    writeFileSync(stateFile, JSON.stringify({ turn }));
  } catch {
    // state is best-effort; turn stays at its default
  }
}

const resultText =
  `fake answer style=${outputStyle} configDir=${configDir} permMode=${permMode}` +
  (resumeId === undefined ? '' : ` turn=${turn} resumed=${sessionId}`);

// transcript mirrors Claude Code: $CLAUDE_CONFIG_DIR/projects/<encoded cwd>/
if (configDir !== 'none') {
  try {
    const encoded = process.cwd().replace(/[^a-zA-Z0-9]/g, '-');
    const dir = join(configDir, 'projects', encoded);
    mkdirSync(dir, { recursive: true });
    const firstOut = Math.floor(outputTokens / 2);
    // fresh requestIds per turn; turn 1 keeps the legacy names so existing
    // single-shot expectations stay byte-identical
    const idPrefix = turn === 1 ? 'fake' : `fake_t${turn}`;
    const entry = (requestId, msgId, usage, toolName) =>
      JSON.stringify({
        type: 'assistant',
        sessionId,
        requestId,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          id: msgId,
          model,
          usage,
          content: [{ type: 'tool_use', id: `toolu_${msgId}`, name: toolName, input: {} }],
        },
      });
    const lines = [
      entry(
        `req_${idPrefix}_1`,
        `msg_${idPrefix}_1`,
        {
          input_tokens: 5000,
          output_tokens: firstOut,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 15000,
        },
        'Read',
      ),
      entry(
        `req_${idPrefix}_2`,
        `msg_${idPrefix}_2`,
        {
          input_tokens: 4000,
          output_tokens: outputTokens - firstOut,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 15000,
        },
        'Bash',
      ),
    ];
    if (process.env.FAKE_CLAUDE_DUP_LINES === '1') {
      // real transcripts repeat the same API response across lines (same
      // requestId) — consumers must dedupe
      lines.push(lines[0], lines[1]);
    }
    const payload = `${lines.join('\n')}\n`;
    const file = join(dir, `${sessionId}.jsonl`);
    // resumed sessions APPEND — the final transcript carries the whole
    // conversation, like a real resumed Claude Code session
    if (resumeId === undefined) {
      writeFileSync(file, payload);
    } else {
      appendFileSync(file, payload);
    }
  } catch {
    // missing transcript is a tolerated runner path
  }
}

const result = {
  type: 'result',
  subtype: 'success',
  session_id: sessionId,
  total_cost_usd: 0.01,
  duration_ms: 1200,
  num_turns: 3,
  usage: {
    input_tokens: 9000,
    output_tokens: outputTokens,
    cache_creation_input_tokens: 2000,
    cache_read_input_tokens: 30000,
  },
  modelUsage: { [model]: {} },
  permission_denials:
    Number(process.env.FAKE_CLAUDE_DENIALS ?? 0) > 0
      ? Array.from({ length: Number(process.env.FAKE_CLAUDE_DENIALS) }, () => ({
          tool_name: 'Edit',
          tool_use_id: 'toolu_denied',
          tool_input: {},
        }))
      : [],
  result: resultText,
};
if (process.env.FAKE_CLAUDE_NO_COST === '1') {
  // subscription (Pro/Max) auth and Bedrock/Vertex routing report no dollar cost
  delete result.total_cost_usd;
}
console.log(JSON.stringify(result));
