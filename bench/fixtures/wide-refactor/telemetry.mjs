// Sensor telemetry frame codec.
//
// A telemetry frame is the 'TLM1' prefix, a pipe, then every field in
// TELEMETRY_FIELD_ORDER as fixed-width `name=digits;` runs, closed by a crc
// field computed over the body. Each field ships a spec constant, a
// validator, an encoder, a decoder, and a describe helper, in canonical
// field order.
import { checksumOf, packField, unpackField } from './util.mjs';

// ─────────────────────────────────────────────────────────────────────────
// Field 1/15 — `seq`: monotonic frame sequence number.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `seq`: monotonic frame sequence number.
 * Valid range 0..999999; field width 6.
 */
export const SEQ_SPEC = Object.freeze({
  name: 'seq',
  width: 6,
  min: 0,
  max: 999999,
});

/**
 * Collects every problem with `record.seq`; an empty list means
 * the value is valid for encoding.
 */
export function validateSeq(record) {
  const problems = [];
  const value = record.seq;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('seq must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('seq must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('seq below minimum 0: ' + value);
  }
  if (value > 999999) {
    problems.push('seq above maximum 999999: ' + value);
  }
  return problems;
}

/** Throws unless `record.seq` is valid for encoding. */
export function assertSeq(record) {
  const problems = validateSeq(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.seq: ' + problems.join('; '));
  }
}

/** Encodes `seq` as a fixed-width field of the telemetry frame. */
export function encodeSeqField(record) {
  assertSeq(record);
  const wire = record.seq;
  return packField('seq', wire, 6);
}

