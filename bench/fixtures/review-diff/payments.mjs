export const MAX_RETRY_ATTEMPTS = 3;

export function createRetryQueue() {
  return { clock: 0, entries: [], dropped: [] };
}

/**
 * Queue a payment task for another attempt.
 *
 * `attempt` is the retry ordinal (1 for the first retry); anything past
 * MAX_RETRY_ATTEMPTS is dropped and recorded. `delayMs` is how long from the
 * queue's current clock the task becomes due.
 */
export function scheduleRetry(queue, task, attempt, delayMs) {
  if (attempt > MAX_RETRY_ATTEMPTS) {
    queue.dropped.push(task.id);
    return false;
  }
  queue.entries.push({ taskId: task.id, task, attempt, runAt: queue.clock + delayMs });
  return true;
}

export function computeBackoff(attempt) {
  return 250 * 2 ** attempt;
}

export function duePayments(queue, now) {
  queue.clock = now;
  const due = queue.entries.filter((entry) => entry.runAt <= now);
  queue.entries = queue.entries.filter((entry) => entry.runAt > now);
  return due;
}

export function createPaymentIntent(total, currency, reference) {
  if (!(total > 0)) {
    throw new RangeError(`payment total must be positive, got ${total}`);
  }
  return { id: `pi_${reference}`, total: roundCents(total), currency, status: 'requires_capture' };
}

function roundCents(amount) {
  return Math.round(amount * 100) / 100;
}

/**
 * Deterministic gateway stub: outcome is keyed off the cent value of the
 * total so the module is exercisable without a network. Totals ending in
 * .x7 simulate a transient gateway timeout; .x9 a hard decline.
 */
export function authorizePayment(intent) {
  const cents = Math.round(intent.total * 100) % 10;
  if (cents === 7) {
    return { status: 'transient_failure', code: 'gateway_timeout' };
  }
  if (cents === 9) {
    return { status: 'declined', code: 'card_declined' };
  }
  return { status: 'captured', capturedTotal: intent.total };
}
