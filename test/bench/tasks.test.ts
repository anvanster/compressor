import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSuite, suiteFixturesDir } from '../../src/bench/tasks.ts';
import { detectKind } from '../../src/engine/detect.ts';
import { filterTestLog } from '../../src/engine/tiers/logs.ts';

const SUITE_PATH = fileURLToPath(new URL('../../bench/suites/basic.json', import.meta.url));
const MAIN_SUITE_PATH = fileURLToPath(new URL('../../bench/suites/main.json', import.meta.url));

/** Shipped suites: every per-suite test below runs over each entry. */
const SUITES = [
  { name: 'basic', path: SUITE_PATH, taskCount: 6, commandTaskCount: 5 },
  { name: 'main', path: MAIN_SUITE_PATH, taskCount: 10, commandTaskCount: 7 },
] as const;

async function writeTmpSuite(spec: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'compressor-suite-'));
  const file = path.join(dir, 'suite.json');
  await writeFile(file, JSON.stringify(spec), 'utf8');
  return file;
}

function taskTemplate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a-task',
    prompt: 'do the thing',
    fixture: 'a-fixture',
    check: { kind: 'command', command: 'node --test test.mjs' },
    ...over,
  };
}

for (const spec of SUITES) {
  test(`loadSuite accepts bench/suites/${spec.name}.json with ${spec.taskCount} unique tasks`, async () => {
    const suite = await loadSuite(spec.path);
    assert.equal(suite.name, spec.name);
    assert.equal(suite.tasks.length, spec.taskCount);
    const ids = suite.tasks.map((t) => t.id);
    assert.equal(new Set(ids).size, spec.taskCount);
  });
}

test('basic suite ships exactly the original 6 tasks', async () => {
  const suite = await loadSuite(SUITE_PATH);
  const ids = suite.tasks.map((t) => t.id);
  assert.deepEqual(ids.sort(), [
    'add-function',
    'bugfix-off-by-one',
    'diagnose-failing-test',
    'explain-codebase',
    'large-file-edit',
    'refactor-extract',
  ]);
  const regexTask = suite.tasks.find((t) => t.check.kind === 'answer-regex');
  assert.ok(regexTask);
  assert.deepEqual(regexTask.tags, ['output-heavy']);
});

test('main suite = the 6 basic tasks verbatim + the 4 expansion tasks', async () => {
  const basic = await loadSuite(SUITE_PATH);
  const main = await loadSuite(MAIN_SUITE_PATH);
  assert.equal(main.tasks.length, 10);
  // first 6 tasks are basic.json verbatim — same specs in the same order
  assert.deepEqual(main.tasks.slice(0, 6), basic.tasks);
  assert.deepEqual(
    main.tasks.slice(6).map((t) => t.id),
    ['review-diff', 'summarize-architecture', 'huge-log-diagnosis', 'wide-refactor'],
  );
  // the two new prose tasks judge the answer text; the two new hook-target
  // tasks judge via command checks and are tagged for reporting
  for (const id of ['review-diff', 'summarize-architecture']) {
    const task = main.tasks.find((t) => t.id === id);
    assert.ok(task);
    assert.equal(task.check.kind, 'answer-regex');
    assert.deepEqual(task.tags, ['output-heavy', 'prose']);
  }
  for (const id of ['huge-log-diagnosis', 'wide-refactor']) {
    const task = main.tasks.find((t) => t.id === id);
    assert.ok(task);
    assert.equal(task.check.kind, 'command');
    assert.ok(task.tags?.includes('hook-target'), `${id} must carry the hook-target tag`);
  }
});

test('suiteFixturesDir resolves the sibling fixtures directory', () => {
  assert.equal(
    suiteFixturesDir(SUITE_PATH),
    path.resolve(path.dirname(SUITE_PATH), '..', 'fixtures'),
  );
  assert.ok(suiteFixturesDir(SUITE_PATH).endsWith(path.join('bench', 'fixtures')));
});

test('loadSuite rejects duplicate task ids', async () => {
  const file = await writeTmpSuite({
    name: 'bad',
    tasks: [taskTemplate({ id: 'dup' }), taskTemplate({ id: 'dup' })],
  });
  await assert.rejects(loadSuite(file), /task dup: duplicate id/);
});

