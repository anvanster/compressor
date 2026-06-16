import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards the HONEST-A/B invariants of the CCR benchmark fixtures (the rig these
// tests exist to prevent: an answer the CCR-off control recovers with one cheap
// grep, making measured "savings" fake). The two properties that keep the A/B
// honest:
//   1. POSITION/RELATION-ONLY answer: among ~87 near-identical blocks (same
//      header, same metric NAMES / same function-name pool, same magnitudes),
//      EXACTLY ONE satisfies a relational predicate (checksum==sum of its values
//      / framesum==sum of its frame line numbers) that no grep/PCRE can evaluate.
//   2. NO trivial escape: each real answer line appears EXACTLY ONCE in the whole
//      output (no decoy reproduces a real pair/frame), so a keyword/anchor grep
//      dump fails the exact checker.
// Plus the checker contract: PASS on the exact real answer; FAIL on a wrong value,
// a grep-dump of all candidates, or a missing file.

const fixturesDir = fileURLToPath(new URL('../../bench/fixtures', import.meta.url));

function runScript(fixture: string): string {
  const script = path.join(fixturesDir, fixture, 'run.sh');
  return execFileSync('sh', [script], { maxBuffer: 64 * 1024 * 1024 }).toString();
}

async function runCheck(fixture: string, workDir: string): Promise<number> {
  const check = path.join(fixturesDir, fixture, 'check.sh');
  try {
    execFileSync('sh', [check, workDir], {
      env: { ...process.env, COMPRESSOR_FIXTURE_DIR: path.join(fixturesDir, fixture) },
      stdio: 'pipe',
    });
    return 0;
  } catch (error) {
    const code = (error as { status?: number }).status;
    return typeof code === 'number' ? code : -1;
  }
}

const REAL_METRICS = [
  'metric: orders_total=48217',
  'metric: revenue_usd=1039482',
  'metric: refunds_total=1322',
  'metric: active_users=90431',
  'metric: error_rate_ppm=47',
  'metric: p99_latency_ms=812',
];
const REAL_FRAMES = [
  '  at chargeWithRetry (billing/retry.js:88:17)',
  '  at applyVolumePricing (billing/pricing.js:142:9)',
  '  at settleInvoice (billing/invoice.js:57:23)',
  '  at processOrder (orders/process.js:204:11)',
  '  at handleRequest (server/router.js:319:7)',
];

test('ccr-analysis-block: exactly ONE block satisfies checksum==sum, and it is the real one', () => {
  const lines = runScript('ccr-analysis-block').split('\n');
  let satisfying = 0;
  let realSatisfies = false;
  let blocks = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = /^>>> audit run=\S+ checksum=(\d+) <<<$/.exec(line);
    if (m === null) continue;
    if (lines[i + 1] !== '=== ANALYSIS SECTION ===') continue;
    blocks++;
    const checksum = Number(m[1]);
    const vals: string[] = [];
    let sum = 0;
    let j = i + 2;
    for (; j < lines.length && lines[j] !== '=== END ANALYSIS SECTION ==='; j++) {
      const ln = lines[j] ?? '';
      if (ln.startsWith('metric:')) {
        vals.push(ln);
        sum += Number(ln.split('=')[1]);
      }
    }
    if (sum === checksum) {
      satisfying++;
      if (vals.length === 6 && REAL_METRICS.every((r) => vals.includes(r))) realSatisfies = true;
    }
  }
  assert.ok(blocks >= 50, `expected many decoy blocks, got ${blocks}`);
  assert.equal(satisfying, 1, 'exactly one block must satisfy checksum==sum (the relational predicate)');
  assert.ok(realSatisfies, 'the unique satisfying block must be the real rollup');
});

