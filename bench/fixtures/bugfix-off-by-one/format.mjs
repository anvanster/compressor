// Presentation layer for paginated listings: column presets describe how a
// field renders in table output (width, alignment, formatter, header label).
// The renderer below consumes a preset list plus one page of rows.

const FORMATTERS = {
  text: (value) => String(value ?? ''),
  number: (value) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : ''),
  currency: (value) => (Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : ''),
  date: (value) => (Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : ''),
  boolean: (value) => (value ? 'yes' : 'no'),
};

export function formatCell(preset, value) {
  const formatter = FORMATTERS[preset.format];
  if (formatter === undefined) {
    throw new TypeError(`unknown formatter: ${preset.format}`);
  }
  const text = formatter(value);
  if (text.length > preset.width) {
    return `${text.slice(0, preset.width - 1)}…`;
  }
  return preset.align === 'right' ? text.padStart(preset.width) : text.padEnd(preset.width);
}

/** Renders one page of rows as a plain-text table using the given presets. */
export function renderPage(rows, presets) {
  if (!Array.isArray(rows)) {
    throw new TypeError('rows must be an array');
  }
  const header = presets
    .map((preset) => (preset.align === 'right' ? preset.label.padStart(preset.width) : preset.label.padEnd(preset.width)))
    .join('  ');
  const lines = rows.map((row) =>
    presets.map((preset) => formatCell(preset, row[preset.field])).join('  '),
  );
  return [header, ...lines].join('\n');
}

/** Footer line: "rows 11-20 of 137 (page 2/14)". */
export function pageFooter(page, perPage, totalItems) {
  if (!Number.isInteger(page) || page <= 0) {
    throw new TypeError('page must be a positive integer');
  }
  if (!Number.isInteger(perPage) || perPage <= 0) {
    throw new TypeError('perPage must be a positive integer');
  }
  if (!Number.isInteger(totalItems) || totalItems < 0) {
    throw new TypeError('totalItems must be a non-negative integer');
  }
  const first = (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, totalItems);
  const pages = Math.max(1, Math.ceil(totalItems / perPage));
  return `rows ${first}-${last} of ${totalItems} (page ${page}/${pages})`;
}

export function presetsFor(entity, presets = COLUMN_PRESETS) {
  const matched = presets.filter((preset) => preset.field.startsWith(`${entity}.`));
  if (matched.length === 0) {
    throw new TypeError(`no column presets for entity: ${entity}`);
  }
  return matched;
}

