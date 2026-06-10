import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SuiteSpec, TaskCheck, TaskSpec } from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseCheck(raw: unknown, taskId: string): TaskCheck {
  if (!isRecord(raw)) {
    throw new Error(`task ${taskId}: check must be an object`);
  }
  const kind = raw['kind'];
  if (kind === 'command') {
    const command = raw['command'];
    if (!nonEmptyString(command)) {
      throw new Error(`task ${taskId}: command check requires a non-empty command string`);
    }
    return { kind: 'command', command };
  }
  if (kind === 'answer-regex') {
    const pattern = raw['pattern'];
    if (!nonEmptyString(pattern)) {
      throw new Error(`task ${taskId}: answer-regex check requires a non-empty pattern string`);
    }
    const flags = raw['flags'];
    if (flags !== undefined && typeof flags !== 'string') {
      throw new Error(`task ${taskId}: answer-regex flags must be a string`);
    }
    try {
      new RegExp(pattern, flags);
    } catch (error) {
      throw new Error(
        `task ${taskId}: answer-regex pattern does not compile — ${message(error)}`,
      );
    }
    return flags === undefined
      ? { kind: 'answer-regex', pattern }
      : { kind: 'answer-regex', pattern, flags };
  }
  throw new Error(
    `task ${taskId}: unknown check kind ${JSON.stringify(kind)} (expected 'command' or 'answer-regex')`,
  );
}

function parseFixture(raw: unknown, taskId: string): string {
  if (!nonEmptyString(raw)) {
    throw new Error(`task ${taskId}: fixture must be a non-empty string`);
  }
  if (raw.includes('/') || raw.includes('\\') || raw === '.' || raw === '..') {
    throw new Error(
      `task ${taskId}: fixture must be a bare directory name (no path separators), got ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

function parseTask(raw: unknown, index: number, seenIds: Set<string>): TaskSpec {
  if (!isRecord(raw)) {
    throw new Error(`task at index ${index}: must be an object`);
  }
  const id = raw['id'];
  if (!nonEmptyString(id)) {
    throw new Error(`task at index ${index}: id must be a non-empty string`);
  }
  if (seenIds.has(id)) {
    throw new Error(`task ${id}: duplicate id`);
  }
  seenIds.add(id);

  const prompt = raw['prompt'];
  if (!nonEmptyString(prompt)) {
    throw new Error(`task ${id}: prompt must be a non-empty string`);
  }
  const fixture = parseFixture(raw['fixture'], id);
  const check = parseCheck(raw['check'], id);

  const tags = raw['tags'];
  if (tags !== undefined && !isStringArray(tags)) {
    throw new Error(`task ${id}: tags must be an array of strings`);
  }
  const task: TaskSpec = { id, prompt, fixture, check };
  if (tags !== undefined) {
    task.tags = tags;
  }
  return task;
}

export async function loadSuite(suitePath: string): Promise<SuiteSpec> {
  let raw: string;
  try {
    raw = await readFile(suitePath, 'utf8');
  } catch (error) {
    throw new Error(`suite ${suitePath}: unreadable — ${message(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`suite ${suitePath}: invalid JSON — ${message(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`suite ${suitePath}: root must be an object`);
  }
  const name = parsed['name'];
  if (!nonEmptyString(name)) {
    throw new Error(`suite ${suitePath}: name must be a non-empty string`);
  }
  const tasksRaw = parsed['tasks'];
  if (!Array.isArray(tasksRaw) || tasksRaw.length === 0) {
    throw new Error(`suite ${suitePath}: tasks must be a non-empty array`);
  }
  const seenIds = new Set<string>();
  try {
    const tasks = tasksRaw.map((task, index) => parseTask(task, index, seenIds));
    return { name, tasks };
  } catch (error) {
    throw new Error(`suite ${suitePath}: ${message(error)}`);
  }
}

/** Fixture root shipped alongside a suite file: <suiteDir>/../fixtures. */
export function suiteFixturesDir(suitePath: string): string {
  return path.resolve(path.dirname(suitePath), '..', 'fixtures');
}
