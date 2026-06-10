// Station status beacon codec.
//
// A status beacon is the 'BCN1' prefix, a pipe, then every field in
// BEACON_FIELD_ORDER as fixed-width `name=digits;` runs, closed by a crc
// field computed over the body. Each field ships a spec constant, a
// validator, an encoder, a decoder, and a describe helper, in canonical
// field order.
import { checksumOf, packField, unpackField } from './util.mjs';

// ─────────────────────────────────────────────────────────────────────────
// Field 1/15 — `beat`: heartbeat counter since commissioning.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `beat`: heartbeat counter since commissioning.
 * Valid range 0..99999999; field width 8.
 */
export const BEAT_SPEC = Object.freeze({
  name: 'beat',
  width: 8,
  min: 0,
  max: 99999999,
});

/**
 * Collects every problem with `record.beat`; an empty list means
 * the value is valid for encoding.
 */
export function validateBeat(record) {
  const problems = [];
  const value = record.beat;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('beat must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('beat must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('beat below minimum 0: ' + value);
  }
  if (value > 99999999) {
    problems.push('beat above maximum 99999999: ' + value);
  }
  return problems;
}

/** Throws unless `record.beat` is valid for encoding. */
export function assertBeat(record) {
  const problems = validateBeat(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.beat: ' + problems.join('; '));
  }
}

/** Encodes `beat` as a fixed-width field of the status beacon. */
export function encodeBeatField(record) {
  assertBeat(record);
  const wire = record.beat;
  return packField('beat', wire, 8);
}

