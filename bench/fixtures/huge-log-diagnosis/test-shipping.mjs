import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cheapestZone, labelFor, quoteShipping } from './shipping.mjs';

describe('shipping labels', () => {
  test('label batch 1', () => {
    const cases = [
      { grams: 219, zone: 'zone-1', text: 'letter/zone-1 $1.50' },
      { grams: 484, zone: 'zone-2', text: 'letter/zone-2 $2.10' },
      { grams: 749, zone: 'zone-3', text: 'parcel/zone-3 $11.40' },
      { grams: 1014, zone: 'zone-1', text: 'parcel/zone-1 $6.00' },
      { grams: 1279, zone: 'zone-2', text: 'parcel/zone-2 $8.40' },
      { grams: 2100, zone: 'zone-3', text: 'freight/zone-3 $45.60' },
      { grams: 6985, zone: 'zone-1', text: 'freight/zone-1 $24.00' },
      { grams: 11870, zone: 'zone-2', text: 'freight/zone-2 $33.60' },
      { grams: 22417, zone: 'zone-3', text: 'pallet/zone-3 $199.50' },
      { grams: 42002, zone: 'zone-1', text: 'pallet/zone-1 $105.00' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-01] case ${i + 1}/${cases.length}: grams=${c.grams} zone=${c.zone}`);
      const got = labelFor(c.grams, c.zone);
      console.log(`[shp-01]   got label=${got}`);
      console.log(`[shp-01]   want label=${c.text}`);
      assert.equal(got, c.text);
    }
  });

  test('label batch 2', () => {
    const cases = [
      { grams: 1226, zone: 'zone-2', text: 'parcel/zone-2 $8.40' },
      { grams: 1491, zone: 'zone-3', text: 'parcel/zone-3 $11.40' },
      { grams: 6008, zone: 'zone-1', text: 'freight/zone-1 $24.00' },
      { grams: 10893, zone: 'zone-2', text: 'freight/zone-2 $33.60' },
      { grams: 18500, zone: 'zone-3', text: 'freight/zone-3 $45.60' },
      { grams: 38085, zone: 'zone-1', text: 'pallet/zone-1 $105.00' },
      { grams: 166, zone: 'zone-2', text: 'letter/zone-2 $2.10' },
      { grams: 431, zone: 'zone-3', text: 'letter/zone-3 $2.85' },
      { grams: 696, zone: 'zone-1', text: 'parcel/zone-1 $6.00' },
      { grams: 961, zone: 'zone-2', text: 'parcel/zone-2 $8.40' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-02] case ${i + 1}/${cases.length}: grams=${c.grams} zone=${c.zone}`);
      const got = labelFor(c.grams, c.zone);
      console.log(`[shp-02]   got label=${got}`);
      console.log(`[shp-02]   want label=${c.text}`);
      assert.equal(got, c.text);
    }
  });

  test('label batch 3', () => {
    const cases = [
      { grams: 14801, zone: 'zone-3', text: 'freight/zone-3 $45.60' },
      { grams: 34168, zone: 'zone-1', text: 'pallet/zone-1 $105.00' },
      { grams: 113, zone: 'zone-2', text: 'letter/zone-2 $2.10' },
      { grams: 378, zone: 'zone-3', text: 'letter/zone-3 $2.85' },
      { grams: 643, zone: 'zone-1', text: 'parcel/zone-1 $6.00' },
      { grams: 908, zone: 'zone-2', text: 'parcel/zone-2 $8.40' },
      { grams: 1173, zone: 'zone-3', text: 'parcel/zone-3 $11.40' },
      { grams: 1438, zone: 'zone-1', text: 'parcel/zone-1 $6.00' },
      { grams: 5031, zone: 'zone-2', text: 'freight/zone-2 $33.60' },
      { grams: 9916, zone: 'zone-3', text: 'freight/zone-3 $45.60' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-03] case ${i + 1}/${cases.length}: grams=${c.grams} zone=${c.zone}`);
      const got = labelFor(c.grams, c.zone);
      console.log(`[shp-03]   got label=${got}`);
      console.log(`[shp-03]   want label=${c.text}`);
      assert.equal(got, c.text);
    }
  });

  test('label batch 4', () => {
    const cases = [
      { grams: 590, zone: 'zone-1', text: 'parcel/zone-1 $6.00' },
      { grams: 855, zone: 'zone-2', text: 'parcel/zone-2 $8.40' },
      { grams: 1120, zone: 'zone-3', text: 'parcel/zone-3 $11.40' },
      { grams: 1385, zone: 'zone-1', text: 'parcel/zone-1 $6.00' },
      { grams: 4054, zone: 'zone-2', text: 'freight/zone-2 $33.60' },
      { grams: 8939, zone: 'zone-3', text: 'freight/zone-3 $45.60' },
      { grams: 13824, zone: 'zone-1', text: 'freight/zone-1 $24.00' },
      { grams: 30251, zone: 'zone-2', text: 'pallet/zone-2 $147.00' },
      { grams: 60, zone: 'zone-3', text: 'letter/zone-3 $2.85' },
      { grams: 325, zone: 'zone-1', text: 'letter/zone-1 $1.50' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-04] case ${i + 1}/${cases.length}: grams=${c.grams} zone=${c.zone}`);
      const got = labelFor(c.grams, c.zone);
      console.log(`[shp-04]   got label=${got}`);
      console.log(`[shp-04]   want label=${c.text}`);
      assert.equal(got, c.text);
    }
  });

  test('label batch 5', () => {
    const cases = [
      { grams: 3077, zone: 'zone-2', text: 'freight/zone-2 $33.60' },
      { grams: 7962, zone: 'zone-3', text: 'freight/zone-3 $45.60' },
      { grams: 12847, zone: 'zone-1', text: 'freight/zone-1 $24.00' },
      { grams: 26334, zone: 'zone-2', text: 'pallet/zone-2 $147.00' },
      { grams: 45919, zone: 'zone-3', text: 'pallet/zone-3 $199.50' },
      { grams: 272, zone: 'zone-1', text: 'letter/zone-1 $1.50' },
      { grams: 537, zone: 'zone-2', text: 'parcel/zone-2 $8.40' },
      { grams: 802, zone: 'zone-3', text: 'parcel/zone-3 $11.40' },
      { grams: 1067, zone: 'zone-1', text: 'parcel/zone-1 $6.00' },
      { grams: 1332, zone: 'zone-2', text: 'parcel/zone-2 $8.40' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-05] case ${i + 1}/${cases.length}: grams=${c.grams} zone=${c.zone}`);
      const got = labelFor(c.grams, c.zone);
      console.log(`[shp-05]   got label=${got}`);
      console.log(`[shp-05]   want label=${c.text}`);
      assert.equal(got, c.text);
    }
  });

  test('label batch 6', () => {
    const cases = [
      { grams: 42002, zone: 'zone-3', text: 'pallet/zone-3 $199.50' },
      { grams: 219, zone: 'zone-1', text: 'letter/zone-1 $1.50' },
      { grams: 484, zone: 'zone-2', text: 'letter/zone-2 $2.10' },
      { grams: 749, zone: 'zone-3', text: 'parcel/zone-3 $11.40' },
      { grams: 1014, zone: 'zone-1', text: 'parcel/zone-1 $6.00' },
      { grams: 1279, zone: 'zone-2', text: 'parcel/zone-2 $8.40' },
      { grams: 2100, zone: 'zone-3', text: 'freight/zone-3 $45.60' },
      { grams: 6985, zone: 'zone-1', text: 'freight/zone-1 $24.00' },
      { grams: 11870, zone: 'zone-2', text: 'freight/zone-2 $33.60' },
      { grams: 22417, zone: 'zone-3', text: 'pallet/zone-3 $199.50' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-06] case ${i + 1}/${cases.length}: grams=${c.grams} zone=${c.zone}`);
      const got = labelFor(c.grams, c.zone);
      console.log(`[shp-06]   got label=${got}`);
      console.log(`[shp-06]   want label=${c.text}`);
      assert.equal(got, c.text);
    }
  });

});