test('loadSuite rejects an unknown check kind', async () => {
  const file = await writeTmpSuite({
    name: 'bad',
    tasks: [taskTemplate({ check: { kind: 'vibes' } })],
  });
  await assert.rejects(loadSuite(file), /task a-task: unknown check kind "vibes"/);
});

test('loadSuite rejects a non-compiling answer-regex pattern', async () => {
  const file = await writeTmpSuite({
    name: 'bad',
    tasks: [taskTemplate({ check: { kind: 'answer-regex', pattern: '(unclosed' } })],
  });
  await assert.rejects(loadSuite(file), /task a-task: answer-regex pattern does not compile/);
});

test('loadSuite rejects a fixture name containing a path separator', async () => {
  for (const fixture of ['../escape', 'nested/dir', 'win\\dir', '..']) {
    const file = await writeTmpSuite({ name: 'bad', tasks: [taskTemplate({ fixture })] });
    await assert.rejects(loadSuite(file), /task a-task: fixture must be a bare directory name/);
  }
});

test('loadSuite rejects empty prompts, missing ids, and bad tags', async () => {
  await assert.rejects(
    loadSuite(await writeTmpSuite({ name: 'bad', tasks: [taskTemplate({ prompt: '' })] })),
    /task a-task: prompt/,
  );
  await assert.rejects(
    loadSuite(await writeTmpSuite({ name: 'bad', tasks: [{ prompt: 'p' }] })),
    /task at index 0: id/,
  );
  await assert.rejects(
    loadSuite(await writeTmpSuite({ name: 'bad', tasks: [taskTemplate({ tags: [1] })] })),
    /task a-task: tags/,
  );
});

interface PatchEntry {
  file: string;
  find: string;
  replace: string;
}

/** Mirrors the fake-claude stub: find === '' means create the file with `replace`. */
async function applyFixPatch(workdir: string): Promise<void> {
  const raw = await readFile(path.join(workdir, 'fix.patch.json'), 'utf8');
  const entries = JSON.parse(raw) as PatchEntry[];
  assert.ok(entries.length > 0, 'fix.patch.json must not be empty');
  for (const entry of entries) {
    const target = path.join(workdir, entry.file);
    if (entry.find === '') {
      await writeFile(target, entry.replace, 'utf8');
      continue;
    }
    const content = await readFile(target, 'utf8');
    assert.ok(content.includes(entry.find), `${entry.file}: find text not present`);
    await writeFile(target, content.replaceAll(entry.find, entry.replace), 'utf8');
  }
}

function runCheck(command: string, cwd: string): number | null {
  // NODE_TEST_CONTEXT leaks from this test runner and makes a child
  // `node --test` report via IPC instead of its exit code — strip it.
  const env = { ...process.env };
  delete env['NODE_TEST_CONTEXT'];
  const result = spawnSync(command, { shell: true, cwd, env, encoding: 'utf8', timeout: 60_000 });
  return result.status;
}

for (const spec of SUITES) {
  test(`every command-check fixture in ${spec.name} ships broken and its fix.patch.json repairs it`, async () => {
    const suite = await loadSuite(spec.path);
    const fixturesDir = suiteFixturesDir(spec.path);
    const commandTasks = suite.tasks.filter((t) => t.check.kind === 'command');
    assert.equal(commandTasks.length, spec.commandTaskCount);

    for (const task of commandTasks) {
      assert.equal(task.check.kind, 'command');
      const command = task.check.kind === 'command' ? task.check.command : '';
      const workdir = await mkdtemp(path.join(os.tmpdir(), `compressor-fx-${task.id}-`));
      await cp(path.join(fixturesDir, task.fixture), workdir, { recursive: true });

      const brokenStatus = runCheck(command, workdir);
      assert.notEqual(brokenStatus, 0, `${task.id}: shipped fixture check must fail`);
      assert.notEqual(brokenStatus, null, `${task.id}: check did not run`);

      await applyFixPatch(workdir);
      assert.equal(runCheck(command, workdir), 0, `${task.id}: patched fixture check must pass`);
    }
  });
}

