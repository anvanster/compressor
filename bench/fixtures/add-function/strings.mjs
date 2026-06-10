export function capitalize(text) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (text === '') {
    return '';
  }
  return text[0].toUpperCase() + text.slice(1);
}

export function truncate(text, maxLength) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new TypeError('maxLength must be a positive integer');
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

export function words(text) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  return text.split(/\s+/).filter((word) => word.length > 0);
}