describe('cheapest zone selection', () => {
  test('cheapest zone batch 1', () => {
    const cases = [
      { grams: 272, zones: ['zone-1', 'zone-2'], zone: 'zone-1' },
      { grams: 749, zones: ['zone-2', 'zone-3'], zone: 'zone-2' },
      { grams: 1226, zones: ['zone-1', 'zone-3'], zone: 'zone-1' },
      { grams: 5031, zones: ['zone-1', 'zone-2', 'zone-3'], zone: 'zone-1' },
      { grams: 13824, zones: ['zone-3', 'zone-1'], zone: 'zone-1' },
      { grams: 45919, zones: ['zone-2', 'zone-1'], zone: 'zone-1' },
      { grams: 484, zones: ['zone-1', 'zone-2'], zone: 'zone-1' },
      { grams: 961, zones: ['zone-2', 'zone-3'], zone: 'zone-2' },
      { grams: 1438, zones: ['zone-1', 'zone-3'], zone: 'zone-1' },
      { grams: 8939, zones: ['zone-1', 'zone-2', 'zone-3'], zone: 'zone-1' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-07] case ${i + 1}/${cases.length}: grams=${c.grams} zones=${c.zones.join("+")}`);
      const got = cheapestZone(c.grams, c.zones);
      console.log(`[shp-07]   got zone=${got}`);
      console.log(`[shp-07]   want zone=${c.zone}`);
      assert.equal(got, c.zone);
    }
  });

  test('cheapest zone batch 2', () => {
    const cases = [
      { grams: 1491, zones: ['zone-2', 'zone-3'], zone: 'zone-2' },
      { grams: 9916, zones: ['zone-1', 'zone-3'], zone: 'zone-1' },
      { grams: 30251, zones: ['zone-1', 'zone-2', 'zone-3'], zone: 'zone-1' },
      { grams: 272, zones: ['zone-3', 'zone-1'], zone: 'zone-1' },
      { grams: 749, zones: ['zone-2', 'zone-1'], zone: 'zone-1' },
      { grams: 1226, zones: ['zone-1', 'zone-2'], zone: 'zone-1' },
      { grams: 5031, zones: ['zone-2', 'zone-3'], zone: 'zone-2' },
      { grams: 13824, zones: ['zone-1', 'zone-3'], zone: 'zone-1' },
      { grams: 45919, zones: ['zone-1', 'zone-2', 'zone-3'], zone: 'zone-1' },
      { grams: 484, zones: ['zone-3', 'zone-1'], zone: 'zone-1' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-08] case ${i + 1}/${cases.length}: grams=${c.grams} zones=${c.zones.join("+")}`);
      const got = cheapestZone(c.grams, c.zones);
      console.log(`[shp-08]   got zone=${got}`);
      console.log(`[shp-08]   want zone=${c.zone}`);
      assert.equal(got, c.zone);
    }
  });

  test('cheapest zone batch 3', () => {
    const cases = [
      { grams: 60, zones: ['zone-1', 'zone-3'], zone: 'zone-1' },
      { grams: 537, zones: ['zone-1', 'zone-2', 'zone-3'], zone: 'zone-1' },
      { grams: 1014, zones: ['zone-3', 'zone-1'], zone: 'zone-1' },
      { grams: 1491, zones: ['zone-2', 'zone-1'], zone: 'zone-1' },
      { grams: 9916, zones: ['zone-1', 'zone-2'], zone: 'zone-1' },
      { grams: 30251, zones: ['zone-2', 'zone-3'], zone: 'zone-2' },
      { grams: 272, zones: ['zone-1', 'zone-3'], zone: 'zone-1' },
      { grams: 749, zones: ['zone-1', 'zone-2', 'zone-3'], zone: 'zone-1' },
      { grams: 1226, zones: ['zone-3', 'zone-1'], zone: 'zone-1' },
      { grams: 5031, zones: ['zone-2', 'zone-1'], zone: 'zone-1' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-09] case ${i + 1}/${cases.length}: grams=${c.grams} zones=${c.zones.join("+")}`);
      const got = cheapestZone(c.grams, c.zones);
      console.log(`[shp-09]   got zone=${got}`);
      console.log(`[shp-09]   want zone=${c.zone}`);
      assert.equal(got, c.zone);
    }
  });

  test('cheapest zone batch 4', () => {
    const cases = [
      { grams: 1279, zones: ['zone-1', 'zone-2', 'zone-3'], zone: 'zone-1' },
      { grams: 6008, zones: ['zone-3', 'zone-1'], zone: 'zone-1' },
      { grams: 14801, zones: ['zone-2', 'zone-1'], zone: 'zone-1' },
      { grams: 60, zones: ['zone-1', 'zone-2'], zone: 'zone-1' },
      { grams: 537, zones: ['zone-2', 'zone-3'], zone: 'zone-2' },
      { grams: 1014, zones: ['zone-1', 'zone-3'], zone: 'zone-1' },
      { grams: 1491, zones: ['zone-1', 'zone-2', 'zone-3'], zone: 'zone-1' },
      { grams: 9916, zones: ['zone-3', 'zone-1'], zone: 'zone-1' },
      { grams: 30251, zones: ['zone-2', 'zone-1'], zone: 'zone-1' },
      { grams: 272, zones: ['zone-1', 'zone-2'], zone: 'zone-1' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-10] case ${i + 1}/${cases.length}: grams=${c.grams} zones=${c.zones.join("+")}`);
      const got = cheapestZone(c.grams, c.zones);
      console.log(`[shp-10]   got zone=${got}`);
      console.log(`[shp-10]   want zone=${c.zone}`);
      assert.equal(got, c.zone);
    }
  });

  test('cheapest zone batch 5', () => {
    const cases = [
      { grams: 34168, zones: ['zone-3', 'zone-1'], zone: 'zone-1' },
      { grams: 325, zones: ['zone-2', 'zone-1'], zone: 'zone-1' },
      { grams: 802, zones: ['zone-1', 'zone-2'], zone: 'zone-1' },
      { grams: 1279, zones: ['zone-2', 'zone-3'], zone: 'zone-2' },
      { grams: 6008, zones: ['zone-1', 'zone-3'], zone: 'zone-1' },
      { grams: 14801, zones: ['zone-1', 'zone-2', 'zone-3'], zone: 'zone-1' },
      { grams: 60, zones: ['zone-3', 'zone-1'], zone: 'zone-1' },
      { grams: 537, zones: ['zone-2', 'zone-1'], zone: 'zone-1' },
      { grams: 1014, zones: ['zone-1', 'zone-2'], zone: 'zone-1' },
      { grams: 1491, zones: ['zone-2', 'zone-3'], zone: 'zone-2' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-11] case ${i + 1}/${cases.length}: grams=${c.grams} zones=${c.zones.join("+")}`);
      const got = cheapestZone(c.grams, c.zones);
      console.log(`[shp-11]   got zone=${got}`);
      console.log(`[shp-11]   want zone=${c.zone}`);
      assert.equal(got, c.zone);
    }
  });

  test('cheapest zone batch 6', () => {
    const cases = [
      { grams: 1067, zones: ['zone-2', 'zone-1'], zone: 'zone-1' },
      { grams: 2100, zones: ['zone-1', 'zone-2'], zone: 'zone-1' },
      { grams: 10893, zones: ['zone-2', 'zone-3'], zone: 'zone-2' },
      { grams: 34168, zones: ['zone-1', 'zone-3'], zone: 'zone-1' },
      { grams: 325, zones: ['zone-1', 'zone-2', 'zone-3'], zone: 'zone-1' },
      { grams: 802, zones: ['zone-3', 'zone-1'], zone: 'zone-1' },
      { grams: 1279, zones: ['zone-2', 'zone-1'], zone: 'zone-1' },
      { grams: 6008, zones: ['zone-1', 'zone-2'], zone: 'zone-1' },
      { grams: 14801, zones: ['zone-2', 'zone-3'], zone: 'zone-2' },
      { grams: 60, zones: ['zone-1', 'zone-3'], zone: 'zone-1' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-12] case ${i + 1}/${cases.length}: grams=${c.grams} zones=${c.zones.join("+")}`);
      const got = cheapestZone(c.grams, c.zones);
      console.log(`[shp-12]   got zone=${got}`);
      console.log(`[shp-12]   want zone=${c.zone}`);
      assert.equal(got, c.zone);
    }
  });

});

