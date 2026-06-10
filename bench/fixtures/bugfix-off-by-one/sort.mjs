// Multi-key ordering helpers used by the paginated list endpoints.
// Each collation names a sortable field, its type, and tie-breaking rules.

export function compareValues(a, b, type) {
  if (type === 'number' || type === 'currency') {
    return (Number(a) || 0) - (Number(b) || 0);
  }
  if (type === 'date') {
    return Date.parse(a) - Date.parse(b);
  }
  return String(a).localeCompare(String(b));
}

/** Builds a comparator from [field, direction] pairs; later keys break ties. */
export function comparatorFor(keys, collations) {
  const resolved = keys.map(([field, direction]) => {
    const collation = collations.find((c) => c.field === field);
    if (collation === undefined) {
      throw new TypeError(`unknown sort field: ${field}`);
    }
    if (direction !== 'asc' && direction !== 'desc') {
      throw new TypeError(`direction must be asc|desc, got ${direction}`);
    }
    return { collation, sign: direction === 'asc' ? 1 : -1 };
  });
  return (left, right) => {
    for (const { collation, sign } of resolved) {
      const cmp = compareValues(left[collation.field], right[collation.field], collation.type);
      if (cmp !== 0) {
        return cmp * sign;
      }
    }
    return 0;
  };
}

/** Stable sort that never mutates its input page. */
export function sortPage(items, keys, collations) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  return [...items].sort(comparatorFor(keys, collations));
}

