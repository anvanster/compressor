import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Regression (critical): the 250ms settle cap only shortcuts the JS await —
// it does not bound process lifetime. On modern Node, process.exit() performs
// a clean shutdown that joins the libuv threadpool; a ledger appendFile
// blocked in open(2) (hung NFS/SMB, dead FUSE mount — stood in for here by a
// reader-less FIFO) never returns, so the join never completes and the hook
// process lives forever. Claude Code waits on hook exit, so every compressed
// tool call stalls for the host's hook timeout — or indefinitely on hosts
// without one. The fix: write stdout FIRST, then race the settle; on timeout
// terminate via SIGKILL (kernel-level, bypasses the threadpool join).
//
// The CLI protocol path (`compressor hook post-tool-use`) previously had NO
// settle cap at all (the process exited only when the event loop drained,
// i.e. after the append completed) — it now shares the same exit path.

const execFileAsync = promisify(execFile);

const HOOK_ENTRY = fileURLToPath(new URL('../../src/hook-entry.ts', import.meta.url));
const COPILOT_ENTRY = fileURLToPath(new URL('../../src/copilot-hook-entry.ts', import.meta.url));
const CLI_ENTRY = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));

// generous bound: SIGKILL fires ~250ms after settle starts; node + TS
// stripping startup dominates. The OLD code never exits at all.
const EXIT_BOUND_MS = 10_000;

const skipFifo = process.platform === 'win32';

function compressiblePayload(): string {
  const rows = Array.from(
    { length: 600 },
    (_, i) => `row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur adipiscing`,
  ).join('\n');
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'make noise' },
    tool_use_id: 'toolu_exit',
    tool_response: { stdout: rows, stderr: '', interrupted: false, isImage: false },
  });
}

interface RunResult {
  stdout: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

/** Spawn `node <args>` with payload on stdin; never waits past EXIT_BOUND_MS. */
function runNode(args: string[], env: NodeJS.ProcessEnv, input: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const guard = setTimeout(() => {
      child.kill('SIGKILL'); // only reached when the hook hangs — test fails
      resolve({ stdout, code: null, signal: null, timedOut: true });
    }, EXIT_BOUND_MS);
    child.on('exit', (code, signal) => {
      clearTimeout(guard);
      // surface crashes (e.g. TS-stripping issues) instead of opaque failures
      if (code !== 0 && stderr !== '') {
        console.error('child stderr:', stderr.slice(0, 500));
      }
      resolve({ stdout, code, signal, timedOut: false });
    });
    child.stdin.end(input);
  });
}

async function hungLedgerDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'compressor-hung-ledger-'));
  // reader-less FIFO at this month's ledger file: open(2) blocks forever,
  // standing in for a hung network mount
  const month = new Date().toISOString().slice(0, 7);
  await execFileAsync('mkfifo', [join(dir, `${month}.jsonl`)]);
  return dir;
}

function envWithLedger(dir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, COMPRESSOR_LEDGER_DIR: dir };
  delete env['COMPRESSOR_NO_LEDGER']; // the ledger write MUST be attempted
  return env;
}

test('bundled hook entry: stuck ledger fs cannot hang the process', { skip: skipFifo }, async (t) => {
  const dir = await hungLedgerDir();
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const result = await runNode([HOOK_ENTRY, '--mode', 'slim'], envWithLedger(dir), compressiblePayload());
  assert.equal(result.timedOut, false, 'hook process never exited (agent would hang)');
  // stdout was fully delivered BEFORE the settle race
  const parsed = JSON.parse(result.stdout) as {
    hookSpecificOutput?: { updatedToolOutput?: { stdout?: string } };
  };
  assert.ok(parsed.hookSpecificOutput?.updatedToolOutput?.stdout?.includes('[compressor:'));
  // blocked threadpool join is escaped via kernel-level SIGKILL; the
  // non-zero exit makes the host ignore stdout for this call — fail-open
  assert.equal(result.signal, 'SIGKILL');
});

test('copilot hook entry: stuck ledger fs cannot hang the process', { skip: skipFifo }, async (t) => {
  const dir = await hungLedgerDir();
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const payload = JSON.stringify({
    toolName: 'bash',
    toolArgs: '{"command":"make noise"}',
    toolResult: {
      resultType: 'success',
      textResultForLlm: (JSON.parse(compressiblePayload()) as { tool_response: { stdout: string } })
        .tool_response.stdout,
    },
  });
  const result = await runNode([COPILOT_ENTRY, '--mode', 'slim'], envWithLedger(dir), payload);
  assert.equal(result.timedOut, false, 'copilot hook process never exited');
  const parsed = JSON.parse(result.stdout) as {
    modifiedResult?: { textResultForLlm?: string };
  };
  assert.ok(parsed.modifiedResult?.textResultForLlm?.includes('[compressor:'));
  assert.equal(result.signal, 'SIGKILL');
});

test('CLI protocol path has the same exit bound as the bundles', { skip: skipFifo }, async (t) => {
  const dir = await hungLedgerDir();
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // previously: no settle race at all — the process waited for the append
  const result = await runNode(
    [CLI_ENTRY, 'hook', 'post-tool-use', '--mode', 'slim'],
    envWithLedger(dir),
    compressiblePayload(),
  );
  assert.equal(result.timedOut, false, 'CLI hook subcommand never exited');
  const parsed = JSON.parse(result.stdout) as {
    hookSpecificOutput?: { updatedToolOutput?: { stdout?: string } };
  };
  assert.ok(parsed.hookSpecificOutput?.updatedToolOutput?.stdout?.includes('[compressor:'));
  assert.equal(result.signal, 'SIGKILL');
});

test('healthy ledger: hook exits 0 quickly and the event is recorded', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'compressor-healthy-ledger-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const result = await runNode([HOOK_ENTRY, '--mode', 'slim'], envWithLedger(dir), compressiblePayload());
  assert.equal(result.timedOut, false);
  assert.equal(result.code, 0, 'clean exit when the ledger flushes in time');
  assert.equal(result.signal, null);
  assert.ok(result.stdout.includes('[compressor:'));

  const month = new Date().toISOString().slice(0, 7);
  const ledger = await readFile(join(dir, `${month}.jsonl`), 'utf8');
  const lines = ledger.trim().split('\n');
  assert.equal(lines.length, 1, 'exactly one event for one compression');
  const event = JSON.parse(lines[0] ?? '') as { agent: string; tool: string };
  assert.equal(event.agent, 'claude-code');
  assert.equal(event.tool, 'bash');
});
