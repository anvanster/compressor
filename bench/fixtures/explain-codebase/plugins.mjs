export function auditPlugin(trail) {
  return {
    name: 'audit',
    order: 10,
    beforeDispatch(envelope) {
      trail.push(envelope.eventName);
    },
  };
}

export function redactPlugin(fields) {
  return {
    name: 'redact',
    order: 20,
    beforeDispatch(envelope) {
      if (envelope.payload === null || typeof envelope.payload !== 'object') {
        return;
      }
      for (const field of fields) {
        if (field in envelope.payload) {
          envelope.payload[field] = '[redacted]';
        }
      }
    },
  };
}

export function throttlePlugin(limit) {
  let dispatched = 0;
  return {
    name: 'throttle',
    order: 0,
    beforeDispatch(envelope) {
      dispatched += 1;
      if (dispatched > limit) {
        envelope.cancelled = true;
      }
    },
    afterDispatch(envelope) {
      if (envelope.cancelled) {
        dispatched -= 1;
      }
    },
  };
}