/** Decodes `seq` from a telemetry frame body; inverse of encodeSeqField. */
export function decodeSeqField(frame) {
  const wire = unpackField(frame, 'seq');
  if (wire < 0 || wire > 999999) {
    throw new RangeError('telemetry.seq: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `seq` for logs and audits. */
export function describeSeq(record) {
  return 'seq=' + record.seq;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 2/15 — `uptime`: whole seconds since the node booted.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `uptime`: whole seconds since the node booted. Unit: s.
 * Valid range 0..99999999; field width 8.
 */
export const UPTIME_SPEC = Object.freeze({
  name: 'uptime',
  width: 8,
  min: 0,
  max: 99999999,
});

/**
 * Collects every problem with `record.uptime`; an empty list means
 * the value is valid for encoding.
 */
export function validateUptime(record) {
  const problems = [];
  const value = record.uptime;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('uptime must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('uptime must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('uptime below minimum 0: ' + value);
  }
  if (value > 99999999) {
    problems.push('uptime above maximum 99999999: ' + value);
  }
  return problems;
}

/** Throws unless `record.uptime` is valid for encoding. */
export function assertUptime(record) {
  const problems = validateUptime(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.uptime: ' + problems.join('; '));
  }
}

/** Encodes `uptime` as a fixed-width field of the telemetry frame. */
export function encodeUptimeField(record) {
  assertUptime(record);
  const wire = record.uptime;
  return packField('uptime', wire, 8);
}

/** Decodes `uptime` from a telemetry frame body; inverse of encodeUptimeField. */
export function decodeUptimeField(frame) {
  const wire = unpackField(frame, 'uptime');
  if (wire < 0 || wire > 99999999) {
    throw new RangeError('telemetry.uptime: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `uptime` for logs and audits. */
export function describeUptime(record) {
  return 'uptime=' + record.uptime + 's';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 3/15 — `node`: reporting node id from the site registry.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `node`: reporting node id from the site registry.
 * Valid range 1..9999; field width 4.
 */
export const NODE_SPEC = Object.freeze({
  name: 'node',
  width: 4,
  min: 1,
  max: 9999,
});

/**
 * Collects every problem with `record.node`; an empty list means
 * the value is valid for encoding.
 */
export function validateNode(record) {
  const problems = [];
  const value = record.node;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('node must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('node must be an integer, got ' + value);
  }
  if (value < 1) {
    problems.push('node below minimum 1: ' + value);
  }
  if (value > 9999) {
    problems.push('node above maximum 9999: ' + value);
  }
  return problems;
}

/** Throws unless `record.node` is valid for encoding. */
export function assertNode(record) {
  const problems = validateNode(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.node: ' + problems.join('; '));
  }
}

/** Encodes `node` as a fixed-width field of the telemetry frame. */
export function encodeNodeField(record) {
  assertNode(record);
  const wire = record.node;
  return packField('node', wire, 4);
}

/** Decodes `node` from a telemetry frame body; inverse of encodeNodeField. */
export function decodeNodeField(frame) {
  const wire = unpackField(frame, 'node');
  if (wire < 1 || wire > 9999) {
    throw new RangeError('telemetry.node: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `node` for logs and audits. */
export function describeNode(record) {
  return 'node=' + record.node;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 4/15 — `temp`: ambient temperature.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `temp`: ambient temperature. Unit: C. Wire value is the reading times 10 plus 1000 (fixed-point).
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
    throw new RangeError('telemetry.temp: ' + problems.join('; '));
  }
}

/** Encodes `temp` as a fixed-width field of the telemetry frame. */
export function encodeTempField(record) {
  assertTemp(record);
  const wire = Math.round(record.temp * 10) + 1000;
  return packField('temp', wire, 5);
}

/** Decodes `temp` from a telemetry frame body; inverse of encodeTempField. */
export function decodeTempField(frame) {
  const wire = unpackField(frame, 'temp');
  if (wire < 0 || wire > 5000) {
    throw new RangeError('telemetry.temp: wire value out of range: ' + wire);
  }
  return (wire - 1000) / 10;
}

/** Human-readable rendering of `temp` for logs and audits. */
export function describeTemp(record) {
  return 'temp=' + record.temp + 'C';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 5/15 — `pressure`: barometric pressure.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `pressure`: barometric pressure. Unit: hPa. Wire value is the reading times 10 (fixed-point).
 * Valid range 0..20000; field width 6.
 */
export const PRESSURE_SPEC = Object.freeze({
  name: 'pressure',
  width: 6,
  scale: 10,
  min: 0,
  max: 20000,
});

/**
 * Collects every problem with `record.pressure`; an empty list means
 * the value is valid for encoding.
 */
export function validatePressure(record) {
  const problems = [];
  const value = record.pressure;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('pressure must be a finite number');
    return problems;
  }
  if (value < 0) {
    problems.push('pressure below minimum 0: ' + value);
  }
  if (value > 20000) {
    problems.push('pressure above maximum 20000: ' + value);
  }
  return problems;
}

/** Throws unless `record.pressure` is valid for encoding. */
export function assertPressure(record) {
  const problems = validatePressure(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.pressure: ' + problems.join('; '));
  }
}

/** Encodes `pressure` as a fixed-width field of the telemetry frame. */
export function encodePressureField(record) {
  assertPressure(record);
  const wire = Math.round(record.pressure * 10);
  return packField('pressure', wire, 6);
}

/** Decodes `pressure` from a telemetry frame body; inverse of encodePressureField. */
export function decodePressureField(frame) {
  const wire = unpackField(frame, 'pressure');
  if (wire < 0 || wire > 200000) {
    throw new RangeError('telemetry.pressure: wire value out of range: ' + wire);
  }
  return wire / 10;
}

/** Human-readable rendering of `pressure` for logs and audits. */
export function describePressure(record) {
  return 'pressure=' + record.pressure + 'hPa';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 6/15 — `humidity`: relative humidity.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `humidity`: relative humidity. Unit: %RH.
 * Valid range 0..100; field width 3.
 */
export const HUMIDITY_SPEC = Object.freeze({
  name: 'humidity',
  width: 3,
  min: 0,
  max: 100,
});

/**
 * Collects every problem with `record.humidity`; an empty list means
 * the value is valid for encoding.
 */
export function validateHumidity(record) {
  const problems = [];
  const value = record.humidity;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('humidity must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('humidity must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('humidity below minimum 0: ' + value);
  }
  if (value > 100) {
    problems.push('humidity above maximum 100: ' + value);
  }
  return problems;
}

/** Throws unless `record.humidity` is valid for encoding. */
export function assertHumidity(record) {
  const problems = validateHumidity(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.humidity: ' + problems.join('; '));
  }
}

/** Encodes `humidity` as a fixed-width field of the telemetry frame. */
export function encodeHumidityField(record) {
  assertHumidity(record);
  const wire = record.humidity;
  return packField('humidity', wire, 3);
}

/** Decodes `humidity` from a telemetry frame body; inverse of encodeHumidityField. */
export function decodeHumidityField(frame) {
  const wire = unpackField(frame, 'humidity');
  if (wire < 0 || wire > 100) {
    throw new RangeError('telemetry.humidity: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `humidity` for logs and audits. */
export function describeHumidity(record) {
  return 'humidity=' + record.humidity + '%RH';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 7/15 — `battery`: battery charge remaining.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `battery`: battery charge remaining. Unit: %.
 * Valid range 0..100; field width 3.
 */
export const BATTERY_SPEC = Object.freeze({
  name: 'battery',
  width: 3,
  min: 0,
  max: 100,
});

/**
 * Collects every problem with `record.battery`; an empty list means
 * the value is valid for encoding.
 */
export function validateBattery(record) {
  const problems = [];
  const value = record.battery;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('battery must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('battery must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('battery below minimum 0: ' + value);
  }
  if (value > 100) {
    problems.push('battery above maximum 100: ' + value);
  }
  return problems;
}

/** Throws unless `record.battery` is valid for encoding. */
export function assertBattery(record) {
  const problems = validateBattery(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.battery: ' + problems.join('; '));
  }
}

/** Encodes `battery` as a fixed-width field of the telemetry frame. */
export function encodeBatteryField(record) {
  assertBattery(record);
  const wire = record.battery;
  return packField('battery', wire, 3);
}

/** Decodes `battery` from a telemetry frame body; inverse of encodeBatteryField. */
export function decodeBatteryField(frame) {
  const wire = unpackField(frame, 'battery');
  if (wire < 0 || wire > 100) {
    throw new RangeError('telemetry.battery: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `battery` for logs and audits. */
export function describeBattery(record) {
  return 'battery=' + record.battery + '%';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 8/15 — `rssi`: received signal strength.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `rssi`: received signal strength. Unit: dBm. Wire value carries a fixed offset of 200 so it is never negative.
 * Valid range -200..99; field width 3.
 */
export const RSSI_SPEC = Object.freeze({
  name: 'rssi',
  width: 3,
  offset: 200,
  min: -200,
  max: 99,
});

/**
 * Collects every problem with `record.rssi`; an empty list means
 * the value is valid for encoding.
 */
export function validateRssi(record) {
  const problems = [];
  const value = record.rssi;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('rssi must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('rssi must be an integer, got ' + value);
  }
  if (value < -200) {
    problems.push('rssi below minimum -200: ' + value);
  }
  if (value > 99) {
    problems.push('rssi above maximum 99: ' + value);
  }
  return problems;
}

/** Throws unless `record.rssi` is valid for encoding. */
export function assertRssi(record) {
  const problems = validateRssi(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.rssi: ' + problems.join('; '));
  }
}

/** Encodes `rssi` as a fixed-width field of the telemetry frame. */
export function encodeRssiField(record) {
  assertRssi(record);
  const wire = record.rssi + 200;
  return packField('rssi', wire, 3);
}

/** Decodes `rssi` from a telemetry frame body; inverse of encodeRssiField. */
export function decodeRssiField(frame) {
  const wire = unpackField(frame, 'rssi');
  if (wire < 0 || wire > 299) {
    throw new RangeError('telemetry.rssi: wire value out of range: ' + wire);
  }
  return wire - 200;
}

/** Human-readable rendering of `rssi` for logs and audits. */
export function describeRssi(record) {
  return 'rssi=' + record.rssi + 'dBm';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 9/15 — `lat`: site latitude.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `lat`: site latitude. Unit: deg. Wire value is the reading times 10000 plus 900000 (fixed-point).
 * Valid range -90..90; field width 8.
 */
export const LAT_SPEC = Object.freeze({
  name: 'lat',
  width: 8,
  scale: 10000,
  offset: 900000,
  min: -90,
  max: 90,
});

/**
 * Collects every problem with `record.lat`; an empty list means
 * the value is valid for encoding.
 */
export function validateLat(record) {
  const problems = [];
  const value = record.lat;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('lat must be a finite number');
    return problems;
  }
  if (value < -90) {
    problems.push('lat below minimum -90: ' + value);
  }
  if (value > 90) {
    problems.push('lat above maximum 90: ' + value);
  }
  return problems;
}

/** Throws unless `record.lat` is valid for encoding. */
export function assertLat(record) {
  const problems = validateLat(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.lat: ' + problems.join('; '));
  }
}

/** Encodes `lat` as a fixed-width field of the telemetry frame. */
export function encodeLatField(record) {
  assertLat(record);
  const wire = Math.round(record.lat * 10000) + 900000;
  return packField('lat', wire, 8);
}

/** Decodes `lat` from a telemetry frame body; inverse of encodeLatField. */
export function decodeLatField(frame) {
  const wire = unpackField(frame, 'lat');
  if (wire < 0 || wire > 1800000) {
    throw new RangeError('telemetry.lat: wire value out of range: ' + wire);
  }
  return (wire - 900000) / 10000;
}

/** Human-readable rendering of `lat` for logs and audits. */
export function describeLat(record) {
  return 'lat=' + record.lat + 'deg';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 10/15 — `lon`: site longitude.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `lon`: site longitude. Unit: deg. Wire value is the reading times 10000 plus 1800000 (fixed-point).
 * Valid range -180..180; field width 8.
 */
export const LON_SPEC = Object.freeze({
  name: 'lon',
  width: 8,
  scale: 10000,
  offset: 1800000,
  min: -180,
  max: 180,
});

/**
 * Collects every problem with `record.lon`; an empty list means
 * the value is valid for encoding.
 */
export function validateLon(record) {
  const problems = [];
  const value = record.lon;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('lon must be a finite number');
    return problems;
  }
  if (value < -180) {
    problems.push('lon below minimum -180: ' + value);
  }
  if (value > 180) {
    problems.push('lon above maximum 180: ' + value);
  }
  return problems;
}

/** Throws unless `record.lon` is valid for encoding. */
export function assertLon(record) {
  const problems = validateLon(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.lon: ' + problems.join('; '));
  }
}

/** Encodes `lon` as a fixed-width field of the telemetry frame. */
export function encodeLonField(record) {
  assertLon(record);
  const wire = Math.round(record.lon * 10000) + 1800000;
  return packField('lon', wire, 8);
}

/** Decodes `lon` from a telemetry frame body; inverse of encodeLonField. */
export function decodeLonField(frame) {
  const wire = unpackField(frame, 'lon');
  if (wire < 0 || wire > 3600000) {
    throw new RangeError('telemetry.lon: wire value out of range: ' + wire);
  }
  return (wire - 1800000) / 10000;
}

/** Human-readable rendering of `lon` for logs and audits. */
export function describeLon(record) {
  return 'lon=' + record.lon + 'deg';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 11/15 — `alt`: antenna altitude above datum.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `alt`: antenna altitude above datum. Unit: m. Wire value carries a fixed offset of 1000 so it is never negative.
 * Valid range -1000..99000; field width 6.
 */
export const ALT_SPEC = Object.freeze({
  name: 'alt',
  width: 6,
  offset: 1000,
  min: -1000,
  max: 99000,
});

/**
 * Collects every problem with `record.alt`; an empty list means
 * the value is valid for encoding.
 */
export function validateAlt(record) {
  const problems = [];
  const value = record.alt;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('alt must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('alt must be an integer, got ' + value);
  }
  if (value < -1000) {
    problems.push('alt below minimum -1000: ' + value);
  }
  if (value > 99000) {
    problems.push('alt above maximum 99000: ' + value);
  }
  return problems;
}

/** Throws unless `record.alt` is valid for encoding. */
export function assertAlt(record) {
  const problems = validateAlt(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.alt: ' + problems.join('; '));
  }
}

/** Encodes `alt` as a fixed-width field of the telemetry frame. */
export function encodeAltField(record) {
  assertAlt(record);
  const wire = record.alt + 1000;
  return packField('alt', wire, 6);
}

/** Decodes `alt` from a telemetry frame body; inverse of encodeAltField. */
export function decodeAltField(frame) {
  const wire = unpackField(frame, 'alt');
  if (wire < 0 || wire > 100000) {
    throw new RangeError('telemetry.alt: wire value out of range: ' + wire);
  }
  return wire - 1000;
}

/** Human-readable rendering of `alt` for logs and audits. */
export function describeAlt(record) {
  return 'alt=' + record.alt + 'm';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 12/15 — `fanrpm`: enclosure fan speed.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `fanrpm`: enclosure fan speed. Unit: rpm.
 * Valid range 0..65000; field width 5.
 */
export const FANRPM_SPEC = Object.freeze({
  name: 'fanrpm',
  width: 5,
  min: 0,
  max: 65000,
});

/**
 * Collects every problem with `record.fanrpm`; an empty list means
 * the value is valid for encoding.
 */
export function validateFanrpm(record) {
  const problems = [];
  const value = record.fanrpm;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push('fanrpm must be a finite number');
    return problems;
  }
  if (!Number.isInteger(value)) {
    problems.push('fanrpm must be an integer, got ' + value);
  }
  if (value < 0) {
    problems.push('fanrpm below minimum 0: ' + value);
  }
  if (value > 65000) {
    problems.push('fanrpm above maximum 65000: ' + value);
  }
  return problems;
}

/** Throws unless `record.fanrpm` is valid for encoding. */
export function assertFanrpm(record) {
  const problems = validateFanrpm(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.fanrpm: ' + problems.join('; '));
  }
}

/** Encodes `fanrpm` as a fixed-width field of the telemetry frame. */
export function encodeFanrpmField(record) {
  assertFanrpm(record);
  const wire = record.fanrpm;
  return packField('fanrpm', wire, 5);
}

/** Decodes `fanrpm` from a telemetry frame body; inverse of encodeFanrpmField. */
export function decodeFanrpmField(frame) {
  const wire = unpackField(frame, 'fanrpm');
  if (wire < 0 || wire > 65000) {
    throw new RangeError('telemetry.fanrpm: wire value out of range: ' + wire);
  }
  return wire;
}

/** Human-readable rendering of `fanrpm` for logs and audits. */
export function describeFanrpm(record) {
  return 'fanrpm=' + record.fanrpm + 'rpm';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 13/15 — `mode`: operating mode.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `mode`: operating mode. Encoded as the index into
 * MODE_CODES, zero-padded to width 2.
 */
export const MODE_CODES = Object.freeze(['idle', 'active', 'safe', 'boot', 'update']);

/**
 * Collects every problem with `record.mode`; an empty list means
 * the value is valid for encoding.
 */
export function validateMode(record) {
  const problems = [];
  const value = record.mode;
  if (typeof value !== 'string') {
    problems.push('mode must be a string');
    return problems;
  }
  if (!MODE_CODES.includes(value)) {
    problems.push('mode: unknown value ' + value + ' (expected one of ' + MODE_CODES.join('/') + ')');
  }
  return problems;
}

/** Throws unless `record.mode` is valid for encoding. */
export function assertMode(record) {
  const problems = validateMode(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.mode: ' + problems.join('; '));
  }
}

/** Encodes `mode` as a fixed-width field of the telemetry frame. */
export function encodeModeField(record) {
  assertMode(record);
  const wire = MODE_CODES.indexOf(record.mode);
  return packField('mode', wire, 2);
}

/** Decodes `mode` from a telemetry frame body; inverse of encodeModeField. */
export function decodeModeField(frame) {
  const wire = unpackField(frame, 'mode');
  if (wire < 0 || wire > 4) {
    throw new RangeError('telemetry.mode: wire value out of range: ' + wire);
  }
  return MODE_CODES[wire];
}

/** Human-readable rendering of `mode` for logs and audits. */
export function describeMode(record) {
  return 'mode=' + record.mode;
}

// ─────────────────────────────────────────────────────────────────────────
// Field 14/15 — `faults`: active fault latches.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `faults`: active fault latches. Encoded as a bitmask in the
 * canonical order below, zero-padded to width 4.
 */
export const FAULTS_FLAGS = Object.freeze([
  'lowBattery',
  'sensorFault',
  'clockDrift',
  'memPressure',
  'linkDegraded',
  'fanStall',
]);

/**
 * Collects every problem with `record.faults`; an empty list means
 * the value is valid for encoding.
 */
export function validateFaults(record) {
  const problems = [];
  const value = record.faults;
  if (!Array.isArray(value)) {
    problems.push('faults must be an array of flag names');
    return problems;
  }
  for (const flag of value) {
    if (!FAULTS_FLAGS.includes(flag)) {
      problems.push('faults: unknown flag ' + flag);
    }
  }
  if (new Set(value).size !== value.length) {
    problems.push('faults: duplicate flags');
  }
  return problems;
}

/** Throws unless `record.faults` is valid for encoding. */
export function assertFaults(record) {
  const problems = validateFaults(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.faults: ' + problems.join('; '));
  }
}

/** Encodes `faults` as a fixed-width field of the telemetry frame. */
export function encodeFaultsField(record) {
  assertFaults(record);
  let mask = 0;
  for (const flag of record.faults) {
    mask |= 1 << FAULTS_FLAGS.indexOf(flag);
  }
  return packField('faults', mask, 4);
}

/** Decodes `faults` from a telemetry frame body; inverse of encodeFaultsField. */
export function decodeFaultsField(frame) {
  const wire = unpackField(frame, 'faults');
  if (wire < 0 || wire > 63) {
    throw new RangeError('telemetry.faults: wire value out of range: ' + wire);
  }
  const active = [];
  for (let bit = 0; bit < FAULTS_FLAGS.length; bit += 1) {
    if ((wire & (1 << bit)) !== 0) {
      active.push(FAULTS_FLAGS[bit]);
    }
  }
  return active;
}

/** Human-readable rendering of `faults` for logs and audits. */
export function describeFaults(record) {
  return 'faults=[' + record.faults.join(',') + ']';
}

// ─────────────────────────────────────────────────────────────────────────
// Field 15/15 — `fw`: firmware version installed on the node.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wire spec for `fw`: firmware version installed on the node.
 * Valid range major 0..99, minor 0..999; field width 6.
 */
export const FW_SPEC = Object.freeze({
  name: 'fw',
  width: 6,
});

/**
 * Collects every problem with `record.fw`; an empty list means
 * the value is valid for encoding.
 */
export function validateFw(record) {
  const problems = [];
  const value = record.fw;
  if (typeof value !== 'object' || value === null) {
    problems.push('fw must be a { major, minor } object');
    return problems;
  }
  if (!Number.isInteger(value.major) || value.major < 0 || value.major > 99) {
    problems.push('fw.major must be an integer 0..99');
  }
  if (!Number.isInteger(value.minor) || value.minor < 0 || value.minor > 999) {
    problems.push('fw.minor must be an integer 0..999');
  }
  return problems;
}

/** Throws unless `record.fw` is valid for encoding. */
export function assertFw(record) {
  const problems = validateFw(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry.fw: ' + problems.join('; '));
  }
}

/** Encodes `fw` as a fixed-width field of the telemetry frame. */
export function encodeFwField(record) {
  assertFw(record);
  const wire = record.fw.major * 1000 + record.fw.minor;
  return packField('fw', wire, 6);
}

/** Decodes `fw` from a telemetry frame body; inverse of encodeFwField. */
export function decodeFwField(frame) {
  const wire = unpackField(frame, 'fw');
  if (wire < 0 || wire > 99999) {
    throw new RangeError('telemetry.fw: wire value out of range: ' + wire);
  }
  return { major: Math.floor(wire / 1000), minor: wire % 1000 };
}

/** Human-readable rendering of `fw` for logs and audits. */
export function describeFw(record) {
  return 'fw=v' + record.fw.major + '.' + record.fw.minor;
}

// ─────────────────────────────────────────────────────────────────────────
// Whole-telemetry frame composition
// ─────────────────────────────────────────────────────────────────────────

/** Canonical field order of the telemetry frame. */
export const TELEMETRY_FIELD_ORDER = Object.freeze([
  'seq',
  'uptime',
  'node',
  'temp',
  'pressure',
  'humidity',
  'battery',
  'rssi',
  'lat',
  'lon',
  'alt',
  'fanrpm',
  'mode',
  'faults',
  'fw',
]);

/** Frame prefix every telemetry frame starts with. */
export const TELEMETRY_PREFIX = 'TLM1|';

/** Reference record from the integration handbook (appendix B). */
export const EXAMPLE_TELEMETRY = Object.freeze({
  seq: 104882,
  uptime: 8642130,
  node: 217,
  temp: 21.5,
  pressure: 1013.2,
  humidity: 38,
  battery: 87,
  rssi: -71,
  lat: 47.6062,
  lon: -122.3321,
  alt: 56,
  fanrpm: 12400,
  mode: 'active',
  faults: Object.freeze(['clockDrift', 'linkDegraded']),
  fw: Object.freeze({ major: 4, minor: 312 }),
});

/** Collects every problem across all fields of a telemetry frame record. */
export function validateTelemetry(record) {
  return [
    ...validateSeq(record),
    ...validateUptime(record),
    ...validateNode(record),
    ...validateTemp(record),
    ...validatePressure(record),
    ...validateHumidity(record),
    ...validateBattery(record),
    ...validateRssi(record),
    ...validateLat(record),
    ...validateLon(record),
    ...validateAlt(record),
    ...validateFanrpm(record),
    ...validateMode(record),
    ...validateFaults(record),
    ...validateFw(record),
  ];
}

/** Encodes a full record as a telemetry frame, crc included. */
export function encodeTelemetry(record) {
  const problems = validateTelemetry(record);
  if (problems.length > 0) {
    throw new RangeError('telemetry: invalid record: ' + problems.join('; '));
  }
  const body =
    encodeSeqField(record) +
    encodeUptimeField(record) +
    encodeNodeField(record) +
    encodeTempField(record) +
    encodePressureField(record) +
    encodeHumidityField(record) +
    encodeBatteryField(record) +
    encodeRssiField(record) +
    encodeLatField(record) +
    encodeLonField(record) +
    encodeAltField(record) +
    encodeFanrpmField(record) +
    encodeModeField(record) +
    encodeFaultsField(record) +
    encodeFwField(record);
  const crc = checksumOf(body);
  return TELEMETRY_PREFIX + body + packField('crc', crc, 4);
}

/** Decodes a telemetry frame back into a record; verifies prefix and crc. */
export function decodeTelemetry(frame) {
  if (typeof frame !== 'string' || !frame.startsWith(TELEMETRY_PREFIX)) {
    throw new TypeError('telemetry: not a telemetry frame');
  }
  const crcAt = frame.lastIndexOf('crc=');
  if (crcAt < 0) {
    throw new RangeError('telemetry: missing crc field');
  }
  const body = frame.slice(TELEMETRY_PREFIX.length, crcAt);
  const expected = checksumOf(body);
  const actual = unpackField(frame, 'crc');
  if (actual !== expected) {
    throw new RangeError('telemetry: crc mismatch: frame carries ' + actual + ', body hashes to ' + expected);
  }
  return {
    seq: decodeSeqField(body),
    uptime: decodeUptimeField(body),
    node: decodeNodeField(body),
    temp: decodeTempField(body),
    pressure: decodePressureField(body),
    humidity: decodeHumidityField(body),
    battery: decodeBatteryField(body),
    rssi: decodeRssiField(body),
    lat: decodeLatField(body),
    lon: decodeLonField(body),
    alt: decodeAltField(body),
    fanrpm: decodeFanrpmField(body),
    mode: decodeModeField(body),
    faults: decodeFaultsField(body),
    fw: decodeFwField(body),
  };
}

/** One-line human-readable rendering of a full telemetry frame record. */
export function describeTelemetry(record) {
  return [
    describeSeq(record),
    describeUptime(record),
    describeNode(record),
    describeTemp(record),
    describePressure(record),
    describeHumidity(record),
    describeBattery(record),
    describeRssi(record),
    describeLat(record),
    describeLon(record),
    describeAlt(record),
    describeFanrpm(record),
    describeMode(record),
    describeFaults(record),
    describeFw(record),
  ].join(' ');
}
