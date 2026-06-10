import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACK_STYLE, packField } from './util.mjs';
import { decodeTelemetry, encodeTelemetry } from './telemetry.mjs';
import { decodeManifest, encodeManifest } from './manifest.mjs';
import { decodeBeacon, encodeBeacon } from './beacon.mjs';

const TELEMETRY_RECORD = {
  seq: 104882, uptime: 8642130, node: 217,
  temp: 21.5, pressure: 1013.2, humidity: 38,
  battery: 87, rssi: -71, lat: 47.6062,
  lon: -122.3321, alt: 56, fanrpm: 12400,
  mode: 'active', faults: ['clockDrift', 'linkDegraded'], fw: { major: 4, minor: 312 },
};
const TELEMETRY_FRAME =
  'TLM1|seq=104882;uptime=08642130;node=0217;temp=01215;pressure=010132;humidity=038;battery=087;rssi=129;lat=01376062;lon=00576679;alt=001056;fanrpm=12400;mode=01;faults=0020;fw=004312;crc=3023;';

const MANIFEST_RECORD = {
  rev: 4021, shipment: 73019442, pieces: 18,
  gross: 1240.5, net: 1180.2, volume: 14.75,
  declared: 18950000, insured: 22000000, origin: 5230,
  dest: 1170, seals: 4, customs: 940423,
  priority: 'express', docs: ['invoice', 'certOrigin', 'permit'], spec: { major: 2, minor: 41 },
};
const MANIFEST_FRAME =
  'MAN2|rev=004021;shipment=73019442;pieces=0018;gross=0012405;net=0011802;volume=001475;declared=018950000;insured=022000000;origin=5230;dest=1170;seals=004;customs=940423;priority=02;docs=021;spec=002041;crc=7962;';

const BEACON_RECORD = {
  beat: 55103201, station: 20771, channel: 14,
  power: -23, freq: 1575420, duty: 45,
  drift: -210, lock: 'locked', sats: 11,
  temp: 36.5, volt: 12.48, region: 'emea',
  errs: ['oscAging'], build: 204819, hours: 16204,
};
const BEACON_FRAME =
  'BCN1|beat=55103201;station=20771;channel=014;power=0077;freq=1575420;duty=045;drift=04790;lock=02;sats=011;temp=01365;volt=01248;region=01;errs=002;build=204819;hours=016204;crc=3234;';

test('packField takes a single options object', () => {
  assert.equal(PACK_STYLE, 'options');
  assert.equal(packField({ name: 'seq', value: 42, width: 6 }), 'seq=000042;');
  assert.equal(packField({ name: 'duty', value: 100, width: 3 }), 'duty=100;');
});

test('legacy positional packField calls are rejected', () => {
  assert.throws(() => packField('seq', 42, 6), TypeError);
});

test('telemetry frames encode byte-identically to the reference', () => {
  assert.equal(encodeTelemetry(TELEMETRY_RECORD), TELEMETRY_FRAME);
});

test('telemetry frames round-trip', () => {
  assert.deepEqual(decodeTelemetry(TELEMETRY_FRAME), TELEMETRY_RECORD);
});

test('manifest records encode byte-identically to the reference', () => {
  assert.equal(encodeManifest(MANIFEST_RECORD), MANIFEST_FRAME);
});

test('manifest records round-trip', () => {
  assert.deepEqual(decodeManifest(MANIFEST_FRAME), MANIFEST_RECORD);
});

test('beacons encode byte-identically to the reference', () => {
  assert.equal(encodeBeacon(BEACON_RECORD), BEACON_FRAME);
});

test('beacons round-trip', () => {
  assert.deepEqual(decodeBeacon(BEACON_FRAME), BEACON_RECORD);
});

test('corrupted frames are rejected by crc', () => {
  const tampered = TELEMETRY_FRAME.replace('battery=087;', 'battery=088;');
  assert.notEqual(tampered, TELEMETRY_FRAME);
  assert.throws(() => decodeTelemetry(tampered), /crc mismatch/);
});