describe('zone quotes', () => {
  test('quote batch 1', () => {
    const cases = [
      { grams: 325, zone: 'zone-1', tier: 'letter', cents: 150 },
      { grams: 908, zone: 'zone-2', tier: 'parcel', cents: 840 },
      { grams: 1491, zone: 'zone-3', tier: 'parcel', cents: 1140 },
      { grams: 11870, zone: 'zone-1', tier: 'freight', cents: 2400 },
      { grams: 45919, zone: 'zone-2', tier: 'pallet', cents: 14700 },
      { grams: 590, zone: 'zone-3', tier: 'parcel', cents: 1140 },
      { grams: 1173, zone: 'zone-1', tier: 'parcel', cents: 600 },
      { grams: 6008, zone: 'zone-2', tier: 'freight', cents: 3360 },
      { grams: 22417, zone: 'zone-3', tier: 'pallet', cents: 19950 },
      { grams: 272, zone: 'zone-1', tier: 'letter', cents: 150 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-13] case ${i + 1}/${cases.length}: grams=${c.grams} zone=${c.zone}`);
      const got = quoteShipping(c.grams, c.zone);
      console.log(`[shp-13]   got tier=${got.tier} cents=${got.cents}`);
      console.log(`[shp-13]   want tier=${c.tier} cents=${c.cents}`);
      assert.equal(got.tier, c.tier);
      assert.equal(got.cents, c.cents);
    }
  });

  test('quote batch 2', () => {
    const cases = [
      { grams: 7962, zone: 'zone-3', tier: 'freight', cents: 4560 },
      { grams: 30251, zone: 'zone-1', tier: 'pallet', cents: 10500 },
      { grams: 378, zone: 'zone-2', tier: 'letter', cents: 210 },
      { grams: 961, zone: 'zone-3', tier: 'parcel', cents: 1140 },
      { grams: 2100, zone: 'zone-1', tier: 'freight', cents: 2400 },
      { grams: 12847, zone: 'zone-2', tier: 'freight', cents: 3360 },
      { grams: 60, zone: 'zone-3', tier: 'letter', cents: 285 },
      { grams: 643, zone: 'zone-1', tier: 'parcel', cents: 600 },
      { grams: 1226, zone: 'zone-2', tier: 'parcel', cents: 840 },
      { grams: 6985, zone: 'zone-3', tier: 'freight', cents: 4560 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-14] case ${i + 1}/${cases.length}: grams=${c.grams} zone=${c.zone}`);
      const got = quoteShipping(c.grams, c.zone);
      console.log(`[shp-14]   got tier=${got.tier} cents=${got.cents}`);
      console.log(`[shp-14]   want tier=${c.tier} cents=${c.cents}`);
      assert.equal(got.tier, c.tier);
      assert.equal(got.cents, c.cents);
    }
  });

  test('quote batch 3', () => {
    const cases = [
      { grams: 749, zone: 'zone-2', tier: 'parcel', cents: 840 },
      { grams: 1332, zone: 'zone-3', tier: 'parcel', cents: 1140 },
      { grams: 8939, zone: 'zone-1', tier: 'freight', cents: 2400 },
      { grams: 34168, zone: 'zone-2', tier: 'pallet', cents: 14700 },
      { grams: 431, zone: 'zone-3', tier: 'letter', cents: 285 },
      { grams: 1014, zone: 'zone-1', tier: 'parcel', cents: 600 },
      { grams: 3077, zone: 'zone-2', tier: 'freight', cents: 3360 },
      { grams: 13824, zone: 'zone-3', tier: 'freight', cents: 4560 },
      { grams: 113, zone: 'zone-1', tier: 'letter', cents: 150 },
      { grams: 696, zone: 'zone-2', tier: 'parcel', cents: 840 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-15] case ${i + 1}/${cases.length}: grams=${c.grams} zone=${c.zone}`);
      const got = quoteShipping(c.grams, c.zone);
      console.log(`[shp-15]   got tier=${got.tier} cents=${got.cents}`);
      console.log(`[shp-15]   want tier=${c.tier} cents=${c.cents}`);
      assert.equal(got.tier, c.tier);
      assert.equal(got.cents, c.cents);
    }
  });

  test('quote batch 4', () => {
    const cases = [
      { grams: 18500, zone: 'zone-1', tier: 'freight', cents: 2400 },
      { grams: 219, zone: 'zone-2', tier: 'letter', cents: 210 },
      { grams: 802, zone: 'zone-3', tier: 'parcel', cents: 1140 },
      { grams: 1385, zone: 'zone-1', tier: 'parcel', cents: 600 },
      { grams: 9916, zone: 'zone-2', tier: 'freight', cents: 3360 },
      { grams: 38085, zone: 'zone-3', tier: 'pallet', cents: 19950 },
      { grams: 484, zone: 'zone-1', tier: 'letter', cents: 150 },
      { grams: 1067, zone: 'zone-2', tier: 'parcel', cents: 840 },
      { grams: 4054, zone: 'zone-3', tier: 'freight', cents: 4560 },
      { grams: 14801, zone: 'zone-1', tier: 'freight', cents: 2400 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-16] case ${i + 1}/${cases.length}: grams=${c.grams} zone=${c.zone}`);
      const got = quoteShipping(c.grams, c.zone);
      console.log(`[shp-16]   got tier=${got.tier} cents=${got.cents}`);
      console.log(`[shp-16]   want tier=${c.tier} cents=${c.cents}`);
      assert.equal(got.tier, c.tier);
      assert.equal(got.cents, c.cents);
    }
  });

  test('letter rate holds through the 500 g handbook ceiling', () => {
    const cases = [
      { grams: 468, zone: 'zone-1', tier: 'letter', cents: 150 },
      { grams: 472, zone: 'zone-1', tier: 'letter', cents: 150 },
      { grams: 476, zone: 'zone-1', tier: 'letter', cents: 150 },
      { grams: 480, zone: 'zone-1', tier: 'letter', cents: 150 },
      { grams: 484, zone: 'zone-1', tier: 'letter', cents: 150 },
      { grams: 488, zone: 'zone-1', tier: 'letter', cents: 150 },
      { grams: 500, zone: 'zone-1', tier: 'letter', cents: 150 },
      { grams: 492, zone: 'zone-1', tier: 'letter', cents: 150 },
      { grams: 496, zone: 'zone-1', tier: 'letter', cents: 150 },
      { grams: 499, zone: 'zone-1', tier: 'letter', cents: 150 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-17] case ${i + 1}/${cases.length}: grams=${c.grams} zone=${c.zone}`);
      const got = quoteShipping(c.grams, c.zone);
      console.log(`[shp-17]   got tier=${got.tier} cents=${got.cents}`);
      console.log(`[shp-17]   want tier=${c.tier} cents=${c.cents}`);
      assert.equal(got.tier, c.tier);
      assert.equal(got.cents, c.cents);
    }
  });

  test('quote batch 6', () => {
    const cases = [
      { grams: 60, zone: 'zone-2', tier: 'letter', cents: 210 },
      { grams: 643, zone: 'zone-3', tier: 'parcel', cents: 1140 },
      { grams: 1226, zone: 'zone-1', tier: 'parcel', cents: 600 },
      { grams: 6985, zone: 'zone-2', tier: 'freight', cents: 3360 },
      { grams: 26334, zone: 'zone-3', tier: 'pallet', cents: 19950 },
      { grams: 325, zone: 'zone-1', tier: 'letter', cents: 150 },
      { grams: 908, zone: 'zone-2', tier: 'parcel', cents: 840 },
      { grams: 1491, zone: 'zone-3', tier: 'parcel', cents: 1140 },
      { grams: 11870, zone: 'zone-1', tier: 'freight', cents: 2400 },
      { grams: 45919, zone: 'zone-2', tier: 'pallet', cents: 14700 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-18] case ${i + 1}/${cases.length}: grams=${c.grams} zone=${c.zone}`);
      const got = quoteShipping(c.grams, c.zone);
      console.log(`[shp-18]   got tier=${got.tier} cents=${got.cents}`);
      console.log(`[shp-18]   want tier=${c.tier} cents=${c.cents}`);
      assert.equal(got.tier, c.tier);
      assert.equal(got.cents, c.cents);
    }
  });

});

