import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertHookHandlesMarkerStyle } from '../../src/cli/commands/benchmark.ts';

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