test('hook-target fixtures exceed the engine compression thresholds', async () => {
  const fixturesDir = suiteFixturesDir(MAIN_SUITE_PATH);

  // wide-refactor: each refactor-target module must sit above the slim
  // skeleton tier (~6k est tokens, chars/3.5 heuristic) so the hook engages
  for (const name of ['telemetry.mjs', 'manifest.mjs', 'beacon.mjs']) {
    const content = await readFile(path.join(fixturesDir, 'wide-refactor', name), 'utf8');
    const estTokens = content.length / 3.5;
    assert.ok(
      estTokens > 6_000,
      `wide-refactor/${name}: ~${Math.round(estTokens)} est tokens — under the 6k skeleton tier, hook would not engage`,
    );
  }

  // huge-log-diagnosis: the engine gates on estimated TOKENS (chars/3.5),
  // not lines — engine/index.ts compares estimate(content) against the slim
  // policy's logFilter (800 est tokens) and truncateBudget (2,500 est tokens).
  // The dump must dwarf both.
  const log = await readFile(
    path.join(fixturesDir, 'huge-log-diagnosis', 'test-output.txt'),
    'utf8',
  );
  const logTokens = log.length / 3.5;
  assert.ok(
    logTokens > 8_000,
    `huge-log-diagnosis/test-output.txt: ~${Math.round(logTokens)} est tokens — too small to dwarf the slim logFilter (800) / truncateBudget (2,500) budgets`,
  );

  // size alone does not engage tier-3 log filtering: the engine only runs
  // filterTestLog when detectKind classifies the content as a test log
  // (engine/index.ts). A 'generic' dump would be silently mis-attributed to
  // the generic truncation tier instead.
  assert.equal(
    detectKind(log, 'test-output.txt'),
    'test-log',
    'huge-log-diagnosis/test-output.txt must classify as test-log or the tier-3 log filter never engages',
  );

  // and the filter must actually bite on this format — dropping passing-test
  // bulk while keeping the failure evidence the task needs to stay solvable
  const filtered = filterTestLog(log);
  assert.equal(filtered.transform?.id, 'log-filter');
  assert.ok(filtered.content.length < log.length, 'log filter dropped nothing');
  assert.match(filtered.content, /✖ failing tests:/);
  assert.match(filtered.content, /ℹ fail 3/);
  assert.doesNotMatch(filtered.content, /✔/);
});

test('explain-codebase answer-regex requires the mechanism, not just the identifier', async () => {
  const suite = await loadSuite(SUITE_PATH);
  const task = suite.tasks.find((t) => t.id === 'explain-codebase');
  assert.ok(task);
  assert.equal(task.check.kind, 'answer-regex');
  if (task.check.kind !== 'answer-regex') return;
  const re = new RegExp(task.check.pattern, task.check.flags);

  // correct answers: literal identifier, and a paraphrase without it
  assert.match(
    'Plugins register a beforeDispatch hook; the bus runs it on the envelope before any handler, and setting envelope.cancelled stops delivery.',
    re,
  );
  assert.match(
    'A plugin adds a before-dispatch phase that runs ahead of the handlers and can cancel the event so handlers never see it.',
    re,
  );
  // mechanism stated cancel-first
  assert.match(
    'The event is cancelled by a plugin during the before dispatch phase.',
    re,
  );

  // noise without the identifier
  assert.doesNotMatch('Handlers subscribe with bus.on and run in order.', re);
  // verbose WRONG answer that quotes the identifier and the API surface but
  // not the interception mechanism — must not pass
  assert.doesNotMatch(
    'registry.mjs exposes beforeDispatch and afterDispatch phases which run after handlers complete; plugins.mjs registers audit and redact plugins on the bus.',
    re,
  );
});

