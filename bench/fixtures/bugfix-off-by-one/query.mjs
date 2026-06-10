// Pagination query-string handling for the list endpoints. Each parameter
// definition documents its coercion, bounds, and default so API docs can be
// generated straight from this table.

export function coerceParam(def, raw) {
  if (raw === undefined || raw === '') {
    return def.default;
  }
  if (def.kind === 'number') {
    const value = Number(raw);
    if (!Number.isInteger(value)) {
      throw new TypeError(`${def.name} must be an integer`);
    }
    if (value < def.min || value > def.max) {
      throw new RangeError(`${def.name} must be between ${def.min} and ${def.max}`);
    }
    return value;
  }
  if (def.kind === 'enum') {
    if (!def.choices.includes(raw)) {
      throw new TypeError(`${def.name} must be one of ${def.choices.join('|')}`);
    }
    return raw;
  }
  return String(raw);
}

/** Parses a URLSearchParams-like object against PARAM_DEFINITIONS. */
export function parseListQuery(params, definitions = PARAM_DEFINITIONS) {
  const out = {};
  for (const def of definitions) {
    const raw = typeof params.get === 'function' ? params.get(def.name) : params[def.name];
    out[def.name] = coerceParam(def, raw ?? undefined);
  }
  return out;
}

/** Serializes parsed params back to a canonical query string (sorted keys). */
export function serializeListQuery(parsed, definitions = PARAM_DEFINITIONS) {
  const parts = [];
  for (const def of [...definitions].sort((a, b) => a.name.localeCompare(b.name))) {
    const value = parsed[def.name];
    if (value === undefined || value === def.default) {
      continue;
    }
    parts.push(`${encodeURIComponent(def.name)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
}

export const PARAM_DEFINITIONS = [
  { name: 'page', kind: 'number', default: 1, min: 1, max: 100000, summary: 'One-based page index into the filtered result set' },
  { name: 'perPage', kind: 'number', default: 25, min: 1, max: 500, summary: 'Number of rows returned per page' },
  { name: 'sort', kind: 'string', default: 'id', summary: 'Comma-separated sort keys, prefix with - for descending' },
  { name: 'direction', kind: 'enum', default: 'asc', choices: ['asc', 'desc'], summary: 'Default direction applied to unprefixed sort keys' },
  { name: 'orderStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to order rows in the given lifecycle state' },
  { name: 'orderMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the order total column before paging' },
  { name: 'invoiceStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to invoice rows in the given lifecycle state' },
  { name: 'invoiceMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the invoice total column before paging' },
  { name: 'customerStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to customer rows in the given lifecycle state' },
  { name: 'customerMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the customer total column before paging' },
  { name: 'shipmentStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to shipment rows in the given lifecycle state' },
  { name: 'shipmentMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the shipment total column before paging' },
  { name: 'refundStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to refund rows in the given lifecycle state' },
  { name: 'refundMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the refund total column before paging' },
  { name: 'paymentStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to payment rows in the given lifecycle state' },
  { name: 'paymentMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the payment total column before paging' },
  { name: 'productStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to product rows in the given lifecycle state' },
  { name: 'productMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the product total column before paging' },
  { name: 'categoryStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to category rows in the given lifecycle state' },
  { name: 'categoryMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the category total column before paging' },
  { name: 'warehouseStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to warehouse rows in the given lifecycle state' },
  { name: 'warehouseMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the warehouse total column before paging' },
  { name: 'supplierStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to supplier rows in the given lifecycle state' },
  { name: 'supplierMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the supplier total column before paging' },
  { name: 'ticketStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to ticket rows in the given lifecycle state' },
  { name: 'ticketMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the ticket total column before paging' },
  { name: 'agentStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to agent rows in the given lifecycle state' },
  { name: 'agentMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the agent total column before paging' },
  { name: 'sessionStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to session rows in the given lifecycle state' },
  { name: 'sessionMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the session total column before paging' },
  { name: 'eventStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to event rows in the given lifecycle state' },
  { name: 'eventMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the event total column before paging' },
  { name: 'webhookStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to webhook rows in the given lifecycle state' },
  { name: 'webhookMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the webhook total column before paging' },
  { name: 'subscriptionStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to subscription rows in the given lifecycle state' },
  { name: 'subscriptionMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the subscription total column before paging' },
  { name: 'planStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to plan rows in the given lifecycle state' },
  { name: 'planMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the plan total column before paging' },
  { name: 'couponStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to coupon rows in the given lifecycle state' },
  { name: 'couponMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the coupon total column before paging' },
  { name: 'auditStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to audit rows in the given lifecycle state' },
  { name: 'auditMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the audit total column before paging' },
  { name: 'reportStatus', kind: 'enum', default: 'any', choices: ['any', 'open', 'closed', 'archived'], summary: 'Restricts the page to report rows in the given lifecycle state' },
  { name: 'reportMinTotal', kind: 'number', default: 0, min: 0, max: 1000000, summary: 'Lower bound (inclusive) applied to the report total column before paging' },
];
