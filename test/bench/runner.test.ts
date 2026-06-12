import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SuiteSpec, Variant } from '../../src/bench/types.ts';
import { MAX_CONSECUTIVE_NO_COST_CELLS, runBenchmark } from '../../src/bench/runner.ts';
import { balanceWarning, readRun } from '../../src/bench/results.ts';

const FAKE_CLAUDE = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url));
process.env.COMPRESSOR_CLAUDE_BIN = FAKE_CLAUDE;

const fullVariant: Variant = {
  id: 'full',
  baseMode: 'full',
  styleBody: null,
  styleName: null,
  hook: false,
};
const styledVariant: Variant = {
  id: 'styled',
  baseMode: 'slim',
  styleBody: 'x',
  styleName: 'compressor-slim',
  hook: false,
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function makeFixtures(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bench-fixtures-'));
  await mkdir(join(dir, 'fix-me'));
  await writeFile(join(dir, 'fix-me', 'broken.txt'), 'status: BROKEN\n');
  await writeFile(
    join(dir, 'fix-me', 'fix.patch.json'),
    JSON.stringify([{ file: 'broken.txt', find: 'BROKEN', replace: 'FIXED' }]),
  );
  await mkdir(join(dir, 'qa'));
  await writeFile(join(dir, 'qa', 'notes.txt'), 'hello\n');
  return dir;
}

test('happy path: 2 tasks × 2 variants, checks judged, settings reach the binary', async (t) => {
  process.env.FAKE_CLAUDE_SUCCEED = '1';
  const fixturesDir = await makeFixtures();
  // the stub reads answer keys from the fixture SOURCE dir — the runner must
  // never copy fix.patch.json into the workspace
  process.env.FAKE_CLAUDE_FIXTURES_DIR = fixturesDir;
  const outDir = await mkdtemp(join(tmpdir(), 'bench-out-'));
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_SUCCEED;
    delete process.env.FAKE_CLAUDE_FIXTURES_DIR;
    await rm(fixturesDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  const realConfigDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const suite: SuiteSpec = {
    name: 'smoke',
    tasks: [
      {
        id: 'fix-bug',
        prompt: 'fix the bug',
        fixture: 'fix-me',
        check: { kind: 'command', command: 'grep -q FIXED broken.txt' },
      },
      {
        // matches only when the styled settings reached the binary AND the
        // config dir it saw is NOT the user's real one (isolation proof)
        id: 'styled-answer',
        prompt: 'answer the question',
        fixture: 'qa',
        check: {
          kind: 'answer-regex',
          // also proves headless cells run with bypassPermissions — without it
          // the model burns turns on Edit/Bash denials (observed live)
          pattern: `fake answer style=compressor-slim configDir=(?!${escapeRegExp(realConfigDir)}\\s)\\S+ permMode=bypassPermissions`,
        },
      },
    ],
  };

  const { runId, results, resultsFile } = await runBenchmark({
    suite,
    variants: [fullVariant, styledVariant],
    trials: 1,
    model: 'test-model',
    maxBudgetUsd: 1,
    concurrency: 2,
    outDir,
    fixturesDir,
  });

  assert.match(runId, /^bench-\d{8}-\d{6}$/);
  assert.equal(results.length, 4);
  const byKey = new Map(results.map((r) => [`${r.taskId}/${r.variantId}`, r]));

  // command task: baseline fails, the "agent" fixes it, post-check passes
  const fixFull = byKey.get('fix-bug/full');
  assert.ok(fixFull);
  assert.equal(fixFull.error, undefined);
  assert.equal(fixFull.baselineCheckPassed, false);
  assert.equal(fixFull.success, true);
  assert.deepEqual(fixFull.usage, {
    input: 9000,
    output: 400,
    cacheCreation: 2000,
    cacheRead: 30000,
  });
  assert.deepEqual(fixFull.toolCalls, { Read: 1, Bash: 1 });
  assert.deepEqual(fixFull.servedModels, ['test-model']);
  assert.equal(fixFull.costUsd, 0.01);
  assert.equal(fixFull.durationMs, 1200);
  assert.equal(fixFull.numTurns, 3);
  assert.equal(fixFull.permissionDenials, 0);
  assert.ok(fixFull.sessionId?.startsWith('fake-'));

  // answer-regex task: styled variant matches, full (style=none) does not
  const ansStyled = byKey.get('styled-answer/styled');
  assert.ok(ansStyled);
  assert.equal(ansStyled.baselineCheckPassed, null);
  assert.equal(ansStyled.success, true);
  const ansFull = byKey.get('styled-answer/full');
  assert.ok(ansFull);
  assert.equal(ansFull.success, false);

  const lines = (await readFile(resultsFile, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 4);

  const { meta } = await readRun(outDir, runId);
  assert.ok(meta);
  assert.equal(meta.suite, 'smoke');
  assert.deepEqual(meta.variantIds, ['full', 'styled']);
});

test('budget ceiling stops scheduling and records skipped cells', async (t) => {
  const fixturesDir = await makeFixtures();
  const outDir = await mkdtemp(join(tmpdir(), 'bench-out-'));
  t.after(async () => {
    await rm(fixturesDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  const suite: SuiteSpec = {
    name: 'budget',
    tasks: [
      {
        id: 'q',
        prompt: 'q',
        fixture: 'qa',
        check: { kind: 'answer-regex', pattern: 'fake answer' },
      },
    ],
  };
  const progress: string[] = [];
  const { results } = await runBenchmark({
    suite,
    variants: [fullVariant],
    trials: 6,
    model: 'test-model',
    maxBudgetUsd: 0.02,
    concurrency: 2,
    outDir,
    fixturesDir,
    onProgress: (line) => progress.push(line),
  });

  assert.equal(results.length, 6);
  const skipped = results.filter((r) =>
    r.error?.startsWith('skipped: budget ceiling'),
  );
  assert.ok(skipped.length >= 3, `expected >=3 skipped, got ${skipped.length}`);
  assert.equal(skipped[0]?.error, 'skipped: budget ceiling 0.02 USD reached');
  const ran = results.filter((r) => r.error === undefined);
  assert.ok(ran.length >= 2);
  assert.ok(progress.some((line) => line.includes('skipped: budget ceiling')));
});

test('claude failure yields an error cell without aborting the run', async (t) => {
  process.env.FAKE_CLAUDE_FAIL = '1';
  const fixturesDir = await makeFixtures();
  const outDir = await mkdtemp(join(tmpdir(), 'bench-out-'));
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_FAIL;
    await rm(fixturesDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  const suite: SuiteSpec = {
    name: 'failure',
    tasks: [
      {
        id: 'q',
        prompt: 'q',
        fixture: 'qa',
        check: { kind: 'answer-regex', pattern: 'fake answer' },
      },
    ],
  };
  const { results } = await runBenchmark({
    suite,
    variants: [fullVariant],
    trials: 1,
    model: 'test-model',
    maxBudgetUsd: 1,
    concurrency: 2,
    outDir,
    fixturesDir,
  });

  assert.equal(results.length, 1);
  const r = results[0];
  assert.ok(r);
  assert.ok(r.error !== undefined && r.error.length > 0);
  assert.equal(r.success, null);
  assert.deepEqual(r.usage, { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });
  assert.equal(r.costUsd, null);
  assert.equal(r.sessionId, null);
  assert.deepEqual(r.toolCalls, {});
});

test('cells that report no cost stop scheduling — the ceiling must not be silently defeated', async (t) => {
  process.env.FAKE_CLAUDE_NO_COST = '1';
  const fixturesDir = await makeFixtures();
  const outDir = await mkdtemp(join(tmpdir(), 'bench-out-'));
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_NO_COST;
    await rm(fixturesDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  const suite: SuiteSpec = {
    name: 'no-cost',
    tasks: [
      {
        id: 'q',
        prompt: 'q',
        fixture: 'qa',
        check: { kind: 'answer-regex', pattern: 'fake answer' },
      },
    ],
  };
  const { results } = await runBenchmark({
    suite,
    variants: [fullVariant],
    trials: 6,
    model: 'test-model',
    maxBudgetUsd: 5,
    concurrency: 1,
    outDir,
    fixturesDir,
  });

  assert.equal(results.length, 6);
  const ran = results.filter((r) => r.error === undefined);
  assert.equal(ran.length, MAX_CONSECUTIVE_NO_COST_CELLS);
  for (const r of ran) {
    assert.equal(r.costUsd, null);
  }
  const skipped = results.filter((r) => r.error?.startsWith('skipped:'));
  assert.equal(skipped.length, 6 - MAX_CONSECUTIVE_NO_COST_CELLS);
  for (const r of skipped) {
    assert.match(
      r.error ?? '',
      /skipped: \d+ consecutive cells reported no cost — budget ceiling 5 USD is unenforceable/,
    );
  }
});

// Regression: the budget stop must be task×trial-GROUP atomic. Checking the
// ceiling per cell can cut between variants of one task×trial (the first
// variant runs, the rest are skipped), which breaks the 'variants innermost'
// guarantee that an early stop still covers every variant on the tasks that
// did run — cross-arm comparisons need complete groups.
test('budget stop is group-atomic: a started task×trial group runs ALL variants', async (t) => {
  const fixturesDir = await makeFixtures();
  const outDir = await mkdtemp(join(tmpdir(), 'bench-out-'));
  t.after(async () => {
    await rm(fixturesDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  const suite: SuiteSpec = {
    name: 'group-atomic',
    tasks: [
      {
        id: 'q',
        prompt: 'q',
        fixture: 'qa',
        check: { kind: 'answer-regex', pattern: 'fake answer' },
      },
    ],
  };
  // each cell costs $0.01; the ceiling trips after the FIRST cell of trial 1,
  // i.e. mid-group — the second variant of trial 1 must still run
  const { results } = await runBenchmark({
    suite,
    variants: [fullVariant, styledVariant],
    trials: 3,
    model: 'test-model',
    maxBudgetUsd: 0.005,
    concurrency: 1,
    outDir,
    fixturesDir,
  });

  assert.equal(results.length, 6);
  const trial1 = results.filter((r) => r.trial === 1);
  assert.equal(trial1.length, 2);
  for (const r of trial1) {
    assert.equal(r.error, undefined, `trial 1 ${r.variantId} must run despite mid-group trip`);
  }
  const later = results.filter((r) => r.trial > 1);
  assert.equal(later.length, 4);
  for (const r of later) {
    assert.equal(r.error, 'skipped: budget ceiling 0.005 USD reached');
  }
  // executed cells stay balanced across variants — the post-run assertion agrees
  assert.equal(balanceWarning(results), null);
});

test('the answer key fix.patch.json never reaches the cell workspace', async (t) => {
  process.env.FAKE_CLAUDE_SUCCEED = '1';
  const fixturesDir = await makeFixtures();
  process.env.FAKE_CLAUDE_FIXTURES_DIR = fixturesDir;
  const outDir = await mkdtemp(join(tmpdir(), 'bench-out-'));
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_SUCCEED;
    delete process.env.FAKE_CLAUDE_FIXTURES_DIR;
    await rm(fixturesDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  const suite: SuiteSpec = {
    name: 'answer-key',
    tasks: [
      {
        // command checks run inside the workspace: pass only when the answer
        // key is absent both before (baseline) and after the agent ran
        id: 'no-answer-key',
        prompt: 'fix the bug',
        fixture: 'fix-me',
        check: { kind: 'command', command: 'test ! -e fix.patch.json' },
      },
      {
        // and the agent still solves the task without the key in cwd
        id: 'fix-bug',
        prompt: 'fix the bug',
        fixture: 'fix-me',
        check: { kind: 'command', command: 'grep -q FIXED broken.txt' },
      },
    ],
  };
  const { results } = await runBenchmark({
    suite,
    variants: [fullVariant],
    trials: 1,
    model: 'test-model',
    maxBudgetUsd: 1,
    concurrency: 1,
    outDir,
    fixturesDir,
  });

  const byTask = new Map(results.map((r) => [r.taskId, r]));
  const noKey = byTask.get('no-answer-key');
  assert.ok(noKey);
  assert.equal(noKey.error, undefined);
  assert.equal(noKey.baselineCheckPassed, true);
  assert.equal(noKey.success, true);
  const fixed = byTask.get('fix-bug');
  assert.ok(fixed);
  assert.equal(fixed.baselineCheckPassed, false);
  assert.equal(fixed.success, true);
});

test('duplicated transcript lines (same requestId) do not inflate tool-call counts', async (t) => {
  process.env.FAKE_CLAUDE_DUP_LINES = '1';
  const fixturesDir = await makeFixtures();
  const outDir = await mkdtemp(join(tmpdir(), 'bench-out-'));
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_DUP_LINES;
    await rm(fixturesDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  const suite: SuiteSpec = {
    name: 'dup-lines',
    tasks: [
      {
        id: 'q',
        prompt: 'q',
        fixture: 'qa',
        check: { kind: 'answer-regex', pattern: 'fake answer' },
      },
    ],
  };
  const { results } = await runBenchmark({
    suite,
    variants: [fullVariant],
    trials: 1,
    model: 'test-model',
    maxBudgetUsd: 1,
    concurrency: 1,
    outDir,
    fixturesDir,
  });

  const r = results[0];
  assert.ok(r);
  assert.equal(r.error, undefined);
  // PLAN.md dedupe rule: requestId/message.id, last occurrence wins
  assert.deepEqual(r.toolCalls, { Read: 1, Bash: 1 });
});

// ── subscription auth mode: plan-billed cells (no dollar cost exists) ───────

const QA_SUITE: SuiteSpec = {
  name: 'sub',
  tasks: [
    { id: 'q', prompt: 'q', fixture: 'qa', check: { kind: 'answer-regex', pattern: 'fake answer' } },
  ],
};

test('subscription mode: no-cost cells do NOT trip the breaker; progress shows tokens', async (t) => {
  const fixturesDir = await makeFixtures();
  const outDir = await mkdtemp(join(tmpdir(), 'bench-out-'));
  process.env.FAKE_CLAUDE_NO_COST = '1';
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_NO_COST;
    await rm(fixturesDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  const progress: string[] = [];
  const { results } = await runBenchmark({
    suite: QA_SUITE,
    variants: [fullVariant],
    trials: MAX_CONSECUTIVE_NO_COST_CELLS + 3,
    model: 'test-model',
    maxBudgetUsd: 5,
    concurrency: 2,
    outDir,
    fixturesDir,
    auth: 'subscription',
    onProgress: (line) => progress.push(line),
  });

  // in API mode the same stub config stops after MAX_CONSECUTIVE_NO_COST_CELLS
  // (pinned by the test above); under subscription every cell runs
  assert.equal(results.filter((r) => r.error === undefined).length, results.length);
  assert.ok(progress.every((line) => !line.includes('$')), 'no dollar display');
  assert.ok(
    progress.some((line) => /consumed \d+k tokens of plan usage/.test(line)),
    `token progress missing: ${progress[0] ?? '(none)'}`,
  );
});

test('subscription mode: --max-cells is a group-atomic hard ceiling', async (t) => {
  const fixturesDir = await makeFixtures();
  const outDir = await mkdtemp(join(tmpdir(), 'bench-out-'));
  process.env.FAKE_CLAUDE_NO_COST = '1';
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_NO_COST;
    await rm(fixturesDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  // 2 variants per group; maxCells 3 lands mid-group → the started group
  // finishes (4 executed), later groups skip
  const { results } = await runBenchmark({
    suite: QA_SUITE,
    variants: [fullVariant, styledVariant],
    trials: 4,
    model: 'test-model',
    maxBudgetUsd: 5,
    concurrency: 1,
    outDir,
    fixturesDir,
    auth: 'subscription',
    maxCells: 3,
    onProgress: () => {},
  });

  const executed = results.filter((r) => r.error === undefined);
  const skipped = results.filter((r) => r.error?.startsWith('skipped: cell ceiling'));
  assert.equal(executed.length, 4, 'started group completes all its arms');
  assert.equal(skipped.length, 4, 'remaining groups skipped');
  assert.match(skipped[0]?.error ?? '', /cell ceiling 3 reached/);
});

test('subscription mode: an unbroken error streak stops scheduling (dead token / exhausted window)', async (t) => {
  const fixturesDir = await makeFixtures();
  const outDir = await mkdtemp(join(tmpdir(), 'bench-out-'));
  process.env.FAKE_CLAUDE_FAIL = '1';
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_FAIL;
    await rm(fixturesDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  const { results } = await runBenchmark({
    suite: QA_SUITE,
    variants: [fullVariant],
    trials: 10,
    model: 'test-model',
    maxBudgetUsd: 5,
    concurrency: 1,
    outDir,
    fixturesDir,
    auth: 'subscription',
    onProgress: () => {},
  });

  const skipped = results.filter((r) => r.error?.startsWith('skipped:'));
  assert.ok(skipped.length >= 1, 'streak breaker engaged');
  assert.match(skipped[0]?.error ?? '', /consecutive cells errored/);
});
