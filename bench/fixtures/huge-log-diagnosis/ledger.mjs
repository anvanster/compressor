// Cash ledger: integer-cents entries with formatted statements.

import { formatCents, sumCents } from './util.mjs';

export function openLedger(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('ledger name must be a non-empty string');
  }
  return { name, entries: [] };
}

export function record(ledger, label, cents) {
  if (typeof label !== 'string' || label.length === 0) {
    throw new TypeError('entry label must be a non-empty string');
  }
  if (!Number.isInteger(cents)) {
    throw new TypeError(`entry cents must be an integer, got ${cents}`);
  }
  ledger.entries.push({ label, cents });
  return ledger;
}

export function entryCount(ledger) {
  return ledger.entries.length;
}

export function balance(ledger) {
  return sumCents(ledger.entries.map((entry) => entry.cents));
}

export function statement(ledger) {
  const lines = [`ledger ${ledger.name}`];
  for (const entry of ledger.entries) {
    lines.push(`  ${entry.label} ${formatCents(entry.cents)}`);
  }
  lines.push(`  total ${formatCents(balance(ledger))}`);
  return lines;
}
