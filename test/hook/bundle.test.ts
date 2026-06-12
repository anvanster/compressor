import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// The dist bundles are package.json bin entries (compressor-hook,
// compressor-copilot-hook) so the relocatable hook command runs them straight
// from PATH without loading the CLI — commander stays off the hot path. That
// requires a shebang (esbuild --banner:js), and the banner must not break the
// ESM bundle: garbage stdin must still fail open (exit 0, silent).
//
// These tests exercise the BUILT bundles; they skip when dist/ is absent
// (fresh clone) — `npm run build` first.

const HOOK_BUNDLE = fileURLToPath(new URL('../../dist/hook.js', import.meta.url));
const COPILOT_BUNDLE = fileURLToPath(new URL('../../dist/copilot-hook.js', import.meta.url));

const skipUnbuilt = !existsSync(HOOK_BUNDLE) || !existsSync(COPILOT_BUNDLE)
  ? 'dist bundles missing — run `npm run build` first'
  : false;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Spawn `node <bundle> --mode slim` with `input` on stdin; bounded. */
function runBundle(bundle: string, input: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundle, '--mode', 'slim'], {
      // never write the developer's real ledger from a test
      env: { ...process.env, COMPRESSOR_NO_LEDGER: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const guard = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('bundle did not exit'));
    }, 30_000);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(guard);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function noisyRows(): string {
  return Array.from(
    { length: 600 },
    (_, i) => `row ${String(i).padStart(5, '0')} lorem ipsum dolor sit amet consectetur adipiscing`,
  ).join('\n');
}

function compressiblePayload(): string {
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'make noise' },
    tool_use_id: 'toolu_bundle',
    tool_response: { stdout: noisyRows(), stderr: '', interrupted: false, isImage: false },
  });
}

function compressibleCopilotPayload(): string {
  return JSON.stringify({
    toolName: 'bash',
    toolArgs: '{"command":"make noise"}',
    toolResult: { resultType: 'success', textResultForLlm: noisyRows() },
  });
}

/**
 * Spawn the bundle but destroy the parent's read end of the child's stdout
 * pipe BEFORE the child can reply — its compressed-output write then raises
 * EPIPE. The invariant under test: hook entries ALWAYS exit 0 (a non-zero
 * exit is logged noise in Claude Code).
 */
function runBundleStdoutClosed(bundle: string, input: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundle, '--mode', 'slim'], {
      env: { ...process.env, COMPRESSOR_NO_LEDGER: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.destroy();
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const guard = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('bundle did not exit'));
    }, 30_000);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(guard);
      resolve({ code, stdout: '', stderr });
    });
    child.stdin.end(input);
  });
}

test('both dist bundles begin with the env-node shebang (bin entries must be directly executable)', { skip: skipUnbuilt }, async () => {
  for (const bundle of [HOOK_BUNDLE, COPILOT_BUNDLE]) {
    const body = await readFile(bundle, 'utf8');
    assert.ok(
      body.startsWith('#!/usr/bin/env node\n'),
      `${bundle} must start with the shebang banner`,
    );
  }
});

test('garbage stdin: bundles fail open — exit 0, silent (banner did not break ESM)', { skip: skipUnbuilt }, async () => {
  for (const bundle of [HOOK_BUNDLE, COPILOT_BUNDLE]) {
    const result = await runBundle(bundle, 'garbage');
    assert.equal(result.code, 0, `${bundle} stderr: ${result.stderr.slice(0, 300)}`);
    assert.equal(result.stdout, '', 'fail-open means emit nothing');
  }
});

test('regression: parent closes stdout early — EPIPE on the reply write still exits 0 (both bundles)', { skip: skipUnbuilt }, async () => {
  const cases = [
    { bundle: HOOK_BUNDLE, payload: compressiblePayload() },
    { bundle: COPILOT_BUNDLE, payload: compressibleCopilotPayload() },
  ];
  for (const { bundle, payload } of cases) {
    const result = await runBundleStdoutClosed(bundle, payload);
    assert.equal(
      result.code,
      0,
      `${bundle} must exit 0 on EPIPE; stderr: ${result.stderr.slice(0, 300)}`,
    );
  }
});

test('valid payload still compresses through the banner-carrying bundle', { skip: skipUnbuilt }, async () => {
  const result = await runBundle(HOOK_BUNDLE, compressiblePayload());
  assert.equal(result.code, 0, `stderr: ${result.stderr.slice(0, 300)}`);
  const parsed = JSON.parse(result.stdout) as {
    hookSpecificOutput?: { updatedToolOutput?: { stdout?: string } };
  };
  assert.ok(parsed.hookSpecificOutput?.updatedToolOutput?.stdout?.includes('[compressor:'));
});