export const COLUMN_PRESETS = [
  { field: 'order.id', label: 'order id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for order listings using the number formatter at width 8' },
  { field: 'order.name', label: 'order name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for order listings using the text formatter at width 24' },
  { field: 'order.status', label: 'order status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for order listings using the text formatter at width 10' },
  { field: 'order.total', label: 'order total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for order listings using the currency formatter at width 12' },
  { field: 'order.quantity', label: 'order quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for order listings using the number formatter at width 9' },
  { field: 'order.createdAt', label: 'order created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for order listings using the date formatter at width 10' },
  { field: 'order.updatedAt', label: 'order updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for order listings using the date formatter at width 10' },
  { field: 'order.region', label: 'order region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for order listings using the text formatter at width 12' },
  { field: 'order.priority', label: 'order priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for order listings using the number formatter at width 8' },
  { field: 'order.archived', label: 'order archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for order listings using the boolean formatter at width 8' },
  { field: 'invoice.id', label: 'invoice id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for invoice listings using the number formatter at width 8' },
  { field: 'invoice.name', label: 'invoice name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for invoice listings using the text formatter at width 24' },
  { field: 'invoice.status', label: 'invoice status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for invoice listings using the text formatter at width 10' },
  { field: 'invoice.total', label: 'invoice total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for invoice listings using the currency formatter at width 12' },
  { field: 'invoice.quantity', label: 'invoice quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for invoice listings using the number formatter at width 9' },
  { field: 'invoice.createdAt', label: 'invoice created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for invoice listings using the date formatter at width 10' },
  { field: 'invoice.updatedAt', label: 'invoice updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for invoice listings using the date formatter at width 10' },
  { field: 'invoice.region', label: 'invoice region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for invoice listings using the text formatter at width 12' },
  { field: 'invoice.priority', label: 'invoice priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for invoice listings using the number formatter at width 8' },
  { field: 'invoice.archived', label: 'invoice archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for invoice listings using the boolean formatter at width 8' },
  { field: 'customer.id', label: 'customer id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for customer listings using the number formatter at width 8' },
  { field: 'customer.name', label: 'customer name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for customer listings using the text formatter at width 24' },
  { field: 'customer.status', label: 'customer status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for customer listings using the text formatter at width 10' },
  { field: 'customer.total', label: 'customer total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for customer listings using the currency formatter at width 12' },
  { field: 'customer.quantity', label: 'customer quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for customer listings using the number formatter at width 9' },
  { field: 'customer.createdAt', label: 'customer created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for customer listings using the date formatter at width 10' },
  { field: 'customer.updatedAt', label: 'customer updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for customer listings using the date formatter at width 10' },
  { field: 'customer.region', label: 'customer region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for customer listings using the text formatter at width 12' },
  { field: 'customer.priority', label: 'customer priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for customer listings using the number formatter at width 8' },
  { field: 'customer.archived', label: 'customer archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for customer listings using the boolean formatter at width 8' },
  { field: 'shipment.id', label: 'shipment id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for shipment listings using the number formatter at width 8' },
  { field: 'shipment.name', label: 'shipment name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for shipment listings using the text formatter at width 24' },
  { field: 'shipment.status', label: 'shipment status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for shipment listings using the text formatter at width 10' },
  { field: 'shipment.total', label: 'shipment total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for shipment listings using the currency formatter at width 12' },
  { field: 'shipment.quantity', label: 'shipment quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for shipment listings using the number formatter at width 9' },
  { field: 'shipment.createdAt', label: 'shipment created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for shipment listings using the date formatter at width 10' },
  { field: 'shipment.updatedAt', label: 'shipment updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for shipment listings using the date formatter at width 10' },
  { field: 'shipment.region', label: 'shipment region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for shipment listings using the text formatter at width 12' },
  { field: 'shipment.priority', label: 'shipment priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for shipment listings using the number formatter at width 8' },
  { field: 'shipment.archived', label: 'shipment archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for shipment listings using the boolean formatter at width 8' },
  { field: 'refund.id', label: 'refund id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for refund listings using the number formatter at width 8' },
  { field: 'refund.name', label: 'refund name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for refund listings using the text formatter at width 24' },
  { field: 'refund.status', label: 'refund status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for refund listings using the text formatter at width 10' },
  { field: 'refund.total', label: 'refund total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for refund listings using the currency formatter at width 12' },
  { field: 'refund.quantity', label: 'refund quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for refund listings using the number formatter at width 9' },
  { field: 'refund.createdAt', label: 'refund created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for refund listings using the date formatter at width 10' },
  { field: 'refund.updatedAt', label: 'refund updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for refund listings using the date formatter at width 10' },
  { field: 'refund.region', label: 'refund region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for refund listings using the text formatter at width 12' },
  { field: 'refund.priority', label: 'refund priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for refund listings using the number formatter at width 8' },
  { field: 'refund.archived', label: 'refund archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for refund listings using the boolean formatter at width 8' },
  { field: 'payment.id', label: 'payment id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for payment listings using the number formatter at width 8' },
  { field: 'payment.name', label: 'payment name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for payment listings using the text formatter at width 24' },
  { field: 'payment.status', label: 'payment status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for payment listings using the text formatter at width 10' },
  { field: 'payment.total', label: 'payment total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for payment listings using the currency formatter at width 12' },
  { field: 'payment.quantity', label: 'payment quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for payment listings using the number formatter at width 9' },
  { field: 'payment.createdAt', label: 'payment created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for payment listings using the date formatter at width 10' },
  { field: 'payment.updatedAt', label: 'payment updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for payment listings using the date formatter at width 10' },
  { field: 'payment.region', label: 'payment region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for payment listings using the text formatter at width 12' },
  { field: 'payment.priority', label: 'payment priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for payment listings using the number formatter at width 8' },
  { field: 'payment.archived', label: 'payment archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for payment listings using the boolean formatter at width 8' },
  { field: 'product.id', label: 'product id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for product listings using the number formatter at width 8' },
  { field: 'product.name', label: 'product name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for product listings using the text formatter at width 24' },
  { field: 'product.status', label: 'product status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for product listings using the text formatter at width 10' },
  { field: 'product.total', label: 'product total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for product listings using the currency formatter at width 12' },
  { field: 'product.quantity', label: 'product quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for product listings using the number formatter at width 9' },
  { field: 'product.createdAt', label: 'product created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for product listings using the date formatter at width 10' },
  { field: 'product.updatedAt', label: 'product updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for product listings using the date formatter at width 10' },
  { field: 'product.region', label: 'product region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for product listings using the text formatter at width 12' },
  { field: 'product.priority', label: 'product priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for product listings using the number formatter at width 8' },
  { field: 'product.archived', label: 'product archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for product listings using the boolean formatter at width 8' },
  { field: 'category.id', label: 'category id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for category listings using the number formatter at width 8' },
  { field: 'category.name', label: 'category name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for category listings using the text formatter at width 24' },
  { field: 'category.status', label: 'category status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for category listings using the text formatter at width 10' },
  { field: 'category.total', label: 'category total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for category listings using the currency formatter at width 12' },
  { field: 'category.quantity', label: 'category quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for category listings using the number formatter at width 9' },
  { field: 'category.createdAt', label: 'category created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for category listings using the date formatter at width 10' },
  { field: 'category.updatedAt', label: 'category updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for category listings using the date formatter at width 10' },
  { field: 'category.region', label: 'category region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for category listings using the text formatter at width 12' },
  { field: 'category.priority', label: 'category priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for category listings using the number formatter at width 8' },
  { field: 'category.archived', label: 'category archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for category listings using the boolean formatter at width 8' },
  { field: 'warehouse.id', label: 'warehouse id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for warehouse listings using the number formatter at width 8' },
  { field: 'warehouse.name', label: 'warehouse name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for warehouse listings using the text formatter at width 24' },
  { field: 'warehouse.status', label: 'warehouse status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for warehouse listings using the text formatter at width 10' },
  { field: 'warehouse.total', label: 'warehouse total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for warehouse listings using the currency formatter at width 12' },
  { field: 'warehouse.quantity', label: 'warehouse quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for warehouse listings using the number formatter at width 9' },
  { field: 'warehouse.createdAt', label: 'warehouse created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for warehouse listings using the date formatter at width 10' },
  { field: 'warehouse.updatedAt', label: 'warehouse updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for warehouse listings using the date formatter at width 10' },
  { field: 'warehouse.region', label: 'warehouse region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for warehouse listings using the text formatter at width 12' },
  { field: 'warehouse.priority', label: 'warehouse priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for warehouse listings using the number formatter at width 8' },
  { field: 'warehouse.archived', label: 'warehouse archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for warehouse listings using the boolean formatter at width 8' },
  { field: 'supplier.id', label: 'supplier id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for supplier listings using the number formatter at width 8' },
  { field: 'supplier.name', label: 'supplier name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for supplier listings using the text formatter at width 24' },
  { field: 'supplier.status', label: 'supplier status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for supplier listings using the text formatter at width 10' },
  { field: 'supplier.total', label: 'supplier total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for supplier listings using the currency formatter at width 12' },
  { field: 'supplier.quantity', label: 'supplier quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for supplier listings using the number formatter at width 9' },
  { field: 'supplier.createdAt', label: 'supplier created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for supplier listings using the date formatter at width 10' },
  { field: 'supplier.updatedAt', label: 'supplier updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for supplier listings using the date formatter at width 10' },
  { field: 'supplier.region', label: 'supplier region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for supplier listings using the text formatter at width 12' },
  { field: 'supplier.priority', label: 'supplier priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for supplier listings using the number formatter at width 8' },
  { field: 'supplier.archived', label: 'supplier archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for supplier listings using the boolean formatter at width 8' },
  { field: 'ticket.id', label: 'ticket id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for ticket listings using the number formatter at width 8' },
  { field: 'ticket.name', label: 'ticket name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for ticket listings using the text formatter at width 24' },
  { field: 'ticket.status', label: 'ticket status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for ticket listings using the text formatter at width 10' },
  { field: 'ticket.total', label: 'ticket total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for ticket listings using the currency formatter at width 12' },
  { field: 'ticket.quantity', label: 'ticket quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for ticket listings using the number formatter at width 9' },
  { field: 'ticket.createdAt', label: 'ticket created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for ticket listings using the date formatter at width 10' },
  { field: 'ticket.updatedAt', label: 'ticket updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for ticket listings using the date formatter at width 10' },
  { field: 'ticket.region', label: 'ticket region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for ticket listings using the text formatter at width 12' },
  { field: 'ticket.priority', label: 'ticket priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for ticket listings using the number formatter at width 8' },
  { field: 'ticket.archived', label: 'ticket archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for ticket listings using the boolean formatter at width 8' },
  { field: 'agent.id', label: 'agent id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for agent listings using the number formatter at width 8' },
  { field: 'agent.name', label: 'agent name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for agent listings using the text formatter at width 24' },
  { field: 'agent.status', label: 'agent status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for agent listings using the text formatter at width 10' },
  { field: 'agent.total', label: 'agent total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for agent listings using the currency formatter at width 12' },
  { field: 'agent.quantity', label: 'agent quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for agent listings using the number formatter at width 9' },
  { field: 'agent.createdAt', label: 'agent created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for agent listings using the date formatter at width 10' },
  { field: 'agent.updatedAt', label: 'agent updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for agent listings using the date formatter at width 10' },
  { field: 'agent.region', label: 'agent region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for agent listings using the text formatter at width 12' },
  { field: 'agent.priority', label: 'agent priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for agent listings using the number formatter at width 8' },
  { field: 'agent.archived', label: 'agent archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for agent listings using the boolean formatter at width 8' },
  { field: 'session.id', label: 'session id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for session listings using the number formatter at width 8' },
  { field: 'session.name', label: 'session name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for session listings using the text formatter at width 24' },
  { field: 'session.status', label: 'session status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for session listings using the text formatter at width 10' },
  { field: 'session.total', label: 'session total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for session listings using the currency formatter at width 12' },
  { field: 'session.quantity', label: 'session quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for session listings using the number formatter at width 9' },
  { field: 'session.createdAt', label: 'session created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for session listings using the date formatter at width 10' },
  { field: 'session.updatedAt', label: 'session updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for session listings using the date formatter at width 10' },
  { field: 'session.region', label: 'session region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for session listings using the text formatter at width 12' },
  { field: 'session.priority', label: 'session priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for session listings using the number formatter at width 8' },
  { field: 'session.archived', label: 'session archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for session listings using the boolean formatter at width 8' },
  { field: 'event.id', label: 'event id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for event listings using the number formatter at width 8' },
  { field: 'event.name', label: 'event name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for event listings using the text formatter at width 24' },
  { field: 'event.status', label: 'event status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for event listings using the text formatter at width 10' },
  { field: 'event.total', label: 'event total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for event listings using the currency formatter at width 12' },
  { field: 'event.quantity', label: 'event quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for event listings using the number formatter at width 9' },
  { field: 'event.createdAt', label: 'event created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for event listings using the date formatter at width 10' },
  { field: 'event.updatedAt', label: 'event updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for event listings using the date formatter at width 10' },
  { field: 'event.region', label: 'event region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for event listings using the text formatter at width 12' },
  { field: 'event.priority', label: 'event priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for event listings using the number formatter at width 8' },
  { field: 'event.archived', label: 'event archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for event listings using the boolean formatter at width 8' },
  { field: 'webhook.id', label: 'webhook id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for webhook listings using the number formatter at width 8' },
  { field: 'webhook.name', label: 'webhook name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for webhook listings using the text formatter at width 24' },
  { field: 'webhook.status', label: 'webhook status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for webhook listings using the text formatter at width 10' },
  { field: 'webhook.total', label: 'webhook total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for webhook listings using the currency formatter at width 12' },
  { field: 'webhook.quantity', label: 'webhook quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for webhook listings using the number formatter at width 9' },
  { field: 'webhook.createdAt', label: 'webhook created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for webhook listings using the date formatter at width 10' },
  { field: 'webhook.updatedAt', label: 'webhook updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for webhook listings using the date formatter at width 10' },
  { field: 'webhook.region', label: 'webhook region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for webhook listings using the text formatter at width 12' },
  { field: 'webhook.priority', label: 'webhook priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for webhook listings using the number formatter at width 8' },
  { field: 'webhook.archived', label: 'webhook archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for webhook listings using the boolean formatter at width 8' },
  { field: 'subscription.id', label: 'subscription id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for subscription listings using the number formatter at width 8' },
  { field: 'subscription.name', label: 'subscription name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for subscription listings using the text formatter at width 24' },
  { field: 'subscription.status', label: 'subscription status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for subscription listings using the text formatter at width 10' },
  { field: 'subscription.total', label: 'subscription total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for subscription listings using the currency formatter at width 12' },
  { field: 'subscription.quantity', label: 'subscription quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for subscription listings using the number formatter at width 9' },
  { field: 'subscription.createdAt', label: 'subscription created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for subscription listings using the date formatter at width 10' },
  { field: 'subscription.updatedAt', label: 'subscription updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for subscription listings using the date formatter at width 10' },
  { field: 'subscription.region', label: 'subscription region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for subscription listings using the text formatter at width 12' },
  { field: 'subscription.priority', label: 'subscription priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for subscription listings using the number formatter at width 8' },
  { field: 'subscription.archived', label: 'subscription archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for subscription listings using the boolean formatter at width 8' },
  { field: 'plan.id', label: 'plan id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for plan listings using the number formatter at width 8' },
  { field: 'plan.name', label: 'plan name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for plan listings using the text formatter at width 24' },
  { field: 'plan.status', label: 'plan status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for plan listings using the text formatter at width 10' },
  { field: 'plan.total', label: 'plan total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for plan listings using the currency formatter at width 12' },
  { field: 'plan.quantity', label: 'plan quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for plan listings using the number formatter at width 9' },
  { field: 'plan.createdAt', label: 'plan created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for plan listings using the date formatter at width 10' },
  { field: 'plan.updatedAt', label: 'plan updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for plan listings using the date formatter at width 10' },
  { field: 'plan.region', label: 'plan region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for plan listings using the text formatter at width 12' },
  { field: 'plan.priority', label: 'plan priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for plan listings using the number formatter at width 8' },
  { field: 'plan.archived', label: 'plan archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for plan listings using the boolean formatter at width 8' },
  { field: 'coupon.id', label: 'coupon id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for coupon listings using the number formatter at width 8' },
  { field: 'coupon.name', label: 'coupon name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for coupon listings using the text formatter at width 24' },
  { field: 'coupon.status', label: 'coupon status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for coupon listings using the text formatter at width 10' },
  { field: 'coupon.total', label: 'coupon total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for coupon listings using the currency formatter at width 12' },
  { field: 'coupon.quantity', label: 'coupon quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for coupon listings using the number formatter at width 9' },
  { field: 'coupon.createdAt', label: 'coupon created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for coupon listings using the date formatter at width 10' },
  { field: 'coupon.updatedAt', label: 'coupon updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for coupon listings using the date formatter at width 10' },
  { field: 'coupon.region', label: 'coupon region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for coupon listings using the text formatter at width 12' },
  { field: 'coupon.priority', label: 'coupon priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for coupon listings using the number formatter at width 8' },
  { field: 'coupon.archived', label: 'coupon archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for coupon listings using the boolean formatter at width 8' },
  { field: 'audit.id', label: 'audit id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for audit listings using the number formatter at width 8' },
  { field: 'audit.name', label: 'audit name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for audit listings using the text formatter at width 24' },
  { field: 'audit.status', label: 'audit status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for audit listings using the text formatter at width 10' },
  { field: 'audit.total', label: 'audit total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for audit listings using the currency formatter at width 12' },
  { field: 'audit.quantity', label: 'audit quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for audit listings using the number formatter at width 9' },
  { field: 'audit.createdAt', label: 'audit created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for audit listings using the date formatter at width 10' },
  { field: 'audit.updatedAt', label: 'audit updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for audit listings using the date formatter at width 10' },
  { field: 'audit.region', label: 'audit region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for audit listings using the text formatter at width 12' },
  { field: 'audit.priority', label: 'audit priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for audit listings using the number formatter at width 8' },
  { field: 'audit.archived', label: 'audit archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for audit listings using the boolean formatter at width 8' },
  { field: 'report.id', label: 'report id', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the id column for report listings using the number formatter at width 8' },
  { field: 'report.name', label: 'report name', format: 'text', width: 24, align: 'left', sortable: true, summary: 'Renders the name column for report listings using the text formatter at width 24' },
  { field: 'report.status', label: 'report status', format: 'text', width: 10, align: 'left', sortable: true, summary: 'Renders the status column for report listings using the text formatter at width 10' },
  { field: 'report.total', label: 'report total', format: 'currency', width: 12, align: 'right', sortable: true, summary: 'Renders the total column for report listings using the currency formatter at width 12' },
  { field: 'report.quantity', label: 'report quantity', format: 'number', width: 9, align: 'right', sortable: true, summary: 'Renders the quantity column for report listings using the number formatter at width 9' },
  { field: 'report.createdAt', label: 'report created at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the createdAt column for report listings using the date formatter at width 10' },
  { field: 'report.updatedAt', label: 'report updated at', format: 'date', width: 10, align: 'left', sortable: true, summary: 'Renders the updatedAt column for report listings using the date formatter at width 10' },
  { field: 'report.region', label: 'report region', format: 'text', width: 12, align: 'left', sortable: true, summary: 'Renders the region column for report listings using the text formatter at width 12' },
  { field: 'report.priority', label: 'report priority', format: 'number', width: 8, align: 'right', sortable: true, summary: 'Renders the priority column for report listings using the number formatter at width 8' },
  { field: 'report.archived', label: 'report archived', format: 'boolean', width: 8, align: 'left', sortable: false, summary: 'Renders the archived column for report listings using the boolean formatter at width 8' },
];
