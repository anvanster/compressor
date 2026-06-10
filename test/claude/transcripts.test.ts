import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addUsage,
  aggregateUsage,
  encodeProjectDir,
  findTranscripts,
  readSessionUsage,
  type UsageTotals,
} from '../../src/claude/transcripts.ts';

const FIXTURE = fileURLToPath(new URL('../fixtures/session.jsonl', import.meta.url));

test('encodeProjectDir matches Claude Code: every non-alphanumeric becomes a dash', () => {
  assert.equal(
    encodeProjectDir('/Users/x/projects/compressor'),
    '-Users-x-projects-compressor',
  );
  assert.equal(encodeProjectDir('/Users/x/my.app/v1.2'), '-Users-x-my-app-v1-2');
  assert.equal(encodeProjectDir('/Users/x/my_project'), '-Users-x-my-project');
  assert.equal(
    encodeProjectDir('/Users/x/my project (v2)'),
    '-Users-x-my-project--v2-',
  );
});

test('encodeProjectDir truncates at 200 chars with a base36 hash of the raw path', () => {
  const long = `/Users/x/${'a'.repeat(250)}`;
  assert.equal(
    encodeProjectDir(long),
    `-Users-x-${'a'.repeat(191)}-bai2wj`,
  );
  assert.equal(encodeProjectDir(long).length, 207);
});

test('readSessionUsage dedupes by requestId keeping the last occurrence', async () => {
  const session = await readSessionUsage(FIXTURE);

  // req_1 appears twice (streamed update) and counts once with final usage;
  // the garbage line, the non-assistant line, and the usage-less assistant
  // line are all skipped.
  assert.equal(session.turns, 2);
  assert.deepEqual(session.totals, {
    input: 120,
    output: 47,
    cacheCreation: 5,
    cacheRead: 50,
  });
});

test('readSessionUsage breaks out byModel and sidechain', async () => {
  const session = await readSessionUsage(FIXTURE);

  assert.deepEqual(Object.keys(session.byModel).sort(), [
    'claude-haiku-4-5',
    'claude-sonnet-4-6',
  ]);
  assert.deepEqual(session.byModel['claude-sonnet-4-6'], {
    input: 100,
    output: 42,
    cacheCreation: 5,
    cacheRead: 50,
  });
  assert.deepEqual(session.byModel['claude-haiku-4-5'], {
    input: 20,
    output: 5,
    cacheCreation: 0,
    cacheRead: 0,
  });

  // Sidechain usage is included in totals AND broken out separately.
  assert.deepEqual(session.sidechain, {
    input: 20,
    output: 5,
    cacheCreation: 0,
    cacheRead: 0,
  });
});

test('readSessionUsage extracts session metadata', async () => {
  const session = await readSessionUsage(FIXTURE);
  assert.equal(session.sessionId, 'sess-fixture-1');
  assert.equal(session.file, FIXTURE);
  assert.equal(session.firstTimestamp, '2026-06-09T10:00:00.000Z');
  assert.equal(session.lastTimestamp, '2026-06-09T10:01:00.000Z');
});

test('findTranscripts lists jsonl files in the encoded project dir', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'compressor-transcripts-'));
  try {
    const projectDir = '/Users/x/projects/my.app';
    const encoded = join(configDir, 'projects', encodeProjectDir(projectDir));
    await mkdir(encoded, { recursive: true });
    await copyFile(FIXTURE, join(encoded, 'abc-123.jsonl'));

    const found = await findTranscripts({ projectDir, configDir });
    assert.deepEqual(found, [join(encoded, 'abc-123.jsonl')]);

    const futureOnly = await findTranscripts({
      projectDir,
      configDir,
      since: new Date(Date.now() + 60_000),
    });
    assert.deepEqual(futureOnly, []);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test('findTranscripts returns [] when the project dir is missing', async () => {
  const found = await findTranscripts({
    projectDir: '/nonexistent/project/path',
    configDir: join(tmpdir(), 'compressor-no-such-config-dir'),
  });
  assert.deepEqual(found, []);
});

test('addUsage and aggregateUsage sum field-wise', async () => {
  const a: UsageTotals = { input: 1, output: 2, cacheCreation: 3, cacheRead: 4 };
  const b: UsageTotals = { input: 10, output: 20, cacheCreation: 30, cacheRead: 40 };
  assert.deepEqual(addUsage(a, b), {
    input: 11,
    output: 22,
    cacheCreation: 33,
    cacheRead: 44,
  });

  const session = await readSessionUsage(FIXTURE);
  assert.deepEqual(aggregateUsage([session, session]), addUsage(session.totals, session.totals));
  assert.deepEqual(aggregateUsage([]), {
    input: 0,
    output: 0,
    cacheCreation: 0,
    cacheRead: 0,
  });
});
