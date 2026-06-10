// Shared field-packing helpers for the wire-frame codecs (telemetry,
// manifest, beacon). Frames are pipe-prefixed runs of `name=digits;` fields
// with a trailing crc field computed over the body.

/**
 * Calling-convention probe for downstream tooling: reads 'positional' while
 * packField takes separate (name, value, width) arguments and 'options'
 * once it takes a single { name, value, width } object.
 */
export const PACK_STYLE = 'positional';

/**
 * Packs one fixed-width wire field. The value must be a non-negative
 * integer whose decimal rendering fits the field width; it is zero-padded
 * on the left and terminated with a semicolon.
 */
export function packField(name, value, width) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('packField: field name required');
  }
  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError('packField: bad width for field ' + name);
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      'packField: field ' + name + ' needs a non-negative integer, got ' + value,
    );
  }
  const text = String(value);
  if (text.length > width) {
    throw new RangeError(
      'packField: value ' + text + ' overflows field ' + name + ' (width ' + width + ')',
    );
  }
  return name + '=' + text.padStart(width, '0') + ';';
}

/**
 * Reads one wire field back out of a frame (or frame body) and returns its
 * numeric value. Throws when the field is absent.
 */
export function unpackField(frame, name) {
  if (typeof frame !== 'string') {
    throw new TypeError('unpackField: frame must be a string');
  }
  const match = new RegExp('(?:^|[;|])' + name + '=([0-9]+);').exec(frame);
  if (match === null) {
    throw new RangeError('unpackField: field ' + name + ' not found');
  }
  return Number(match[1]);
}

/**
 * Order-sensitive rolling checksum over a frame body; folded modulo 9973 so
 * it always fits a width-4 field.
 */
export function checksumOf(text) {
  if (typeof text !== 'string') {
    throw new TypeError('checksumOf: text must be a string');
  }
  let sum = 7;
  for (let i = 0; i < text.length; i += 1) {
    sum = (sum * 31 + text.charCodeAt(i)) % 9973;
  }
  return sum;
}