test('review-diff answer-regex demands bug evidence, not just leaked function names', async () => {
  const suite = await loadSuite(MAIN_SUITE_PATH);
  const task = suite.tasks.find((t) => t.id === 'review-diff');
  assert.ok(task);
  assert.equal(task.check.kind, 'answer-regex');
  if (task.check.kind !== 'answer-regex') return;
  const re = new RegExp(task.check.pattern, task.check.flags);

  // correct review citing the internal helper names with concrete evidence
  assert.match(
    'Bug 1: applyTierDiscount loops i <= tiers.length, reads past the end of the array, and throws a TypeError. Bug 2: chargeWithRetry swaps the attempt and delayMs arguments when it calls scheduleRetry.',
    re,
  );
  // correct review citing the natural exported/caller names, paraphrased
  assert.match(
    'The tier loop in applyVolumePricing iterates one past the end of the array, so tier is undefined and checkout throws. chargeWithRetry passes computeBackoff(attempt) as the attempt count and attempt + 1 as the delay — the argument order is wrong.',
    re,
  );
  // terse correct review
  assert.match(
    'Two bugs: off-by-one in applyTierDiscount (TypeError past the last tier), and chargeWithRetry calls scheduleRetry with attempt and delayMs reversed.',
    re,
  );

  // verbose-but-wrong: name-drops both functions, finds zero bugs — the
  // empirically demonstrated false positive against the old pattern
  assert.doesNotMatch(
    'The patch cleanly introduces tiered volume pricing via applyTierDiscount and resilient payment handling: chargeWithRetry consults scheduleRetry with exponential backoff. I found no defects; ready to merge.',
    re,
  );
  // one bug found, the other merely name-dropped — still not a pass
  assert.doesNotMatch(
    'applyTierDiscount has an off-by-one (i <= tiers.length, TypeError). chargeWithRetry handles transient failures via scheduleRetry; that part is correct.',
    re,
  );
});

test('summarize-architecture answer-regex requires the composition mechanism, not name-dropping', async () => {
  const suite = await loadSuite(MAIN_SUITE_PATH);
  const task = suite.tasks.find((t) => t.id === 'summarize-architecture');
  assert.ok(task);
  assert.equal(task.check.kind, 'answer-regex');
  if (task.check.kind !== 'answer-regex') return;
  const re = new RegExp(task.check.pattern, task.check.flags);

  // canonical answer: identifier plus mechanism
  assert.match(
    'foldPipeline composes errorBoundary, the app middleware, and routeDispatch with reduceRight, so the first middleware becomes the outermost layer of the onion.',
    re,
  );
  // correct terse paraphrase that never says the literal foldPipeline token
  assert.match(
    'Application.handle lazily composes errorBoundary, app middleware, and routeDispatch into an onion via reduceRight; thrown errors unwind to errorBoundary, which renders the error response.',
    re,
  );
  // mechanism without either identifier, plain words
  assert.match(
    'The middleware array is folded right-to-left, so the first registered middleware wraps all the others and errors propagate outward to the boundary.',
    re,
  );

  // flatly wrong lifecycle that name-drops the identifier — the empirically
  // demonstrated false positive against the old single-token pattern
  assert.doesNotMatch(
    'foldPipeline routes requests directly to handlers; errors are silently swallowed; middleware runs after the response is sent.',
    re,
  );
  // generic prose with no mechanism at all
  assert.doesNotMatch(
    'Requests enter the application, pass through middleware, reach the router, and a response is returned.',
    re,
  );
});

test('bugfix fixture is a multi-file repo with enough bulk to exercise context discipline', async () => {
  const dir = path.join(suiteFixturesDir(SUITE_PATH), 'bugfix-off-by-one');
  // fix.patch.json is the answer key — never copied into workspaces, so it
  // does not count toward the repo the agent sees
  const names = (await readdir(dir)).filter((name) => name !== 'fix.patch.json');
  assert.ok(names.length >= 10, `expected >=10 files, got ${names.length}`);

  const sizes = await Promise.all(
    names.map(async (name) => (await stat(path.join(dir, name))).size),
  );
  const total = sizes.reduce((sum, size) => sum + size, 0);
  // at least one file above the slim skeleton tier (~6k est tokens ≈ 24KB)
  assert.ok(Math.max(...sizes) >= 24_000, `largest file ${Math.max(...sizes)}B < 24KB`);
  // several files above the comment-strip tier (~2k est tokens ≈ 8KB)
  assert.ok(
    sizes.filter((size) => size >= 8_000).length >= 3,
    'expected >=3 files of >=8KB',
  );
  assert.ok(total >= 60_000, `fixture total ${total}B < 60KB`);
});
