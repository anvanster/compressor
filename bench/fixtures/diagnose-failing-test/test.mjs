import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, formatISO, isWeekend, parseDate } from './dates.mjs';
import { dueDate, nextBusinessDay } from './schedule.mjs';
import { monthKey, quarterFor } from './report.mjs';

const pad = (n) => String(n).padStart(2, '0');

describe('parseDate accepts ISO dates', () => {
  for (let month = 1; month <= 12; month += 1) {
    for (const day of [1, 9, 17, 28]) {
      const input = `2024-${pad(month)}-${pad(day)}`;
      test(`parses ${input}`, () => {
        assert.deepEqual(parseDate(input), { year: 2024, month, day });
      });
    }
  }
});

describe('formatISO round-trips parsed ISO dates', () => {
  const inputs = [];
  for (let month = 1; month <= 12; month += 1) {
    inputs.push(`2023-${pad(month)}-15`, `2025-${pad(month)}-01`);
  }
  for (const input of inputs) {
    test(`round-trips ${input}`, () => {
      assert.equal(formatISO(parseDate(input)), input);
    });
  }
});

describe('addDays and daysBetween agree', () => {
  const origin = parseDate('2024-02-25');
  for (let offset = 0; offset < 30; offset += 1) {
    test(`offset ${offset} days`, () => {
      assert.equal(daysBetween(origin, addDays(origin, offset)), offset);
    });
  }
});

describe('isWeekend over January 2024', () => {
  const weekends = new Set([6, 7, 13, 14, 20, 21, 27, 28]);
  for (let day = 1; day <= 28; day += 1) {
    test(`2024-01-${pad(day)}`, () => {
      assert.equal(isWeekend(parseDate(`2024-01-${pad(day)}`)), weekends.has(day));
    });
  }
});

describe('monthly report buckets', () => {
  for (let month = 1; month <= 12; month += 1) {
    test(`ISO dates bucket into 2024-${pad(month)}`, () => {
      assert.equal(monthKey(`2024-${pad(month)}-09`), `2024-${pad(month)}`);
    });
  }
});

describe('impossible dates are rejected', () => {
  const bad = ['2024-13-01', '2024-00-10', '2024-02-30', '2023-02-29', 'not a date', '2024/01/02'];
  for (const input of bad) {
    test(`rejects ${input}`, () => {
      assert.throws(() => parseDate(input));
    });
  }
});

describe('scheduling around weekends', () => {
  test('a weekday advances a single day', () => {
    assert.equal(nextBusinessDay('2024-01-09'), '2024-01-10');
  });
  test('Friday skips to Monday', () => {
    assert.equal(nextBusinessDay('2024-01-05'), '2024-01-08');
  });
  test('due dates skip weekends', () => {
    assert.equal(dueDate('2024-01-04', 3), '2024-01-09');
  });
  test('European booking confirmations advance correctly', () => {
    assert.equal(nextBusinessDay('04/03/2024'), '2024-03-05');
  });
});

describe('quarterly revenue buckets', () => {
  test('ISO invoice dates land in the right quarter', () => {
    assert.equal(quarterFor('2024-11-02'), '2024-Q4');
  });
  test('European invoice dates land in the right quarter', () => {
    assert.equal(quarterFor('01/11/2024'), '2024-Q4');
  });
});
