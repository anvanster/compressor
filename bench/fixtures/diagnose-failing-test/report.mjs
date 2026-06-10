import { parseDate } from './dates.mjs';

export function quarterFor(input) {
  const { year, month } = parseDate(input);
  return `${year}-Q${Math.ceil(month / 3)}`;
}

export function monthKey(input) {
  const { year, month } = parseDate(input);
  return `${year}-${String(month).padStart(2, '0')}`;
}
