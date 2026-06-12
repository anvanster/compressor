import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cellEnv } from '../../src/bench/cell.ts';
import { runBenchmark } from '../../src/bench/runner.ts';

// Regression: hook-bearing bench cells run the REAL hook, and the hook's
// recordCompression appends to the user's LIVE savings ledger
// (~/.compressor/ledger) unless COMPRESSOR_NO_LEDGER=1 is exported to the
// cell. Without it every benchmark run pollutes the production ledger that
// `compressor savings` reports on — hundreds of synthetic events
// indistinguishable from live agent traffic.

const FAKE_CLAUDE = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url));
process.env.COMPRESSOR_CLAUDE_BIN = FAKE_CLAUDE;

test('cellEnv isolates the config dir AND disables the savings ledger', () => {
  const env = cellEnv('/tmp/scratch-xyz');
  assert.equal(env['CLAUDE_CONFIG_DIR'], '/tmp/scratch-xyz');
  assert.equal(env['COMPRESSOR_NO_LEDGER'], '1');
});

test('the claude child process actually receives COMPRESSOR_NO_LEDGER=1', async (t) => {
  const fixturesDir = await mkdtemp(join(tmpdir(), 'bench-fixtures-'));
  await mkdir(join(fixturesDir, 'qa'));
  await writeFile(join(fixturesDir, 'qa', 'notes.txt'), 'hello\n');
  const outDir = await mkdtemp(join(tmpdir(), 'bench-out-'));
  const probeFile = join(outDir, 'env-probe.json');
  process.env.FAKE_CLAUDE_ENV_FILE = probeFile;
  t.after(async () => {
    delete process.env.FAKE_CLAUDE_ENV_FILE;
    await rm(fixturesDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  const { results } = await runBenchmark({
    suite: {
      name: 'env-probe',
      tasks: [
        {
          id: 'q',
          prompt: 'q',
          fixture: 'qa',
          check: { kind: 'answer-regex', pattern: 'fake answer' },
        },
      ],
    },
    variants: [{ id: 'full', baseMode: 'full', styleBody: null, styleName: null, hook: false }],
    trials: 1,
    model: 'test-model',
    maxBudgetUsd: 1,
    concurrency: 1,
    outDir,
    fixturesDir,
  });
  assert.equal(results[0]?.error, undefined);

  const probe = JSON.parse(await readFile(probeFile, 'utf8')) as {
    noLedger: string | null;
    configDir: string | null;
  };
  assert.equal(probe.noLedger, '1', 'cell must export the ledger kill switch');
  // and the config dir is the per-cell scratch, never the user's real one
  assert.ok(probe.configDir !== null && probe.configDir !== '');
  assert.notEqual(probe.configDir, process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'));
});

test('cellEnv strips the other auth mode\'s credential (deterministic billing)', () => {
  const savedKey = process.env['ANTHROPIC_API_KEY'];
  const savedTok = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  try {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    process.env['CLAUDE_CODE_OAUTH_TOKEN'] = 'oauth-test';
    const api = cellEnv('/scratch', 'api');
    assert.equal(api['ANTHROPIC_API_KEY'], 'sk-test');
    assert.equal('CLAUDE_CODE_OAUTH_TOKEN' in api, false);
    const sub = cellEnv('/scratch', 'subscription');
    assert.equal(sub['CLAUDE_CODE_OAUTH_TOKEN'], 'oauth-test');
    assert.equal('ANTHROPIC_API_KEY' in sub, false);
    // default = api
    assert.equal('CLAUDE_CODE_OAUTH_TOKEN' in cellEnv('/scratch'), false);
  } finally {
    if (savedKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = savedKey;
    if (savedTok === undefined) delete process.env['CLAUDE_CODE_OAUTH_TOKEN'];
    else process.env['CLAUDE_CODE_OAUTH_TOKEN'] = savedTok;
  }
});