test('ccr-error-context: exactly ONE crash satisfies framesum==sum(line numbers), and it is the real one', () => {
  const lines = runScript('ccr-error-context').split('\n');
  let satisfying = 0;
  let realSatisfies = false;
  let blocks = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = /^>>> request rid=\S+ framesum=(\d+) <<<$/.exec(line);
    if (m === null) continue;
    if (lines[i + 1] !== 'FATAL unhandled exception in request handler') continue;
    blocks++;
    const framesum = Number(m[1]);
    const frames: string[] = [];
    let sum = 0;
    let j = i + 2;
    for (; j < lines.length && (lines[j] ?? '').startsWith('  at '); j++) {
      const ln = lines[j] ?? '';
      frames.push(ln);
      sum += Number(ln.split('(')[1]?.split(':')[1]);
    }
    if (sum === framesum) {
      satisfying++;
      if (frames.length === 5 && REAL_FRAMES.every((r) => frames.includes(r))) realSatisfies = true;
    }
  }
  assert.ok(blocks >= 50, `expected many decoy crashes, got ${blocks}`);
  assert.equal(satisfying, 1, 'exactly one crash must satisfy framesum==sum (the relational predicate)');
  assert.ok(realSatisfies, 'the unique satisfying crash must be the real one');
});

test('each real answer line appears EXACTLY ONCE across the whole output (no grep-dump escape)', () => {
  const ab = runScript('ccr-analysis-block').split('\n');
  for (const r of REAL_METRICS) {
    assert.equal(ab.filter((l) => l === r).length, 1, `real pair must be unique: ${r}`);
  }
  const ec = runScript('ccr-error-context').split('\n');
  for (const r of REAL_FRAMES) {
    assert.equal(ec.filter((l) => l === r).length, 1, `real frame must be unique: ${r.trim()}`);
  }
});

test('anchor grep over the shared header returns MANY candidate blocks, not the isolated answer', () => {
  // grep -A on the (shared) header pulls every block — the off-arm cannot isolate
  const ab = runScript('ccr-analysis-block').split('\n');
  const abHeaders = ab.filter((l) => l === '=== ANALYSIS SECTION ===').length;
  assert.ok(abHeaders >= 50, `delimiter must be shared by many decoys, got ${abHeaders}`);
  const ec = runScript('ccr-error-context').split('\n');
  const ecHeaders = ec.filter((l) => l === 'FATAL unhandled exception in request handler').length;
  assert.ok(ecHeaders >= 50, `FATAL header must be shared by many decoys, got ${ecHeaders}`);
});

test('check.sh: PASS on the exact answer, FAIL on wrong value / grep-dump / missing file', async (t) => {
  const ws = await mkdtemp(path.join(tmpdir(), 'ccr-check-ws-'));
  t.after(async () => {
    await rm(ws, { recursive: true, force: true });
  });

  // missing file → FAIL
  assert.notEqual(await runCheck('ccr-analysis-block', ws), 0, 'missing metrics.txt must FAIL');
  assert.notEqual(await runCheck('ccr-error-context', ws), 0, 'missing stack.txt must FAIL');

  // exact correct answer → PASS
  await writeFile(
    path.join(ws, 'metrics.txt'),
    REAL_METRICS.map((m) => m.replace('metric: ', '')).join('\n') + '\n',
  );
  await writeFile(path.join(ws, 'stack.txt'), REAL_FRAMES.map((f) => f.trim()).join('\n') + '\n');
  assert.equal(await runCheck('ccr-analysis-block', ws), 0, 'exact metrics must PASS');
  assert.equal(await runCheck('ccr-error-context', ws), 0, 'exact frames must PASS');

  // grep-dump of ALL metric/frame lines → FAIL (foreign values/frames present)
  const ab = runScript('ccr-analysis-block').split('\n');
  await writeFile(
    path.join(ws, 'metrics.txt'),
    ab.filter((l) => l.startsWith('metric:')).map((l) => l.replace('metric: ', '')).join('\n') + '\n',
  );
  assert.notEqual(await runCheck('ccr-analysis-block', ws), 0, 'metric grep-dump must FAIL');

  const ec = runScript('ccr-error-context').split('\n');
  await writeFile(
    path.join(ws, 'stack.txt'),
    ec.filter((l) => l.trim().startsWith('at ')).map((l) => l.trim()).join('\n') + '\n',
  );
  assert.notEqual(await runCheck('ccr-error-context', ws), 0, 'frame grep-dump must FAIL');
});
