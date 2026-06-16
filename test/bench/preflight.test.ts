import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  assertCcrRetrieveWorks,
  assertHookHandlesMarkerStyle,
} from '../../src/cli/commands/benchmark.ts';

// Regression: the benchmark preflight verified only that dist/hook.js EXISTS.
// The hook entry parses argv fail-open, so a stale bundle that predates
// --marker-style ignores the flag silently — all experiment arms collapse to
// 'plain' and the run measures pure noise with zero errors anywhere. The
// preflight must pipe an over-budget payload through the exact hook command
// with two styles and require the outputs to differ.

const HOOK_ENTRY = fileURLToPath(new URL('../../src/hook-entry.ts', import.meta.url));

/** Stub hook bundles: read stdin fully, emit per the scenario. */
const RESPONSIVE_STUB = `
let data = '';
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', () => {
  const i = process.argv.indexOf('--marker-style');
  const style = i === -1 ? 'plain' : process.argv[i + 1];
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { updatedToolOutput: 'compressed style=' + style } }));
});
`;

const STALE_STUB = `
let data = '';
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', () => {
  // pre---marker-style bundle: flag silently ignored, output identical
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { updatedToolOutput: 'compressed style=plain' } }));
});
`;

const SILENT_STUB = `
process.stdin.resume();
process.stdin.on('end', () => { process.exit(0); });
`;

async function writeStub(dir: string, name: string, body: string): Promise<string> {
  const file = join(dir, name);
  await writeFile(file, body, 'utf8');
  return `node "${file}" --mode optimized`;
}

test('marker-style preflight: passes a bundle that honors the flag, rejects stale/silent ones', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'compressor-preflight-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const responsive = await writeStub(dir, 'responsive.js', RESPONSIVE_STUB);
  await assertHookHandlesMarkerStyle(responsive); // resolves

  const stale = await writeStub(dir, 'stale.js', STALE_STUB);
  await assert.rejects(
    () => assertHookHandlesMarkerStyle(stale),
    /byte-identical .* ignores the flag \(stale bundle\)/,
  );

  const silent = await writeStub(dir, 'silent.js', SILENT_STUB);
  await assert.rejects(
    () => assertHookHandlesMarkerStyle(silent),
    /emitted nothing for an over-budget payload/,
  );
});

test('marker-style preflight: the real hook entry honors --marker-style end-to-end', async () => {
  // exercises the exact code path a real run preflights — would catch the
  // entry's argv parsing or marker plumbing regressing to style-blind
  await assertHookHandlesMarkerStyle(`node "${HOOK_ENTRY}" --mode optimized`);
  await assertHookHandlesMarkerStyle(`node "${HOOK_ENTRY}" --mode slim`);
});

const CLI_ENTRY = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));

/** A PATH dir whose `compressor` shim runs the given CLI body via tsx/node. */
async function makeCompressorPath(dir: string, body: string): Promise<string> {
  const file = join(dir, 'compressor');
  await writeFile(file, body, 'utf8');
  await chmod(file, 0o755);
  // include the dir holding the real node so the hook's own `node` resolves
  return dir + delimiter + dirname(execPath) + delimiter + '/usr/bin' + delimiter + '/bin';
}

test('CCR preflight: passes when `compressor retrieve` round-trips a freshly-stashed chunk on the cell PATH', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'compressor-ccr-pf-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  // a real, retrieve-capable `compressor` shim → the REAL CLI entry
  const cellPath = await makeCompressorPath(
    dir,
    `#!/usr/bin/env sh\nexec "${execPath}" --experimental-strip-types "${CLI_ENTRY}" "$@"\n`,
  );
  // the real hook entry stashes the chunk under COMPRESSOR_CCR_DIR (set inside
  // the preflight) and the shim retrieves it back — proves end-to-end delivery
  await assertCcrRetrieveWorks(`node "${HOOK_ENTRY}" --mode optimized`, cellPath);
});

test('CCR preflight: rejects a stale `compressor` that lacks the retrieve subcommand', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'compressor-ccr-pf-stale-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  // a stale build mimics commander's unknown-command for `retrieve`
  const cellPath = await makeCompressorPath(
    dir,
    `#!/usr/bin/env sh\necho "error: unknown command 'retrieve'" >&2\nexit 1\n`,
  );
  await assert.rejects(
    () => assertCcrRetrieveWorks(`node "${HOOK_ENTRY}" --mode optimized`, cellPath),
    /stale or lacks the retrieve subcommand|does not know the 'retrieve' subcommand/,
  );
});