/** Decodes `beat` from a status beacon body; inverse of encodeBeatField. */
export function decodeBeatField(frame) {
  const wire = unpackField(frame, 'beat');
  if (wire < 0 || wire > 99999999) {
    throw new RangeError('beacon.beat: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `beat` for logs and audits. */
export function describeBeat(record) {
  return 'beat=' + record.beat;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 2/15 — `station`: station id from the network plan.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `station`: station id from the network plan.
 * Valid range 1..99999; field width 5.
 */
export const STATION_SPEC = Object.freeze({
  name: 'station',
  width: 5,
  min: 1,
  max: 99999,
});

/**
 * Collects every problem with `record.station`; an empty list means
 * the value is valid for encoding.
 */
export function validateStation(record) {
  const problems = [];
  const value = record.station;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('station must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('station must be an integer, got ' + value);
  }
  if (value < 1) {
    problems.push('station below minimum 1: ' + value);
  }
  if (value > 99999) {
    problems.push('station above maximum 99999: ' + value);
  }
  return problems;
}

/** Throws unless `record.station` is valid for encoding. */
export function assertStation(record) {
  const problems = validateStation(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.station: ' + problems.join('; '));
  }
}

/** Encodes `station` as a fixed-width field of the status beacon. */
export function encodeStationField(record) {
  assertStation(record);
  const wire = record.station;
  return packField('station', wire, 5);
}

/** Decodes `station` from a status beacon body; inverse of encodeStationField. */
export function decodeStationField(frame) {
  const wire = unpackField(frame, 'station');
  if (wire < 1 || wire > 99999) {
    throw new RangeError('beacon.station: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `station` for logs and audits. */
export function describeStation(record) {
  return 'station=' + record.station;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 3/15 — `channel`: active radio channel.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `channel`: active radio channel.
 * Valid range 1..999; field width 3.
 */
export const CHANNEL_SPEC = Object.freeze({
  name: 'channel',
  width: 3,
  min: 1,
  max: 999,
});

/**
 * Collects every problem with `record.channel`; an empty list means
 * the value is valid for encoding.
 */
export function validateChannel(record) {
  const problems = [];
  const value = record.channel;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('channel must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('channel must be an integer, got ' + value);
  }
  if (value < 1) {
    problems.push('channel below minimum 1: ' + value);
  }
  if (value > 999) {
    problems.push('channel above maximum 999: ' + value);
  }
  return problems;
}

/** Throws unless `record.channel` is valid for encoding. */
export function assertChannel(record) {
  const problems = validateChannel(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.channel: ' + problems.join('; '));
  }
}

/** Encodes `channel` as a fixed-width field of the status beacon. */
export function encodeChannelField(record) {
  assertChannel(record);
  const wire = record.channel;
  return packField('channel', wire, 3);
}

/** Decodes `channel` from a status beacon body; inverse of encodeChannelField. */
export function decodeChannelField(frame) {
  const wire = unpackField(frame, 'channel');
  if (wire < 1 || wire > 999) {
    throw new RangeError('beacon.channel: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `channel` for logs and audits. */
export function describeChannel(record) {
  return 'channel=' + record.channel;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 4/15 — `power`: transmit power.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `power`: transmit power. Unit: dBm. Wire value carries a fixed offset of 100 so it is never negative.
 * Valid range -100..60; field width 4.
 */
export const POWER_SPEC = Object.freeze({
  name: 'power',
  width: 4,
  offset: 100,
  min: -100,
  max: 60,
});

/**
 * Collects every problem with `record.power`; an empty list means
 * the value is valid for encoding.
 */
export function validatePower(record) {
  const problems = [];
  const value = record.power;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('power must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('power must be an integer, got ' + value);
  }
  if (value < -100) {
    problems.push('power below minimum -100: ' + value);
  }
  if (value > 60) {
    problems.push('power above maximum 60: ' + value);
  }
  return problems;
}

/** Throws unless `record.power` is valid for encoding. */
export function assertPower(record) {
  const problems = validatePower(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.power: ' + problems.join('; '));
  }
}

/** Encodes `power` as a fixed-width field of the status beacon. */
export function encodePowerField(record) {
  assertPower(record);
  const wire = record.power + 100;
  return packField('power', wire, 4);
}

/** Decodes `power` from a status beacon body; inverse of encodePowerField. */
export function decodePowerField(frame) {
  const wire = unpackField(frame, 'power');
  if (wire < 0 || wire > 160) {
    throw new RangeError('beacon.power: wire value out of range: ' + wire);
  }
  return wire - 100;
}

/** Human-readable rendering of `power` for logs and audits. */
export function describePower(record) {
  return 'power=' + record.power + 'dBm';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 5/15 — `freq`: carrier frequency.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `freq`: carrier frequency. Unit: kHz.
 * Valid range 1..9999999; field width 7.
 */
export const FREQ_SPEC = Object.freeze({
  name: 'freq',
  width: 7,
  min: 1,
  max: 9999999,
});

/**
 * Collects every problem with `record.freq`; an empty list means
 * the value is valid for encoding.
 */
export function validateFreq(record) {
  const problems = [];
  const value = record.freq;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('freq must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('freq must be an integer, got ' + value);
  }
  if (value < 1) {
    problems.push('freq below minimum 1: ' + value);
  }
  if (value > 9999999) {
    problems.push('freq above maximum 9999999: ' + value);
  }
  return problems;
}

/** Throws unless `record.freq` is valid for encoding. */
export function assertFreq(record) {
  const problems = validateFreq(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.freq: ' + problems.join('; '));
  }
}

/** Encodes `freq` as a fixed-width field of the status beacon. */
export function encodeFreqField(record) {
  assertFreq(record);
  const wire = record.freq;
  return packField('freq', wire, 7);
}

/** Decodes `freq` from a status beacon body; inverse of encodeFreqField. */
export function decodeFreqField(frame) {
  const wire = unpackField(frame, 'freq');
  if (wire < 1 || wire > 9999999) {
    throw new RangeError('beacon.freq: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `freq` for logs and audits. */
export function describeFreq(record) {
  return 'freq=' + record.freq + 'kHz';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 6/15 — `duty`: transmit duty cycle.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `duty`: transmit duty cycle. Unit: %.
 * Valid range 0..100; field width 3.
 */
export const DUTY_SPEC = Object.freeze({
  name: 'duty',
  width: 3,
  min: 0,
  max: 100,
});

/**
 * Collects every problem with `record.duty`; an empty list means
 * the value is valid for encoding.
 */
export function validateDuty(record) {
  const problems = [];
  const value = record.duty;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('duty must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('duty must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('duty below minimum 0: ' + value);
  }
  if (value > 100) {
    problems.push('duty above maximum 100: ' + value);
  }
  return problems;
}

/** Throws unless `record.duty` is valid for encoding. */
export function assertDuty(record) {
  const problems = validateDuty(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.duty: ' + problems.join('; '));
  }
}

/** Encodes `duty` as a fixed-width field of the status beacon. */
export function encodeDutyField(record) {
  assertDuty(record);
  const wire = record.duty;
  return packField('duty', wire, 3);
}

/** Decodes `duty` from a status beacon body; inverse of encodeDutyField. */
export function decodeDutyField(frame) {
  const wire = unpackField(frame, 'duty');
  if (wire < 0 || wire > 100) {
    throw new RangeError('beacon.duty: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `duty` for logs and audits. */
export function describeDuty(record) {
  return 'duty=' + record.duty + '%';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 7/15 — `drift`: oscillator drift.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `drift`: oscillator drift. Unit: ppb. Wire value carries a fixed offset of 5000 so it is never negative.
 * Valid range -5000..5000; field width 5.
 */
export const DRIFT_SPEC = Object.freeze({
  name: 'drift',
  width: 5,
  offset: 5000,
  min: -5000,
  max: 5000,
});

/**
 * Collects every problem with `record.drift`; an empty list means
 * the value is valid for encoding.
 */
export function validateDrift(record) {
  const problems = [];
  const value = record.drift;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('drift must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('drift must be an integer, got ' + value);
  }
  if (value < -5000) {
    problems.push('drift below minimum -5000: ' + value);
  }
  if (value > 5000) {
    problems.push('drift above maximum 5000: ' + value);
  }
  return problems;
}

/** Throws unless `record.drift` is valid for encoding. */
export function assertDrift(record) {
  const problems = validateDrift(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.drift: ' + problems.join('; '));
  }
}

/** Encodes `drift` as a fixed-width field of the status beacon. */
export function encodeDriftField(record) {
  assertDrift(record);
  const wire = record.drift + 5000;
  return packField('drift', wire, 5);
}

/** Decodes `drift` from a status beacon body; inverse of encodeDriftField. */
export function decodeDriftField(frame) {
  const wire = unpackField(frame, 'drift');
  if (wire < 0 || wire > 10000) {
    throw new RangeError('beacon.drift: wire value out of range: ' + wire);
  }
  return wire - 5000;
}

/** Human-readable rendering of `drift` for logs and audits. */
export function describeDrift(record) {
  return 'drift=' + record.drift + 'ppb';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 8/15 — `lock`: timing lock state.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `lock`: timing lock state. Encoded as the index into
 * LOCK_CODES, zero-padded to width 2.
 */
export const LOCK_CODES = Object.freeze(['free', 'tracking', 'locked', 'holdover']);

/**
 * Collects every problem with `record.lock`; an empty list means
 * the value is valid for encoding.
 */
export function validateLock(record) {
  const problems = [];
  const value = record.lock;
  if (typeof value !== 'string') {
    problems.push('lock must be a string');
    return problems;
  }
  if (!LOCK_CODES.includes(value)) {
    problems.push('lock: unknown value ' + value + ' (expected one of ' + LOCK_CODES.join('/') + ')');
  }
  return problems;
}

/** Throws unless `record.lock` is valid for encoding. */
export function assertLock(record) {
  const problems = validateLock(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.lock: ' + problems.join('; '));
  }
}

/** Encodes `lock` as a fixed-width field of the status beacon. */
export function encodeLockField(record) {
  assertLock(record);
  const wire = LOCK_CODES.indexOf(record.lock);
  return packField('lock', wire, 2);
}

/** Decodes `lock` from a status beacon body; inverse of encodeLockField. */
export function decodeLockField(frame) {
  const wire = unpackField(frame, 'lock');
  if (wire < 0 || wire > 3) {
    throw new RangeError('beacon.lock: wire value out of range: ' + wire);
  }
  return LOCK_CODES[wire];
}

/** Human-readable rendering of `lock` for logs and audits. */
export function describeLock(record) {
  return 'lock=' + record.lock;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 9/15 — `sats`: satellites used in the timing fix.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `sats`: satellites used in the timing fix.
 * Valid range 0..99; field width 3.
 */
export const SATS_SPEC = Object.freeze({
  name: 'sats',
  width: 3,
  min: 0,
  max: 99,
});

/**
 * Collects every problem with `record.sats`; an empty list means
 * the value is valid for encoding.
 */
export function validateSats(record) {
  const problems = [];
  const value = record.sats;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('sats must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('sats must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('sats below minimum 0: ' + value);
  }
  if (value > 99) {
    problems.push('sats above maximum 99: ' + value);
  }
  return problems;
}

/** Throws unless `record.sats` is valid for encoding. */
export function assertSats(record) {
  const problems = validateSats(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.sats: ' + problems.join('; '));
  }
}

/** Encodes `sats` as a fixed-width field of the status beacon. */
export function encodeSatsField(record) {
  assertSats(record);
  const wire = record.sats;
  return packField('sats', wire, 3);
}

/** Decodes `sats` from a status beacon body; inverse of encodeSatsField. */
export function decodeSatsField(frame) {
  const wire = unpackField(frame, 'sats');
  if (wire < 0 || wire > 99) {
    throw new RangeError('beacon.sats: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `sats` for logs and audits. */
export function describeSats(record) {
  return 'sats=' + record.sats;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 10/15 — `temp`: cabinet temperature.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `temp`: cabinet temperature. Unit: C. Wire value is the reading times 10 plus 1000 (fixed-point).
 * Valid range -100..400; field width 5.
 */
export const TEMP_SPEC = Object.freeze({
  name: 'temp',
  width: 5,
  scale: 10,
  offset: 1000,
  min: -100,
  max: 400,
});

/**
 * Collects every problem with `record.temp`; an empty list means
 * the value is valid for encoding.
 */
export function validateTemp(record) {
  const problems = [];
  const value = record.temp;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('temp must be a finite number');
    return problems;
  }
  if (value < -100) {
    problems.push('temp below minimum -100: ' + value);
  }
  if (value > 400) {
    problems.push('temp above maximum 400: ' + value);
  }
  return problems;
}

/** Throws unless `record.temp` is valid for encoding. */
export function assertTemp(record) {
  const problems = validateTemp(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.temp: ' + problems.join('; '));
  }
}

/** Encodes `temp` as a fixed-width field of the status beacon. */
export function encodeTempField(record) {
  assertTemp(record);
  const wire = Math.round(record.temp * 10) + 1000;
  return packField('temp', wire, 5);
}

/** Decodes `temp` from a status beacon body; inverse of encodeTempField. */
export function decodeTempField(frame) {
  const wire = unpackField(frame, 'temp');
  if (wire < 0 || wire > 5000) {
    throw new RangeError('beacon.temp: wire value out of range: ' + wire);
  }
  return (wire - 1000) / 10;
}

/** Human-readable rendering of `temp` for logs and audits. */
export function describeTemp(record) {
  return 'temp=' + record.temp + 'C';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 11/15 — `volt`: supply rail voltage.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `volt`: supply rail voltage. Unit: V. Wire value is the reading times 100 (fixed-point).
 * Valid range 0..99; field width 5.
 */
export const VOLT_SPEC = Object.freeze({
  name: 'volt',
  width: 5,
  scale: 100,
  min: 0,
  max: 99,
});

/**
 * Collects every problem with `record.volt`; an empty list means
 * the value is valid for encoding.
 */
export function validateVolt(record) {
  const problems = [];
  const value = record.volt;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('volt must be a finite number');
    return problems;
  }
  if (value < 0) {
    problems.push('volt below minimum 0: ' + value);
  }
  if (value > 99) {
    problems.push('volt above maximum 99: ' + value);
  }
  return problems;
}

/** Throws unless `record.volt` is valid for encoding. */
export function assertVolt(record) {
  const problems = validateVolt(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.volt: ' + problems.join('; '));
  }
}

/** Encodes `volt` as a fixed-width field of the status beacon. */
export function encodeVoltField(record) {
  assertVolt(record);
  const wire = Math.round(record.volt * 100);
  return packField('volt', wire, 5);
}

/** Decodes `volt` from a status beacon body; inverse of encodeVoltField. */
export function decodeVoltField(frame) {
  const wire = unpackField(frame, 'volt');
  if (wire < 0 || wire > 9900) {
    throw new RangeError('beacon.volt: wire value out of range: ' + wire);
  }
  return wire / 100;
}

/** Human-readable rendering of `volt` for logs and audits. */
export function describeVolt(record) {
  return 'volt=' + record.volt + 'V';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 12/15 — `region`: regulatory region profile.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `region`: regulatory region profile. Encoded as the index into
 * REGION_CODES, zero-padded to width 2.
 */
export const REGION_CODES = Object.freeze(['amer', 'emea', 'apac']);

/**
 * Collects every problem with `record.region`; an empty list means
 * the value is valid for encoding.
 */
export function validateRegion(record) {
  const problems = [];
  const value = record.region;
  if (typeof value !== 'string') {
    problems.push('region must be a string');
    return problems;
  }
  if (!REGION_CODES.includes(value)) {
    problems.push('region: unknown value ' + value + ' (expected one of ' + REGION_CODES.join('/') + ')');
  }
  return problems;
}

/** Throws unless `record.region` is valid for encoding. */
export function assertRegion(record) {
  const problems = validateRegion(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.region: ' + problems.join('; '));
  }
}

/** Encodes `region` as a fixed-width field of the status beacon. */
export function encodeRegionField(record) {
  assertRegion(record);
  const wire = REGION_CODES.indexOf(record.region);
  return packField('region', wire, 2);
}

/** Decodes `region` from a status beacon body; inverse of encodeRegionField. */
export function decodeRegionField(frame) {
  const wire = unpackField(frame, 'region');
  if (wire < 0 || wire > 2) {
    throw new RangeError('beacon.region: wire value out of range: ' + wire);
  }
  return REGION_CODES[wire];
}

/** Human-readable rendering of `region` for logs and audits. */
export function describeRegion(record) {
  return 'region=' + record.region;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 13/15 — `errs`: active error latches.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `errs`: active error latches. Encoded as a bitmask in the
 * canonical order below, zero-padded to width 3.
 */
export const ERRS_FLAGS = Object.freeze([
  'antennaFault',
  'oscAging',
  'powerSag',
  'gpsLoss',
  'doorOpen',
]);

/**
 * Collects every problem with `record.errs`; an empty list means
 * the value is valid for encoding.
 */
export function validateErrs(record) {
  const problems = [];
  const value = record.errs;
  if (!Array.isArray(value)) {
    problems.push('errs must be an array of flag names');
    return problems;
  }
  for (const flag of value) {
    if (!ERRS_FLAGS.includes(flag)) {
      problems.push('errs: unknown flag ' + flag);
    }
  }
  if (new Set(value).size !== value.length) {
    problems.push('errs: duplicate flags');
  }
  return problems;
}

/** Throws unless `record.errs` is valid for encoding. */
export function assertErrs(record) {
  const problems = validateErrs(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.errs: ' + problems.join('; '));
  }
}

/** Encodes `errs` as a fixed-width field of the status beacon. */
export function encodeErrsField(record) {
  assertErrs(record);
  let mask = 0;
  for (const flag of record.errs) {
    mask |= 1 << ERRS_FLAGS.indexOf(flag);
  }
  return packField('errs', mask, 3);
}

/** Decodes `errs` from a status beacon body; inverse of encodeErrsField. */
export function decodeErrsField(frame) {
  const wire = unpackField(frame, 'errs');
  if (wire < 0 || wire > 31) {
    throw new RangeError('beacon.errs: wire value out of range: ' + wire);
  }
  const active = [];
  for (let bit = 0; bit < ERRS_FLAGS.length; bit += 1) {
    if ((wire & (1 << bit)) !== 0) {
      active.push(ERRS_FLAGS[bit]);
    }
  }
  return active;
}

/** Human-readable rendering of `errs` for logs and audits. */
export function describeErrs(record) {
  return 'errs=[' + record.errs.join(',') + ']';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 14/15 — `build`: firmware build number.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `build`: firmware build number.
 * Valid range 0..999999; field width 6.
 */
export const BUILD_SPEC = Object.freeze({
  name: 'build',
  width: 6,
  min: 0,
  max: 999999,
});

/**
 * Collects every problem with `record.build`; an empty list means
 * the value is valid for encoding.
 */
export function validateBuild(record) {
  const problems = [];
  const value = record.build;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('build must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('build must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('build below minimum 0: ' + value);
  }
  if (value > 999999) {
    problems.push('build above maximum 999999: ' + value);
  }
  return problems;
}

/** Throws unless `record.build` is valid for encoding. */
export function assertBuild(record) {
  const problems = validateBuild(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.build: ' + problems.join('; '));
  }
}

/** Encodes `build` as a fixed-width field of the status beacon. */
export function encodeBuildField(record) {
  assertBuild(record);
  const wire = record.build;
  return packField('build', wire, 6);
}

/** Decodes `build` from a status beacon body; inverse of encodeBuildField. */
export function decodeBuildField(frame) {
  const wire = unpackField(frame, 'build');
  if (wire < 0 || wire > 999999) {
    throw new RangeError('beacon.build: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `build` for logs and audits. */
export function describeBuild(record) {
  return 'build=' + record.build;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 15/15 — `hours`: powered hours on the meter.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `hours`: powered hours on the meter. Unit: h.
 * Valid range 0..999999; field width 6.
 */
export const HOURS_SPEC = Object.freeze({
  name: 'hours',
  width: 6,
  min: 0,
  max: 999999,
});

/**
 * Collects every problem with `record.hours`; an empty list means
 * the value is valid for encoding.
 */
export function validateHours(record) {
  const problems = [];
  const value = record.hours;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('hours must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('hours must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('hours below minimum 0: ' + value);
  }
  if (value > 999999) {
    problems.push('hours above maximum 999999: ' + value);
  }
  return problems;
}

/** Throws unless `record.hours` is valid for encoding. */
export function assertHours(record) {
  const problems = validateHours(record);
  if (problems.length > 0) {
    throw new RangeError('beacon.hours: ' + problems.join('; '));
  }
}

/** Encodes `hours` as a fixed-width field of the status beacon. */
export function encodeHoursField(record) {
  assertHours(record);
  const wire = record.hours;
  return packField('hours', wire, 6);
}

/** Decodes `hours` from a status beacon body; inverse of encodeHoursField. */
export function decodeHoursField(frame) {
  const wire = unpackField(frame, 'hours');
  if (wire < 0 || wire > 999999) {
    throw new RangeError('beacon.hours: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `hours` for logs and audits. */
export function describeHours(record) {
  return 'hours=' + record.hours + 'h';
}

// ─────────────────────────────────────────────────────────────────────────
// Whole-status beacon composition
// ─────────────────────────────────────────────────────────────────────────

/** Canonical field order of the status beacon. */
export const BEACON_FIELD_ORDER = Object.freeze([
  'beat',
  'station',
  'channel',
  'power',
  'freq',
  'duty',
  'drift',
  'lock',
  'sats',
  'temp',
  'volt',
  'region',
  'errs',
  'build',
  'hours',
]);

/** Frame prefix every status beacon starts with. */
export const BEACON_PREFIX = 'BCN1|';

/** Reference record from the integration handbook (appendix B). */
export const EXAMPLE_BEACON = Object.freeze({
  beat: 55103201,
  station: 20771,
  channel: 14,
  power: -23,
  freq: 1575420,
  duty: 45,
  drift: -210,
  lock: 'locked',
  sats: 11,
  temp: 36.5,
  volt: 12.48,
  region: 'emea',
  errs: Object.freeze(['oscAging']),
  build: 204819,
  hours: 16204,
});

/** Collects every problem across all fields of a status beacon record. */
export function validateBeacon(record) {
  return [
    ...validateBeat(record),
    ...validateStation(record),
    ...validateChannel(record),
    ...validatePower(record),
    ...validateFreq(record),
    ...validateDuty(record),
    ...validateDrift(record),
    ...validateLock(record),
    ...validateSats(record),
    ...validateTemp(record),
    ...validateVolt(record),
    ...validateRegion(record),
    ...validateErrs(record),
    ...validateBuild(record),
    ...validateHours(record),
  ];
}

/** Encodes a full record as a status beacon, crc included. */
export function encodeBeacon(record) {
  const problems = validateBeacon(record);
  if (problems.length > 0) {
    throw new RangeError('beacon: invalid record: ' + problems.join('; '));
  }
  const body =
    encodeBeatField(record) +
    encodeStationField(record) +
    encodeChannelField(record) +
    encodePowerField(record) +
    encodeFreqField(record) +
    encodeDutyField(record) +
    encodeDriftField(record) +
    encodeLockField(record) +
    encodeSatsField(record) +
    encodeTempField(record) +
    encodeVoltField(record) +
    encodeRegionField(record) +
    encodeErrsField(record) +
    encodeBuildField(record) +
    encodeHoursField(record);
  const crc = checksumOf(body);
  return BEACON_PREFIX + body + packField('crc', crc, 4);
}

/** Decodes a status beacon back into a record; verifies prefix and crc. */
export function decodeBeacon(frame) {
  if (typeof frame !== 'string' || !frame.startsWith(BEACON_PREFIX)) {
    throw new TypeError('beacon: not a status beacon');
  }
  const crcAt = frame.lastIndexOf('crc=');
  if (crcAt < 0) {
    throw new RangeError('beacon: missing crc field');
  }
  const body = frame.slice(BEACON_PREFIX.length, crcAt);
  const expected = checksumOf(body);
  const actual = unpackField(frame, 'crc');
  if (actual !== expected) {
    throw new RangeError('beacon: crc mismatch: frame carries ' + actual + ', body hashes to ' + expected);
  }
  return {
    beat: decodeBeatField(body),
    station: decodeStationField(body),
    channel: decodeChannelField(body),
    power: decodePowerField(body),
    freq: decodeFreqField(body),
    duty: decodeDutyField(body),
    drift: decodeDriftField(body),
    lock: decodeLockField(body),
    sats: decodeSatsField(body),
    temp: decodeTempField(body),
    volt: decodeVoltField(body),
    region: decodeRegionField(body),
    errs: decodeErrsField(body),
    build: decodeBuildField(body),
    hours: decodeHoursField(body),
  };
}

/** One-line human-readable rendering of a full status beacon record. */
export function describeBeacon(record) {
  return [
    describeBeat(record),
    describeStation(record),
    describeChannel(record),
    describePower(record),
    describeFreq(record),
    describeDuty(record),
    describeDrift(record),
    describeLock(record),
    describeSats(record),
    describeTemp(record),
    describeVolt(record),
    describeRegion(record),
    describeErrs(record),
    describeBuild(record),
    describeHours(record),
  ].join(' ');
}
