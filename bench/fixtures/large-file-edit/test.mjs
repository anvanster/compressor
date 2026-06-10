import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commands, defaultsFor, getCommand, groups, runCommand } from './commands.mjs';

test('command names are unique', () => {
  const names = commands.map((cmd) => cmd.name);
  assert.equal(new Set(names).size, names.length);
});

test('every command declares a group, summary, two options, and a handler', () => {
  for (const cmd of commands) {
    assert.ok(groups().includes(cmd.group));
    assert.ok(cmd.summary.length > 0, `${cmd.name} needs a summary`);
    assert.equal(cmd.options.length, 2, `${cmd.name} must declare two options`);
    assert.equal(typeof cmd.handler, 'function');
  }
});

test('aliases resolve to their command', () => {
  assert.equal(getCommand('cache:gc'), getCommand('cache:prune'));
  assert.equal(getCommand('db:ls'), getCommand('db:list'));
  assert.equal(getCommand('nope:nothing'), null);
});

test('runCommand merges declared defaults', () => {
  const logged = [];
  const ctx = { log: (...args) => logged.push(args) };
  const result = runCommand('queue:list', ctx, { limit: 5 });
  assert.deepEqual(result, { ok: true, command: 'queue:list' });
  assert.deepEqual(logged[0][1], { format: 'table', limit: 5 });
  assert.throws(() => runCommand('queue:list', ctx, { limit: 'many' }), TypeError);
});

test('snapshot:prune retains 30 days of snapshots by default', () => {
  const cmd = getCommand('snapshot:prune');
  assert.ok(cmd, 'snapshot:prune must exist');
  const keep = cmd.options.find((option) => option.name === 'keep');
  assert.ok(keep, 'snapshot:prune must declare a --keep option');
  assert.equal(keep.default, 30);
  assert.equal(defaultsFor(cmd).keep, 30);
});