export const COLLATIONS = [
  { field: 'order.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders order rows by id with number comparison semantics' },
  { field: 'order.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders order rows by createdAt with date comparison semantics' },
  { field: 'order.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders order rows by updatedAt with date comparison semantics' },
  { field: 'order.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders order rows by status with string comparison semantics' },
  { field: 'order.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders order rows by total with currency comparison semantics' },
  { field: 'invoice.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders invoice rows by id with number comparison semantics' },
  { field: 'invoice.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders invoice rows by createdAt with date comparison semantics' },
  { field: 'invoice.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders invoice rows by updatedAt with date comparison semantics' },
  { field: 'invoice.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders invoice rows by status with string comparison semantics' },
  { field: 'invoice.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders invoice rows by total with currency comparison semantics' },
  { field: 'customer.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders customer rows by id with number comparison semantics' },
  { field: 'customer.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders customer rows by createdAt with date comparison semantics' },
  { field: 'customer.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders customer rows by updatedAt with date comparison semantics' },
  { field: 'customer.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders customer rows by status with string comparison semantics' },
  { field: 'customer.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders customer rows by total with currency comparison semantics' },
  { field: 'shipment.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders shipment rows by id with number comparison semantics' },
  { field: 'shipment.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders shipment rows by createdAt with date comparison semantics' },
  { field: 'shipment.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders shipment rows by updatedAt with date comparison semantics' },
  { field: 'shipment.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders shipment rows by status with string comparison semantics' },
  { field: 'shipment.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders shipment rows by total with currency comparison semantics' },
  { field: 'refund.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders refund rows by id with number comparison semantics' },
  { field: 'refund.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders refund rows by createdAt with date comparison semantics' },
  { field: 'refund.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders refund rows by updatedAt with date comparison semantics' },
  { field: 'refund.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders refund rows by status with string comparison semantics' },
  { field: 'refund.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders refund rows by total with currency comparison semantics' },
  { field: 'payment.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders payment rows by id with number comparison semantics' },
  { field: 'payment.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders payment rows by createdAt with date comparison semantics' },
  { field: 'payment.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders payment rows by updatedAt with date comparison semantics' },
  { field: 'payment.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders payment rows by status with string comparison semantics' },
  { field: 'payment.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders payment rows by total with currency comparison semantics' },
  { field: 'product.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders product rows by id with number comparison semantics' },
  { field: 'product.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders product rows by createdAt with date comparison semantics' },
  { field: 'product.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders product rows by updatedAt with date comparison semantics' },
  { field: 'product.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders product rows by status with string comparison semantics' },
  { field: 'product.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders product rows by total with currency comparison semantics' },
  { field: 'category.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders category rows by id with number comparison semantics' },
  { field: 'category.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders category rows by createdAt with date comparison semantics' },
  { field: 'category.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders category rows by updatedAt with date comparison semantics' },
  { field: 'category.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders category rows by status with string comparison semantics' },
  { field: 'category.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders category rows by total with currency comparison semantics' },
  { field: 'warehouse.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders warehouse rows by id with number comparison semantics' },
  { field: 'warehouse.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders warehouse rows by createdAt with date comparison semantics' },
  { field: 'warehouse.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders warehouse rows by updatedAt with date comparison semantics' },
  { field: 'warehouse.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders warehouse rows by status with string comparison semantics' },
  { field: 'warehouse.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders warehouse rows by total with currency comparison semantics' },
  { field: 'supplier.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders supplier rows by id with number comparison semantics' },
  { field: 'supplier.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders supplier rows by createdAt with date comparison semantics' },
  { field: 'supplier.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders supplier rows by updatedAt with date comparison semantics' },
  { field: 'supplier.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders supplier rows by status with string comparison semantics' },
  { field: 'supplier.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders supplier rows by total with currency comparison semantics' },
  { field: 'ticket.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders ticket rows by id with number comparison semantics' },
  { field: 'ticket.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders ticket rows by createdAt with date comparison semantics' },
  { field: 'ticket.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders ticket rows by updatedAt with date comparison semantics' },
  { field: 'ticket.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders ticket rows by status with string comparison semantics' },
  { field: 'ticket.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders ticket rows by total with currency comparison semantics' },
  { field: 'agent.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders agent rows by id with number comparison semantics' },
  { field: 'agent.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders agent rows by createdAt with date comparison semantics' },
  { field: 'agent.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders agent rows by updatedAt with date comparison semantics' },
  { field: 'agent.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders agent rows by status with string comparison semantics' },
  { field: 'agent.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders agent rows by total with currency comparison semantics' },
  { field: 'session.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders session rows by id with number comparison semantics' },
  { field: 'session.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders session rows by createdAt with date comparison semantics' },
  { field: 'session.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders session rows by updatedAt with date comparison semantics' },
  { field: 'session.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders session rows by status with string comparison semantics' },
  { field: 'session.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders session rows by total with currency comparison semantics' },
  { field: 'event.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders event rows by id with number comparison semantics' },
  { field: 'event.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders event rows by createdAt with date comparison semantics' },
  { field: 'event.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders event rows by updatedAt with date comparison semantics' },
  { field: 'event.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders event rows by status with string comparison semantics' },
  { field: 'event.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders event rows by total with currency comparison semantics' },
  { field: 'webhook.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders webhook rows by id with number comparison semantics' },
  { field: 'webhook.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders webhook rows by createdAt with date comparison semantics' },
  { field: 'webhook.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders webhook rows by updatedAt with date comparison semantics' },
  { field: 'webhook.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders webhook rows by status with string comparison semantics' },
  { field: 'webhook.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders webhook rows by total with currency comparison semantics' },
  { field: 'subscription.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders subscription rows by id with number comparison semantics' },
  { field: 'subscription.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders subscription rows by createdAt with date comparison semantics' },
  { field: 'subscription.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders subscription rows by updatedAt with date comparison semantics' },
  { field: 'subscription.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders subscription rows by status with string comparison semantics' },
  { field: 'subscription.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders subscription rows by total with currency comparison semantics' },
  { field: 'plan.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders plan rows by id with number comparison semantics' },
  { field: 'plan.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders plan rows by createdAt with date comparison semantics' },
  { field: 'plan.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders plan rows by updatedAt with date comparison semantics' },
  { field: 'plan.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders plan rows by status with string comparison semantics' },
  { field: 'plan.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders plan rows by total with currency comparison semantics' },
  { field: 'coupon.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders coupon rows by id with number comparison semantics' },
  { field: 'coupon.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders coupon rows by createdAt with date comparison semantics' },
  { field: 'coupon.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders coupon rows by updatedAt with date comparison semantics' },
  { field: 'coupon.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders coupon rows by status with string comparison semantics' },
  { field: 'coupon.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders coupon rows by total with currency comparison semantics' },
  { field: 'audit.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders audit rows by id with number comparison semantics' },
  { field: 'audit.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders audit rows by createdAt with date comparison semantics' },
  { field: 'audit.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders audit rows by updatedAt with date comparison semantics' },
  { field: 'audit.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders audit rows by status with string comparison semantics' },
  { field: 'audit.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders audit rows by total with currency comparison semantics' },
  { field: 'report.id', type: 'number', nulls: 'first', caseSensitive: true, description: 'Orders report rows by id with number comparison semantics' },
  { field: 'report.createdAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders report rows by createdAt with date comparison semantics' },
  { field: 'report.updatedAt', type: 'date', nulls: 'last', caseSensitive: true, description: 'Orders report rows by updatedAt with date comparison semantics' },
  { field: 'report.status', type: 'string', nulls: 'last', caseSensitive: false, description: 'Orders report rows by status with string comparison semantics' },
  { field: 'report.total', type: 'currency', nulls: 'last', caseSensitive: true, description: 'Orders report rows by total with currency comparison semantics' },
];
