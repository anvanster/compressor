import { addDays, formatISO, isWeekend, parseDate } from './dates.mjs';

export function nextBusinessDay(input) {
  let parts = addDays(parseDate(input), 1);
  while (isWeekend(parts)) {
    parts = addDays(parts, 1);
  }
  return formatISO(parts);
}

export function dueDate(input, businessDays) {
  if (!Number.isInteger(businessDays) || businessDays < 0) {
    throw new TypeError('businessDays must be a non-negative integer');
  }
  let parts = parseDate(input);
  let remaining = businessDays;
  while (remaining > 0) {
    parts = addDays(parts, 1);
    if (!isWeekend(parts)) {
      remaining -= 1;
    }
  }
  return formatISO(parts);
}
