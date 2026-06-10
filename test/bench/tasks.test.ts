import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSuite, suiteFixturesDir } from '../../src/bench/tasks.ts';

const SUITE_PATH = fileURLToPath(new URL('../../bench/suites/basic.json', import.meta.url));

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

test('loadSuite accepts bench/suites/basic.json with 6 unique tasks', async () => {
  const suite = await loadSuite(SUITE_PATH);
  assert.equal(suite.name, 'basic');
  assert.equal(suite.tasks.length, 6);
  const ids = suite.tasks.map((t) => t.id);
  assert.equal(new Set(ids).size, 6);
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

test('every command-check fixture ships broken and its fix.patch.json repairs it', async () => {
  const suite = await loadSuite(SUITE_PATH);
  const fixturesDir = suiteFixturesDir(SUITE_PATH);
  const commandTasks = suite.tasks.filter((t) => t.check.kind === 'command');
  assert.equal(commandTasks.length, 5);

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
