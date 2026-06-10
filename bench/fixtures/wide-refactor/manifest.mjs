// Cargo manifest record codec.
//
// A manifest record is the 'MAN2' prefix, a pipe, then every field in
// MANIFEST_FIELD_ORDER as fixed-width `name=digits;` runs, closed by a crc
// field computed over the body. Each field ships a spec constant, a
// validator, an encoder, a decoder, and a describe helper, in canonical
// field order.
import { checksumOf, packField, unpackField } from './util.mjs';

// ─────────────────────────────────────────────────────────────────────────
// Field 1/15 — `rev`: manifest revision counter.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `rev`: manifest revision counter.
 * Valid range 0..999999; field width 6.
 */
export const REV_SPEC = Object.freeze({
  name: 'rev',
  width: 6,
  min: 0,
  max: 999999,
});

/**
 * Collects every problem with `record.rev`; an empty list means
 * the value is valid for encoding.
 */
export function validateRev(record) {
  const problems = [];
  const value = record.rev;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('rev must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('rev must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('rev below minimum 0: ' + value);
  }
  if (value > 999999) {
    problems.push('rev above maximum 999999: ' + value);
  }
  return problems;
}

/** Throws unless `record.rev` is valid for encoding. */
export function assertRev(record) {
  const problems = validateRev(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.rev: ' + problems.join('; '));
  }
}

/** Encodes `rev` as a fixed-width field of the manifest record. */
export function encodeRevField(record) {
  assertRev(record);
  const wire = record.rev;
  return packField('rev', wire, 6);
}

