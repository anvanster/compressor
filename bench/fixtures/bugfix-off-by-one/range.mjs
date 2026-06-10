export function range(start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new TypeError('range bounds must be integers');
  }
  const out = [];
  for (let i = start; i < end; i += 1) {
    out.push(i);
  }
  return out;
}
