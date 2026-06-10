const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EUROPEAN_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAY_MS = 86_400_000;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return DAYS_IN_MONTH[month - 1];
}

function assertValid(year, month, day, input) {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`impossible calendar date: ${input}`);
  }
}

export function parseDate(input) {
  if (typeof input !== 'string') {
    throw new TypeError('date must be a string');
  }
  let year;
  let month;
  let day;
  const iso = ISO_RE.exec(input);
  if (iso !== null) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const eu = EUROPEAN_RE.exec(input);
    if (eu === null) {
      throw new TypeError(`unsupported date format: ${input}`);
    }
    month = Number(eu[1]);
    day = Number(eu[2]);
    year = Number(eu[3]);
  }
  assertValid(year, month, day, input);
  return { year, month, day };
}

export function formatISO({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toUTC({ year, month, day }) {
  return Date.UTC(year, month - 1, day);
}

export function addDays(parts, n) {
  const date = new Date(toUTC(parts) + n * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

export function weekday(parts) {
  return new Date(toUTC(parts)).getUTCDay();
}

export function isWeekend(parts) {
  const dow = weekday(parts);
  return dow === 0 || dow === 6;
}