describe('tier classification via quotes', () => {
  test('classification batch 1', () => {
    const cases = [
      { grams: 378, tier: 'letter' },
      { grams: 1067, tier: 'parcel' },
      { grams: 6008, tier: 'freight' },
      { grams: 30251, tier: 'pallet' },
      { grams: 484, tier: 'letter' },
      { grams: 1173, tier: 'parcel' },
      { grams: 7962, tier: 'freight' },
      { grams: 38085, tier: 'pallet' },
      { grams: 590, tier: 'parcel' },
      { grams: 1279, tier: 'parcel' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-19] case ${i + 1}/${cases.length}: grams=${c.grams}`);
      const got = quoteShipping(c.grams, 'zone-2').tier;
      console.log(`[shp-19]   got tier=${got}`);
      console.log(`[shp-19]   want tier=${c.tier}`);
      assert.equal(got, c.tier);
    }
  });

  test('classification batch 2', () => {
    const cases = [
      { grams: 10893, tier: 'freight' },
      { grams: 60, tier: 'letter' },
      { grams: 749, tier: 'parcel' },
      { grams: 1438, tier: 'parcel' },
      { grams: 12847, tier: 'freight' },
      { grams: 166, tier: 'letter' },
      { grams: 855, tier: 'parcel' },
      { grams: 2100, tier: 'freight' },
      { grams: 14801, tier: 'freight' },
      { grams: 272, tier: 'letter' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-20] case ${i + 1}/${cases.length}: grams=${c.grams}`);
      const got = quoteShipping(c.grams, 'zone-2').tier;
      console.log(`[shp-20]   got tier=${got}`);
      console.log(`[shp-20]   want tier=${c.tier}`);
      assert.equal(got, c.tier);
    }
  });

  test('classification batch 3', () => {
    const cases = [
      { grams: 1014, tier: 'parcel' },
      { grams: 5031, tier: 'freight' },
      { grams: 26334, tier: 'pallet' },
      { grams: 431, tier: 'letter' },
      { grams: 1120, tier: 'parcel' },
      { grams: 6985, tier: 'freight' },
      { grams: 34168, tier: 'pallet' },
      { grams: 537, tier: 'parcel' },
      { grams: 1226, tier: 'parcel' },
      { grams: 8939, tier: 'freight' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-21] case ${i + 1}/${cases.length}: grams=${c.grams}`);
      const got = quoteShipping(c.grams, 'zone-2').tier;
      console.log(`[shp-21]   got tier=${got}`);
      console.log(`[shp-21]   want tier=${c.tier}`);
      assert.equal(got, c.tier);
    }
  });

  test('classification batch 4', () => {
    const cases = [
      { grams: 45919, tier: 'pallet' },
      { grams: 696, tier: 'parcel' },
      { grams: 1385, tier: 'parcel' },
      { grams: 11870, tier: 'freight' },
      { grams: 113, tier: 'letter' },
      { grams: 802, tier: 'parcel' },
      { grams: 1491, tier: 'parcel' },
      { grams: 13824, tier: 'freight' },
      { grams: 219, tier: 'letter' },
      { grams: 908, tier: 'parcel' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-22] case ${i + 1}/${cases.length}: grams=${c.grams}`);
      const got = quoteShipping(c.grams, 'zone-2').tier;
      console.log(`[shp-22]   got tier=${got}`);
      console.log(`[shp-22]   want tier=${c.tier}`);
      assert.equal(got, c.tier);
    }
  });

  test('classification batch 5', () => {
    const cases = [
      { grams: 4054, tier: 'freight' },
      { grams: 22417, tier: 'pallet' },
      { grams: 378, tier: 'letter' },
      { grams: 1067, tier: 'parcel' },
      { grams: 6008, tier: 'freight' },
      { grams: 30251, tier: 'pallet' },
      { grams: 484, tier: 'letter' },
      { grams: 1173, tier: 'parcel' },
      { grams: 7962, tier: 'freight' },
      { grams: 38085, tier: 'pallet' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-23] case ${i + 1}/${cases.length}: grams=${c.grams}`);
      const got = quoteShipping(c.grams, 'zone-2').tier;
      console.log(`[shp-23]   got tier=${got}`);
      console.log(`[shp-23]   want tier=${c.tier}`);
      assert.equal(got, c.tier);
    }
  });

  test('classification batch 6', () => {
    const cases = [
      { grams: 643, tier: 'parcel' },
      { grams: 1332, tier: 'parcel' },
      { grams: 10893, tier: 'freight' },
      { grams: 60, tier: 'letter' },
      { grams: 749, tier: 'parcel' },
      { grams: 1438, tier: 'parcel' },
      { grams: 12847, tier: 'freight' },
      { grams: 166, tier: 'letter' },
      { grams: 855, tier: 'parcel' },
      { grams: 2100, tier: 'freight' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[shp-24] case ${i + 1}/${cases.length}: grams=${c.grams}`);
      const got = quoteShipping(c.grams, 'zone-2').tier;
      console.log(`[shp-24]   got tier=${got}`);
      console.log(`[shp-24]   want tier=${c.tier}`);
      assert.equal(got, c.tier);
    }
  });

});