/** Decodes `rev` from a manifest record body; inverse of encodeRevField. */
export function decodeRevField(frame) {
  const wire = unpackField(frame, 'rev');
  if (wire < 0 || wire > 999999) {
    throw new RangeError('manifest.rev: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `rev` for logs and audits. */
export function describeRev(record) {
  return 'rev=' + record.rev;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 2/15 — `shipment`: shipment registry number.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `shipment`: shipment registry number.
 * Valid range 0..99999999; field width 8.
 */
export const SHIPMENT_SPEC = Object.freeze({
  name: 'shipment',
  width: 8,
  min: 0,
  max: 99999999,
});

/**
 * Collects every problem with `record.shipment`; an empty list means
 * the value is valid for encoding.
 */
export function validateShipment(record) {
  const problems = [];
  const value = record.shipment;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('shipment must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('shipment must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('shipment below minimum 0: ' + value);
  }
  if (value > 99999999) {
    problems.push('shipment above maximum 99999999: ' + value);
  }
  return problems;
}

/** Throws unless `record.shipment` is valid for encoding. */
export function assertShipment(record) {
  const problems = validateShipment(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.shipment: ' + problems.join('; '));
  }
}

/** Encodes `shipment` as a fixed-width field of the manifest record. */
export function encodeShipmentField(record) {
  assertShipment(record);
  const wire = record.shipment;
  return packField('shipment', wire, 8);
}

/** Decodes `shipment` from a manifest record body; inverse of encodeShipmentField. */
export function decodeShipmentField(frame) {
  const wire = unpackField(frame, 'shipment');
  if (wire < 0 || wire > 99999999) {
    throw new RangeError('manifest.shipment: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `shipment` for logs and audits. */
export function describeShipment(record) {
  return 'shipment=' + record.shipment;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 3/15 — `pieces`: piece count on the manifest.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `pieces`: piece count on the manifest.
 * Valid range 1..9999; field width 4.
 */
export const PIECES_SPEC = Object.freeze({
  name: 'pieces',
  width: 4,
  min: 1,
  max: 9999,
});

/**
 * Collects every problem with `record.pieces`; an empty list means
 * the value is valid for encoding.
 */
export function validatePieces(record) {
  const problems = [];
  const value = record.pieces;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('pieces must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('pieces must be an integer, got ' + value);
  }
  if (value < 1) {
    problems.push('pieces below minimum 1: ' + value);
  }
  if (value > 9999) {
    problems.push('pieces above maximum 9999: ' + value);
  }
  return problems;
}

/** Throws unless `record.pieces` is valid for encoding. */
export function assertPieces(record) {
  const problems = validatePieces(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.pieces: ' + problems.join('; '));
  }
}

/** Encodes `pieces` as a fixed-width field of the manifest record. */
export function encodePiecesField(record) {
  assertPieces(record);
  const wire = record.pieces;
  return packField('pieces', wire, 4);
}

/** Decodes `pieces` from a manifest record body; inverse of encodePiecesField. */
export function decodePiecesField(frame) {
  const wire = unpackField(frame, 'pieces');
  if (wire < 1 || wire > 9999) {
    throw new RangeError('manifest.pieces: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `pieces` for logs and audits. */
export function describePieces(record) {
  return 'pieces=' + record.pieces;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 4/15 — `gross`: gross mass.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `gross`: gross mass. Unit: kg. Wire value is the reading times 10 (fixed-point).
 * Valid range 0..99999; field width 7.
 */
export const GROSS_SPEC = Object.freeze({
  name: 'gross',
  width: 7,
  scale: 10,
  min: 0,
  max: 99999,
});

/**
 * Collects every problem with `record.gross`; an empty list means
 * the value is valid for encoding.
 */
export function validateGross(record) {
  const problems = [];
  const value = record.gross;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('gross must be a finite number');
    return problems;
  }
  if (value < 0) {
    problems.push('gross below minimum 0: ' + value);
  }
  if (value > 99999) {
    problems.push('gross above maximum 99999: ' + value);
  }
  return problems;
}

/** Throws unless `record.gross` is valid for encoding. */
export function assertGross(record) {
  const problems = validateGross(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.gross: ' + problems.join('; '));
  }
}

/** Encodes `gross` as a fixed-width field of the manifest record. */
export function encodeGrossField(record) {
  assertGross(record);
  const wire = Math.round(record.gross * 10);
  return packField('gross', wire, 7);
}

/** Decodes `gross` from a manifest record body; inverse of encodeGrossField. */
export function decodeGrossField(frame) {
  const wire = unpackField(frame, 'gross');
  if (wire < 0 || wire > 999990) {
    throw new RangeError('manifest.gross: wire value out of range: ' + wire);
  }
  return wire / 10;
}

/** Human-readable rendering of `gross` for logs and audits. */
export function describeGross(record) {
  return 'gross=' + record.gross + 'kg';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 5/15 — `net`: net mass.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `net`: net mass. Unit: kg. Wire value is the reading times 10 (fixed-point).
 * Valid range 0..99999; field width 7.
 */
export const NET_SPEC = Object.freeze({
  name: 'net',
  width: 7,
  scale: 10,
  min: 0,
  max: 99999,
});

/**
 * Collects every problem with `record.net`; an empty list means
 * the value is valid for encoding.
 */
export function validateNet(record) {
  const problems = [];
  const value = record.net;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('net must be a finite number');
    return problems;
  }
  if (value < 0) {
    problems.push('net below minimum 0: ' + value);
  }
  if (value > 99999) {
    problems.push('net above maximum 99999: ' + value);
  }
  return problems;
}

/** Throws unless `record.net` is valid for encoding. */
export function assertNet(record) {
  const problems = validateNet(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.net: ' + problems.join('; '));
  }
}

/** Encodes `net` as a fixed-width field of the manifest record. */
export function encodeNetField(record) {
  assertNet(record);
  const wire = Math.round(record.net * 10);
  return packField('net', wire, 7);
}

/** Decodes `net` from a manifest record body; inverse of encodeNetField. */
export function decodeNetField(frame) {
  const wire = unpackField(frame, 'net');
  if (wire < 0 || wire > 999990) {
    throw new RangeError('manifest.net: wire value out of range: ' + wire);
  }
  return wire / 10;
}

/** Human-readable rendering of `net` for logs and audits. */
export function describeNet(record) {
  return 'net=' + record.net + 'kg';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 6/15 — `volume`: stowage volume.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `volume`: stowage volume. Unit: m3. Wire value is the reading times 100 (fixed-point).
 * Valid range 0..9999; field width 6.
 */
export const VOLUME_SPEC = Object.freeze({
  name: 'volume',
  width: 6,
  scale: 100,
  min: 0,
  max: 9999,
});

/**
 * Collects every problem with `record.volume`; an empty list means
 * the value is valid for encoding.
 */
export function validateVolume(record) {
  const problems = [];
  const value = record.volume;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('volume must be a finite number');
    return problems;
  }
  if (value < 0) {
    problems.push('volume below minimum 0: ' + value);
  }
  if (value > 9999) {
    problems.push('volume above maximum 9999: ' + value);
  }
  return problems;
}

/** Throws unless `record.volume` is valid for encoding. */
export function assertVolume(record) {
  const problems = validateVolume(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.volume: ' + problems.join('; '));
  }
}

/** Encodes `volume` as a fixed-width field of the manifest record. */
export function encodeVolumeField(record) {
  assertVolume(record);
  const wire = Math.round(record.volume * 100);
  return packField('volume', wire, 6);
}

/** Decodes `volume` from a manifest record body; inverse of encodeVolumeField. */
export function decodeVolumeField(frame) {
  const wire = unpackField(frame, 'volume');
  if (wire < 0 || wire > 999900) {
    throw new RangeError('manifest.volume: wire value out of range: ' + wire);
  }
  return wire / 100;
}

/** Human-readable rendering of `volume` for logs and audits. */
export function describeVolume(record) {
  return 'volume=' + record.volume + 'm3';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 7/15 — `declared`: declared value in integer cents.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `declared`: declared value in integer cents. Unit: c.
 * Valid range 0..999999999; field width 9.
 */
export const DECLARED_SPEC = Object.freeze({
  name: 'declared',
  width: 9,
  min: 0,
  max: 999999999,
});

/**
 * Collects every problem with `record.declared`; an empty list means
 * the value is valid for encoding.
 */
export function validateDeclared(record) {
  const problems = [];
  const value = record.declared;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('declared must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('declared must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('declared below minimum 0: ' + value);
  }
  if (value > 999999999) {
    problems.push('declared above maximum 999999999: ' + value);
  }
  return problems;
}

/** Throws unless `record.declared` is valid for encoding. */
export function assertDeclared(record) {
  const problems = validateDeclared(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.declared: ' + problems.join('; '));
  }
}

/** Encodes `declared` as a fixed-width field of the manifest record. */
export function encodeDeclaredField(record) {
  assertDeclared(record);
  const wire = record.declared;
  return packField('declared', wire, 9);
}

/** Decodes `declared` from a manifest record body; inverse of encodeDeclaredField. */
export function decodeDeclaredField(frame) {
  const wire = unpackField(frame, 'declared');
  if (wire < 0 || wire > 999999999) {
    throw new RangeError('manifest.declared: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `declared` for logs and audits. */
export function describeDeclared(record) {
  return 'declared=' + record.declared + 'c';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 8/15 — `insured`: insured value in integer cents.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `insured`: insured value in integer cents. Unit: c.
 * Valid range 0..999999999; field width 9.
 */
export const INSURED_SPEC = Object.freeze({
  name: 'insured',
  width: 9,
  min: 0,
  max: 999999999,
});

/**
 * Collects every problem with `record.insured`; an empty list means
 * the value is valid for encoding.
 */
export function validateInsured(record) {
  const problems = [];
  const value = record.insured;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('insured must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('insured must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('insured below minimum 0: ' + value);
  }
  if (value > 999999999) {
    problems.push('insured above maximum 999999999: ' + value);
  }
  return problems;
}

/** Throws unless `record.insured` is valid for encoding. */
export function assertInsured(record) {
  const problems = validateInsured(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.insured: ' + problems.join('; '));
  }
}

/** Encodes `insured` as a fixed-width field of the manifest record. */
export function encodeInsuredField(record) {
  assertInsured(record);
  const wire = record.insured;
  return packField('insured', wire, 9);
}

/** Decodes `insured` from a manifest record body; inverse of encodeInsuredField. */
export function decodeInsuredField(frame) {
  const wire = unpackField(frame, 'insured');
  if (wire < 0 || wire > 999999999) {
    throw new RangeError('manifest.insured: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `insured` for logs and audits. */
export function describeInsured(record) {
  return 'insured=' + record.insured + 'c';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 9/15 — `origin`: origin port registry code.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `origin`: origin port registry code.
 * Valid range 1..9999; field width 4.
 */
export const ORIGIN_SPEC = Object.freeze({
  name: 'origin',
  width: 4,
  min: 1,
  max: 9999,
});

/**
 * Collects every problem with `record.origin`; an empty list means
 * the value is valid for encoding.
 */
export function validateOrigin(record) {
  const problems = [];
  const value = record.origin;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('origin must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('origin must be an integer, got ' + value);
  }
  if (value < 1) {
    problems.push('origin below minimum 1: ' + value);
  }
  if (value > 9999) {
    problems.push('origin above maximum 9999: ' + value);
  }
  return problems;
}

/** Throws unless `record.origin` is valid for encoding. */
export function assertOrigin(record) {
  const problems = validateOrigin(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.origin: ' + problems.join('; '));
  }
}

/** Encodes `origin` as a fixed-width field of the manifest record. */
export function encodeOriginField(record) {
  assertOrigin(record);
  const wire = record.origin;
  return packField('origin', wire, 4);
}

/** Decodes `origin` from a manifest record body; inverse of encodeOriginField. */
export function decodeOriginField(frame) {
  const wire = unpackField(frame, 'origin');
  if (wire < 1 || wire > 9999) {
    throw new RangeError('manifest.origin: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `origin` for logs and audits. */
export function describeOrigin(record) {
  return 'origin=' + record.origin;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 10/15 — `dest`: destination port registry code.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `dest`: destination port registry code.
 * Valid range 1..9999; field width 4.
 */
export const DEST_SPEC = Object.freeze({
  name: 'dest',
  width: 4,
  min: 1,
  max: 9999,
});

/**
 * Collects every problem with `record.dest`; an empty list means
 * the value is valid for encoding.
 */
export function validateDest(record) {
  const problems = [];
  const value = record.dest;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('dest must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('dest must be an integer, got ' + value);
  }
  if (value < 1) {
    problems.push('dest below minimum 1: ' + value);
  }
  if (value > 9999) {
    problems.push('dest above maximum 9999: ' + value);
  }
  return problems;
}

/** Throws unless `record.dest` is valid for encoding. */
export function assertDest(record) {
  const problems = validateDest(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.dest: ' + problems.join('; '));
  }
}

/** Encodes `dest` as a fixed-width field of the manifest record. */
export function encodeDestField(record) {
  assertDest(record);
  const wire = record.dest;
  return packField('dest', wire, 4);
}

/** Decodes `dest` from a manifest record body; inverse of encodeDestField. */
export function decodeDestField(frame) {
  const wire = unpackField(frame, 'dest');
  if (wire < 1 || wire > 9999) {
    throw new RangeError('manifest.dest: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `dest` for logs and audits. */
export function describeDest(record) {
  return 'dest=' + record.dest;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 11/15 — `seals`: container seal count.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `seals`: container seal count.
 * Valid range 0..999; field width 3.
 */
export const SEALS_SPEC = Object.freeze({
  name: 'seals',
  width: 3,
  min: 0,
  max: 999,
});

/**
 * Collects every problem with `record.seals`; an empty list means
 * the value is valid for encoding.
 */
export function validateSeals(record) {
  const problems = [];
  const value = record.seals;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('seals must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('seals must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('seals below minimum 0: ' + value);
  }
  if (value > 999) {
    problems.push('seals above maximum 999: ' + value);
  }
  return problems;
}

/** Throws unless `record.seals` is valid for encoding. */
export function assertSeals(record) {
  const problems = validateSeals(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.seals: ' + problems.join('; '));
  }
}

/** Encodes `seals` as a fixed-width field of the manifest record. */
export function encodeSealsField(record) {
  assertSeals(record);
  const wire = record.seals;
  return packField('seals', wire, 3);
}

/** Decodes `seals` from a manifest record body; inverse of encodeSealsField. */
export function decodeSealsField(frame) {
  const wire = unpackField(frame, 'seals');
  if (wire < 0 || wire > 999) {
    throw new RangeError('manifest.seals: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `seals` for logs and audits. */
export function describeSeals(record) {
  return 'seals=' + record.seals;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 12/15 — `customs`: customs tariff heading.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `customs`: customs tariff heading.
 * Valid range 0..999999; field width 6.
 */
export const CUSTOMS_SPEC = Object.freeze({
  name: 'customs',
  width: 6,
  min: 0,
  max: 999999,
});

/**
 * Collects every problem with `record.customs`; an empty list means
 * the value is valid for encoding.
 */
export function validateCustoms(record) {
  const problems = [];
  const value = record.customs;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('customs must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('customs must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('customs below minimum 0: ' + value);
  }
  if (value > 999999) {
    problems.push('customs above maximum 999999: ' + value);
  }
  return problems;
}

/** Throws unless `record.customs` is valid for encoding. */
export function assertCustoms(record) {
  const problems = validateCustoms(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.customs: ' + problems.join('; '));
  }
}

/** Encodes `customs` as a fixed-width field of the manifest record. */
export function encodeCustomsField(record) {
  assertCustoms(record);
  const wire = record.customs;
  return packField('customs', wire, 6);
}

/** Decodes `customs` from a manifest record body; inverse of encodeCustomsField. */
export function decodeCustomsField(frame) {
  const wire = unpackField(frame, 'customs');
  if (wire < 0 || wire > 999999) {
    throw new RangeError('manifest.customs: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `customs` for logs and audits. */
export function describeCustoms(record) {
  return 'customs=' + record.customs;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 13/15 — `priority`: movement priority class.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `priority`: movement priority class. Encoded as the index into
 * PRIORITY_CODES, zero-padded to width 2.
 */
export const PRIORITY_CODES = Object.freeze(['deferred', 'standard', 'express', 'critical']);

/**
 * Collects every problem with `record.priority`; an empty list means
 * the value is valid for encoding.
 */
export function validatePriority(record) {
  const problems = [];
  const value = record.priority;
  if (typeof value !== 'string') {
    problems.push('priority must be a string');
    return problems;
  }
  if (!PRIORITY_CODES.includes(value)) {
    problems.push('priority: unknown value ' + value + ' (expected one of ' + PRIORITY_CODES.join('/') + ')');
  }
  return problems;
}

/** Throws unless `record.priority` is valid for encoding. */
export function assertPriority(record) {
  const problems = validatePriority(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.priority: ' + problems.join('; '));
  }
}

/** Encodes `priority` as a fixed-width field of the manifest record. */
export function encodePriorityField(record) {
  assertPriority(record);
  const wire = PRIORITY_CODES.indexOf(record.priority);
  return packField('priority', wire, 2);
}

/** Decodes `priority` from a manifest record body; inverse of encodePriorityField. */
export function decodePriorityField(frame) {
  const wire = unpackField(frame, 'priority');
  if (wire < 0 || wire > 3) {
    throw new RangeError('manifest.priority: wire value out of range: ' + wire);
  }
  return PRIORITY_CODES[wire];
}

/** Human-readable rendering of `priority` for logs and audits. */
export function describePriority(record) {
  return 'priority=' + record.priority;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 14/15 — `docs`: attached document set.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `docs`: attached document set. Encoded as a bitmask in the
 * canonical order below, zero-padded to width 3.
 */
export const DOCS_FLAGS = Object.freeze([
  'invoice',
  'packingList',
  'certOrigin',
  'msds',
  'permit',
]);

/**
 * Collects every problem with `record.docs`; an empty list means
 * the value is valid for encoding.
 */
export function validateDocs(record) {
  const problems = [];
  const value = record.docs;
  if (!Array.isArray(value)) {
    problems.push('docs must be an array of flag names');
    return problems;
  }
  for (const flag of value) {
    if (!DOCS_FLAGS.includes(flag)) {
      problems.push('docs: unknown flag ' + flag);
    }
  }
  if (new Set(value).size !== value.length) {
    problems.push('docs: duplicate flags');
  }
  return problems;
}

/** Throws unless `record.docs` is valid for encoding. */
export function assertDocs(record) {
  const problems = validateDocs(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.docs: ' + problems.join('; '));
  }
}

/** Encodes `docs` as a fixed-width field of the manifest record. */
export function encodeDocsField(record) {
  assertDocs(record);
  let mask = 0;
  for (const flag of record.docs) {
    mask |= 1 << DOCS_FLAGS.indexOf(flag);
  }
  return packField('docs', mask, 3);
}

/** Decodes `docs` from a manifest record body; inverse of encodeDocsField. */
export function decodeDocsField(frame) {
  const wire = unpackField(frame, 'docs');
  if (wire < 0 || wire > 31) {
    throw new RangeError('manifest.docs: wire value out of range: ' + wire);
  }
  const active = [];
  for (let bit = 0; bit < DOCS_FLAGS.length; bit += 1) {
    if ((wire & (1 << bit)) !== 0) {
      active.push(DOCS_FLAGS[bit]);
    }
  }
  return active;
}

/** Human-readable rendering of `docs` for logs and audits. */
export function describeDocs(record) {
  return 'docs=[' + record.docs.join(',') + ']';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 15/15 — `spec`: manifest spec the record conforms to.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `spec`: manifest spec the record conforms to.
 * Valid range major 0..99, minor 0..999; field width 6.
 */
export const SPEC_SPEC = Object.freeze({
  name: 'spec',
  width: 6,
});

/**
 * Collects every problem with `record.spec`; an empty list means
 * the value is valid for encoding.
 */
export function validateSpec(record) {
  const problems = [];
  const value = record.spec;
  if (typeof value !== 'object' || value === null) {
    problems.push('spec must be a { major, minor } object');
    return problems;
  }
  if (!Number.isInteger(value.major) || value.major < 0 || value.major > 99) {
    problems.push('spec.major must be an integer 0..99');
  }
  if (!Number.isInteger(value.minor) || value.minor < 0 || value.minor > 999) {
    problems.push('spec.minor must be an integer 0..999');
  }
  return problems;
}

/** Throws unless `record.spec` is valid for encoding. */
export function assertSpec(record) {
  const problems = validateSpec(record);
  if (problems.length > 0) {
    throw new RangeError('manifest.spec: ' + problems.join('; '));
  }
}

/** Encodes `spec` as a fixed-width field of the manifest record. */
export function encodeSpecField(record) {
  assertSpec(record);
  const wire = record.spec.major * 1000 + record.spec.minor;
  return packField('spec', wire, 6);
}

/** Decodes `spec` from a manifest record body; inverse of encodeSpecField. */
export function decodeSpecField(frame) {
  const wire = unpackField(frame, 'spec');
  if (wire < 0 || wire > 99999) {
    throw new RangeError('manifest.spec: wire value out of range: ' + wire);
  }
  return { major: Math.floor(wire / 1000), minor: wire % 1000 };
}

/** Human-readable rendering of `spec` for logs and audits. */
export function describeSpec(record) {
  return 'spec=v' + record.spec.major + '.' + record.spec.minor;
}

// ─────────────────────────────────────────────────────────────────────────
// Whole-manifest record composition
// ─────────────────────────────────────────────────────────────────────────

/** Canonical field order of the manifest record. */
export const MANIFEST_FIELD_ORDER = Object.freeze([
  'rev',
  'shipment',
  'pieces',
  'gross',
  'net',
  'volume',
  'declared',
  'insured',
  'origin',
  'dest',
  'seals',
  'customs',
  'priority',
  'docs',
  'spec',
]);

/** Frame prefix every manifest record starts with. */
export const MANIFEST_PREFIX = 'MAN2|';

/** Reference record from the integration handbook (appendix B). */
export const EXAMPLE_MANIFEST = Object.freeze({
  rev: 4021,
  shipment: 73019442,
  pieces: 18,
  gross: 1240.5,
  net: 1180.2,
  volume: 14.75,
  declared: 18950000,
  insured: 22000000,
  origin: 5230,
  dest: 1170,
  seals: 4,
  customs: 940423,
  priority: 'express',
  docs: Object.freeze(['invoice', 'certOrigin', 'permit']),
  spec: Object.freeze({ major: 2, minor: 41 }),
});

/** Collects every problem across all fields of a manifest record record. */
export function validateManifest(record) {
  return [
    ...validateRev(record),
    ...validateShipment(record),
    ...validatePieces(record),
    ...validateGross(record),
    ...validateNet(record),
    ...validateVolume(record),
    ...validateDeclared(record),
    ...validateInsured(record),
    ...validateOrigin(record),
    ...validateDest(record),
    ...validateSeals(record),
    ...validateCustoms(record),
    ...validatePriority(record),
    ...validateDocs(record),
    ...validateSpec(record),
  ];
}

/** Encodes a full record as a manifest record, crc included. */
export function encodeManifest(record) {
  const problems = validateManifest(record);
  if (problems.length > 0) {
    throw new RangeError('manifest: invalid record: ' + problems.join('; '));
  }
  const body =
    encodeRevField(record) +
    encodeShipmentField(record) +
    encodePiecesField(record) +
    encodeGrossField(record) +
    encodeNetField(record) +
    encodeVolumeField(record) +
    encodeDeclaredField(record) +
    encodeInsuredField(record) +
    encodeOriginField(record) +
    encodeDestField(record) +
    encodeSealsField(record) +
    encodeCustomsField(record) +
    encodePriorityField(record) +
    encodeDocsField(record) +
    encodeSpecField(record);
  const crc = checksumOf(body);
  return MANIFEST_PREFIX + body + packField('crc', crc, 4);
}

/** Decodes a manifest record back into a record; verifies prefix and crc. */
export function decodeManifest(frame) {
  if (typeof frame !== 'string' || !frame.startsWith(MANIFEST_PREFIX)) {
    throw new TypeError('manifest: not a manifest record');
  }
  const crcAt = frame.lastIndexOf('crc=');
  if (crcAt < 0) {
    throw new RangeError('manifest: missing crc field');
  }
  const body = frame.slice(MANIFEST_PREFIX.length, crcAt);
  const expected = checksumOf(body);
  const actual = unpackField(frame, 'crc');
  if (actual !== expected) {
    throw new RangeError('manifest: crc mismatch: frame carries ' + actual + ', body hashes to ' + expected);
  }
  return {
    rev: decodeRevField(body),
    shipment: decodeShipmentField(body),
    pieces: decodePiecesField(body),
    gross: decodeGrossField(body),
    net: decodeNetField(body),
    volume: decodeVolumeField(body),
    declared: decodeDeclaredField(body),
    insured: decodeInsuredField(body),
    origin: decodeOriginField(body),
    dest: decodeDestField(body),
    seals: decodeSealsField(body),
    customs: decodeCustomsField(body),
    priority: decodePriorityField(body),
    docs: decodeDocsField(body),
    spec: decodeSpecField(body),
  };
}

/** One-line human-readable rendering of a full manifest record record. */
export function describeManifest(record) {
  return [
    describeRev(record),
    describeShipment(record),
    describePieces(record),
    describeGross(record),
    describeNet(record),
    describeVolume(record),
    describeDeclared(record),
    describeInsured(record),
    describeOrigin(record),
    describeDest(record),
    describeSeals(record),
    describeCustoms(record),
    describePriority(record),
    describeDocs(record),
    describeSpec(record),
  ].join(' ');
}
