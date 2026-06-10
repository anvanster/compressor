import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { discountedCents, invoiceTotal, lineTotal, surchargeFor } from './pricing.mjs';

describe('discounts', () => {
  test('discount batch 1', () => {
    const cases = [
      { cents: 999, percent: 0, out: 999 },
      { cents: 1462, percent: 7, out: 1360 },
      { cents: 1925, percent: 14, out: 1656 },
      { cents: 2388, percent: 21, out: 1887 },
      { cents: 2851, percent: 28, out: 2053 },
      { cents: 3314, percent: 35, out: 2155 },
      { cents: 3777, percent: 42, out: 2191 },
      { cents: 4240, percent: 49, out: 2163 },
      { cents: 4703, percent: 56, out: 2070 },
      { cents: 5166, percent: 63, out: 1912 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-01] case ${i + 1}/${cases.length}: cents=${c.cents} percent=${c.percent}`);
      const got = discountedCents(c.cents, c.percent);
      console.log(`[prc-01]   got cents=${got}`);
      console.log(`[prc-01]   want cents=${c.out}`);
      assert.equal(got, c.out);
    }
  });

  test('discount batch 2', () => {
    const cases = [
      { cents: 5629, percent: 10, out: 5067 },
      { cents: 6092, percent: 17, out: 5057 },
      { cents: 6555, percent: 24, out: 4982 },
      { cents: 7018, percent: 31, out: 4843 },
      { cents: 7481, percent: 38, out: 4639 },
      { cents: 7944, percent: 45, out: 4370 },
      { cents: 8407, percent: 52, out: 4036 },
      { cents: 8870, percent: 59, out: 3637 },
      { cents: 9333, percent: 66, out: 3174 },
      { cents: 9796, percent: 73, out: 2645 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-02] case ${i + 1}/${cases.length}: cents=${c.cents} percent=${c.percent}`);
      const got = discountedCents(c.cents, c.percent);
      console.log(`[prc-02]   got cents=${got}`);
      console.log(`[prc-02]   want cents=${c.out}`);
      assert.equal(got, c.out);
    }
  });

  test('discount batch 3', () => {
    const cases = [
      { cents: 10259, percent: 20, out: 8208 },
      { cents: 10722, percent: 27, out: 7828 },
      { cents: 11185, percent: 34, out: 7383 },
      { cents: 11648, percent: 41, out: 6873 },
      { cents: 12111, percent: 48, out: 6298 },
      { cents: 12574, percent: 55, out: 5659 },
      { cents: 13037, percent: 62, out: 4955 },
      { cents: 13500, percent: 69, out: 4185 },
      { cents: 13963, percent: 76, out: 3352 },
      { cents: 14426, percent: 83, out: 2453 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-03] case ${i + 1}/${cases.length}: cents=${c.cents} percent=${c.percent}`);
      const got = discountedCents(c.cents, c.percent);
      console.log(`[prc-03]   got cents=${got}`);
      console.log(`[prc-03]   want cents=${c.out}`);
      assert.equal(got, c.out);
    }
  });

  test('discount batch 4', () => {
    const cases = [
      { cents: 14889, percent: 30, out: 10423 },
      { cents: 15352, percent: 37, out: 9672 },
      { cents: 15815, percent: 44, out: 8857 },
      { cents: 16278, percent: 51, out: 7977 },
      { cents: 16741, percent: 58, out: 7032 },
      { cents: 17204, percent: 65, out: 6022 },
      { cents: 17667, percent: 72, out: 4947 },
      { cents: 18130, percent: 79, out: 3808 },
      { cents: 18593, percent: 86, out: 2604 },
      { cents: 19056, percent: 2, out: 18675 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-04] case ${i + 1}/${cases.length}: cents=${c.cents} percent=${c.percent}`);
      const got = discountedCents(c.cents, c.percent);
      console.log(`[prc-04]   got cents=${got}`);
      console.log(`[prc-04]   want cents=${c.out}`);
      assert.equal(got, c.out);
    }
  });

  test('discount batch 5', () => {
    const cases = [
      { cents: 19519, percent: 40, out: 11712 },
      { cents: 19982, percent: 47, out: 10591 },
      { cents: 20445, percent: 54, out: 9405 },
      { cents: 20908, percent: 61, out: 8155 },
      { cents: 21371, percent: 68, out: 6839 },
      { cents: 21834, percent: 75, out: 5459 },
      { cents: 22297, percent: 82, out: 4014 },
      { cents: 22760, percent: 89, out: 2504 },
      { cents: 23223, percent: 5, out: 22062 },
      { cents: 23686, percent: 12, out: 20844 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-05] case ${i + 1}/${cases.length}: cents=${c.cents} percent=${c.percent}`);
      const got = discountedCents(c.cents, c.percent);
      console.log(`[prc-05]   got cents=${got}`);
      console.log(`[prc-05]   want cents=${c.out}`);
      assert.equal(got, c.out);
    }
  });

  test('discount batch 6', () => {
    const cases = [
      { cents: 24149, percent: 50, out: 12075 },
      { cents: 24612, percent: 57, out: 10584 },
      { cents: 25075, percent: 64, out: 9027 },
      { cents: 25538, percent: 71, out: 7407 },
      { cents: 26001, percent: 78, out: 5721 },
      { cents: 26464, percent: 85, out: 3970 },
      { cents: 26927, percent: 1, out: 26658 },
      { cents: 27390, percent: 8, out: 25199 },
      { cents: 27853, percent: 15, out: 23676 },
      { cents: 28316, percent: 22, out: 22087 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-06] case ${i + 1}/${cases.length}: cents=${c.cents} percent=${c.percent}`);
      const got = discountedCents(c.cents, c.percent);
      console.log(`[prc-06]   got cents=${got}`);
      console.log(`[prc-06]   want cents=${c.out}`);
      assert.equal(got, c.out);
    }
  });

});

describe('line totals', () => {
  test('line total batch 1', () => {
    const cases = [
      { unitCents: 205, qty: 1, cents: 205 },
      { unitCents: 594, qty: 2, cents: 1188 },
      { unitCents: 983, qty: 3, cents: 2949 },
      { unitCents: 1372, qty: 4, cents: 5488 },
      { unitCents: 1761, qty: 5, cents: 8805 },
      { unitCents: 2150, qty: 1, cents: 2150 },
      { unitCents: 2539, qty: 2, cents: 5078 },
      { unitCents: 2928, qty: 3, cents: 8784 },
      { unitCents: 3317, qty: 4, cents: 13268 },
      { unitCents: 3706, qty: 5, cents: 18530 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-07] case ${i + 1}/${cases.length}: unit=${c.unitCents} qty=${c.qty}`);
      const got = lineTotal(c.unitCents, c.qty);
      console.log(`[prc-07]   got cents=${got}`);
      console.log(`[prc-07]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('line total batch 2', () => {
    const cases = [
      { unitCents: 4095, qty: 2, cents: 8190 },
      { unitCents: 4484, qty: 3, cents: 13452 },
      { unitCents: 4873, qty: 4, cents: 19492 },
      { unitCents: 5262, qty: 5, cents: 26310 },
      { unitCents: 5651, qty: 1, cents: 5651 },
      { unitCents: 6040, qty: 2, cents: 12080 },
      { unitCents: 6429, qty: 3, cents: 19287 },
      { unitCents: 6818, qty: 4, cents: 27272 },
      { unitCents: 7207, qty: 5, cents: 36035 },
      { unitCents: 7596, qty: 1, cents: 7596 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-08] case ${i + 1}/${cases.length}: unit=${c.unitCents} qty=${c.qty}`);
      const got = lineTotal(c.unitCents, c.qty);
      console.log(`[prc-08]   got cents=${got}`);
      console.log(`[prc-08]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('line total batch 3', () => {
    const cases = [
      { unitCents: 7985, qty: 3, cents: 23955 },
      { unitCents: 8374, qty: 4, cents: 33496 },
      { unitCents: 8763, qty: 5, cents: 43815 },
      { unitCents: 9152, qty: 1, cents: 9152 },
      { unitCents: 9541, qty: 2, cents: 19082 },
      { unitCents: 9930, qty: 3, cents: 29790 },
      { unitCents: 10319, qty: 4, cents: 41276 },
      { unitCents: 10708, qty: 5, cents: 53540 },
      { unitCents: 11097, qty: 1, cents: 11097 },
      { unitCents: 11486, qty: 2, cents: 22972 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-09] case ${i + 1}/${cases.length}: unit=${c.unitCents} qty=${c.qty}`);
      const got = lineTotal(c.unitCents, c.qty);
      console.log(`[prc-09]   got cents=${got}`);
      console.log(`[prc-09]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('line total batch 4', () => {
    const cases = [
      { unitCents: 11875, qty: 4, cents: 47500 },
      { unitCents: 12264, qty: 5, cents: 61320 },
      { unitCents: 12653, qty: 1, cents: 12653 },
      { unitCents: 13042, qty: 2, cents: 26084 },
      { unitCents: 13431, qty: 3, cents: 40293 },
      { unitCents: 13820, qty: 4, cents: 55280 },
      { unitCents: 14209, qty: 5, cents: 71045 },
      { unitCents: 14598, qty: 1, cents: 14598 },
      { unitCents: 14987, qty: 2, cents: 29974 },
      { unitCents: 15376, qty: 3, cents: 46128 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-10] case ${i + 1}/${cases.length}: unit=${c.unitCents} qty=${c.qty}`);
      const got = lineTotal(c.unitCents, c.qty);
      console.log(`[prc-10]   got cents=${got}`);
      console.log(`[prc-10]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('line total batch 5', () => {
    const cases = [
      { unitCents: 15765, qty: 5, cents: 78825 },
      { unitCents: 16154, qty: 1, cents: 16154 },
      { unitCents: 16543, qty: 2, cents: 33086 },
      { unitCents: 16932, qty: 3, cents: 50796 },
      { unitCents: 17321, qty: 4, cents: 69284 },
      { unitCents: 17710, qty: 5, cents: 88550 },
      { unitCents: 18099, qty: 1, cents: 18099 },
      { unitCents: 18488, qty: 2, cents: 36976 },
      { unitCents: 18877, qty: 3, cents: 56631 },
      { unitCents: 19266, qty: 4, cents: 77064 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-11] case ${i + 1}/${cases.length}: unit=${c.unitCents} qty=${c.qty}`);
      const got = lineTotal(c.unitCents, c.qty);
      console.log(`[prc-11]   got cents=${got}`);
      console.log(`[prc-11]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('line total batch 6', () => {
    const cases = [
      { unitCents: 19655, qty: 1, cents: 19655 },
      { unitCents: 20044, qty: 2, cents: 40088 },
      { unitCents: 20433, qty: 3, cents: 61299 },
      { unitCents: 20822, qty: 4, cents: 83288 },
      { unitCents: 21211, qty: 5, cents: 106055 },
      { unitCents: 21600, qty: 1, cents: 21600 },
      { unitCents: 21989, qty: 2, cents: 43978 },
      { unitCents: 22378, qty: 3, cents: 67134 },
      { unitCents: 22767, qty: 4, cents: 91068 },
      { unitCents: 23156, qty: 5, cents: 115780 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-12] case ${i + 1}/${cases.length}: unit=${c.unitCents} qty=${c.qty}`);
      const got = lineTotal(c.unitCents, c.qty);
      console.log(`[prc-12]   got cents=${got}`);
      console.log(`[prc-12]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

});

describe('invoice totals include the tier surcharge', () => {
  test('invoice batch 1', () => {
    const cases = [
      { items: [310, 1240, 95], grams: 113, total: 1645 },
      { items: [367, 1240, 126], grams: 272, total: 1733 },
      { items: [424, 1240, 157], grams: 431, total: 1821 },
      { items: [481, 1240, 188], grams: 590, total: 2029 },
      { items: [538, 1240, 219], grams: 749, total: 2117 },
      { items: [595, 1240, 250], grams: 908, total: 2205 },
      { items: [652, 1240, 281], grams: 1067, total: 2293 },
      { items: [709, 1240, 312], grams: 1226, total: 2381 },
      { items: [766, 1240, 343], grams: 1385, total: 2469 },
      { items: [823, 1240, 374], grams: 2100, total: 2917 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-13] case ${i + 1}/${cases.length}: items=${c.items.length} grams=${c.grams}`);
      const got = invoiceTotal(c.items, c.grams);
      console.log(`[prc-13]   got total=${got}`);
      console.log(`[prc-13]   want total=${c.total}`);
      assert.equal(got, c.total);
    }
  });

  test('invoice batch 2', () => {
    const cases = [
      { items: [310, 1323, 126], grams: 696, total: 1879 },
      { items: [367, 1323, 157], grams: 855, total: 1967 },
      { items: [424, 1323, 188], grams: 1014, total: 2055 },
      { items: [481, 1323, 219], grams: 1173, total: 2143 },
      { items: [538, 1323, 250], grams: 1332, total: 2231 },
      { items: [595, 1323, 281], grams: 1491, total: 2319 },
      { items: [652, 1323, 312], grams: 4054, total: 2767 },
      { items: [709, 1323, 343], grams: 6985, total: 2855 },
      { items: [766, 1323, 374], grams: 9916, total: 2943 },
      { items: [823, 1323, 405], grams: 12847, total: 3031 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-14] case ${i + 1}/${cases.length}: items=${c.items.length} grams=${c.grams}`);
      const got = invoiceTotal(c.items, c.grams);
      console.log(`[prc-14]   got total=${got}`);
      console.log(`[prc-14]   want total=${c.total}`);
      assert.equal(got, c.total);
    }
  });

  test('invoice batch 3', () => {
    const cases = [
      { items: [310, 1406, 157], grams: 1279, total: 1993 },
      { items: [367, 1406, 188], grams: 1438, total: 2081 },
      { items: [424, 1406, 219], grams: 3077, total: 2529 },
      { items: [481, 1406, 250], grams: 6008, total: 2617 },
      { items: [538, 1406, 281], grams: 8939, total: 2705 },
      { items: [595, 1406, 312], grams: 11870, total: 2793 },
      { items: [652, 1406, 343], grams: 14801, total: 2881 },
      { items: [709, 1406, 374], grams: 26334, total: 3989 },
      { items: [766, 1406, 405], grams: 38085, total: 4077 },
      { items: [823, 1406, 436], grams: 60, total: 2665 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-15] case ${i + 1}/${cases.length}: items=${c.items.length} grams=${c.grams}`);
      const got = invoiceTotal(c.items, c.grams);
      console.log(`[prc-15]   got total=${got}`);
      console.log(`[prc-15]   want total=${c.total}`);
      assert.equal(got, c.total);
    }
  });

  test('invoice batch 4', () => {
    const cases = [
      { items: [310, 1489, 188], grams: 7962, total: 2467 },
      { items: [367, 1489, 219], grams: 10893, total: 2555 },
      { items: [424, 1489, 250], grams: 13824, total: 2643 },
      { items: [481, 1489, 281], grams: 22417, total: 3751 },
      { items: [538, 1489, 312], grams: 34168, total: 3839 },
      { items: [595, 1489, 343], grams: 45919, total: 3927 },
      { items: [652, 1489, 374], grams: 166, total: 2515 },
      { items: [709, 1489, 405], grams: 325, total: 2603 },
      { items: [766, 1489, 436], grams: 484, total: 2691 },
      { items: [823, 1489, 467], grams: 643, total: 2899 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-16] case ${i + 1}/${cases.length}: items=${c.items.length} grams=${c.grams}`);
      const got = invoiceTotal(c.items, c.grams);
      console.log(`[prc-16]   got total=${got}`);
      console.log(`[prc-16]   want total=${c.total}`);
      assert.equal(got, c.total);
    }
  });

  test('invoice batch 5', () => {
    const cases = [
      { items: [310, 1572, 219], grams: 30251, total: 3601 },
      { items: [367, 1572, 250], grams: 42002, total: 3689 },
      { items: [424, 1572, 281], grams: 113, total: 2277 },
      { items: [481, 1572, 312], grams: 272, total: 2365 },
      { items: [538, 1572, 343], grams: 431, total: 2453 },
      { items: [595, 1572, 374], grams: 590, total: 2661 },
      { items: [652, 1572, 405], grams: 749, total: 2749 },
      { items: [709, 1572, 436], grams: 908, total: 2837 },
      { items: [766, 1572, 467], grams: 1067, total: 2925 },
      { items: [823, 1572, 498], grams: 1226, total: 3013 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-17] case ${i + 1}/${cases.length}: items=${c.items.length} grams=${c.grams}`);
      const got = invoiceTotal(c.items, c.grams);
      console.log(`[prc-17]   got total=${got}`);
      console.log(`[prc-17]   want total=${c.total}`);
      assert.equal(got, c.total);
    }
  });

  test('invoice batch 6', () => {
    const cases = [
      { items: [310, 1655, 250], grams: 378, total: 2215 },
      { items: [367, 1655, 281], grams: 537, total: 2423 },
      { items: [424, 1655, 312], grams: 696, total: 2511 },
      { items: [481, 1655, 343], grams: 855, total: 2599 },
      { items: [538, 1655, 374], grams: 1014, total: 2687 },
      { items: [595, 1655, 405], grams: 1173, total: 2775 },
      { items: [652, 1655, 436], grams: 1332, total: 2863 },
      { items: [709, 1655, 467], grams: 1491, total: 2951 },
      { items: [766, 1655, 498], grams: 4054, total: 3399 },
      { items: [823, 1655, 529], grams: 6985, total: 3487 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-18] case ${i + 1}/${cases.length}: items=${c.items.length} grams=${c.grams}`);
      const got = invoiceTotal(c.items, c.grams);
      console.log(`[prc-18]   got total=${got}`);
      console.log(`[prc-18]   want total=${c.total}`);
      assert.equal(got, c.total);
    }
  });

});

describe('tier surcharges', () => {
  test('surcharge batch 1', () => {
    const cases = [
      { grams: 166, cents: 0 },
      { grams: 537, cents: 120 },
      { grams: 908, cents: 120 },
      { grams: 1279, cents: 120 },
      { grams: 4054, cents: 480 },
      { grams: 10893, cents: 480 },
      { grams: 26334, cents: 1500 },
      { grams: 113, cents: 0 },
      { grams: 484, cents: 0 },
      { grams: 855, cents: 120 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-19] case ${i + 1}/${cases.length}: grams=${c.grams}`);
      const got = surchargeFor(c.grams);
      console.log(`[prc-19]   got cents=${got}`);
      console.log(`[prc-19]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('surcharge batch 2', () => {
    const cases = [
      { grams: 1067, cents: 120 },
      { grams: 1438, cents: 120 },
      { grams: 6985, cents: 480 },
      { grams: 13824, cents: 480 },
      { grams: 38085, cents: 1500 },
      { grams: 272, cents: 0 },
      { grams: 643, cents: 120 },
      { grams: 1014, cents: 120 },
      { grams: 1385, cents: 120 },
      { grams: 6008, cents: 480 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-20] case ${i + 1}/${cases.length}: grams=${c.grams}`);
      const got = surchargeFor(c.grams);
      console.log(`[prc-20]   got cents=${got}`);
      console.log(`[prc-20]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('no surcharge applies through the 500 g letter ceiling', () => {
    const cases = [
      { grams: 451, cents: 0 },
      { grams: 458, cents: 0 },
      { grams: 464, cents: 0 },
      { grams: 470, cents: 0 },
      { grams: 477, cents: 0 },
      { grams: 483, cents: 0 },
      { grams: 500, cents: 0 },
      { grams: 489, cents: 0 },
      { grams: 494, cents: 0 },
      { grams: 498, cents: 0 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-21] case ${i + 1}/${cases.length}: grams=${c.grams}`);
      const got = surchargeFor(c.grams);
      console.log(`[prc-21]   got cents=${got}`);
      console.log(`[prc-21]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('surcharge batch 4', () => {
    const cases = [
      { grams: 219, cents: 0 },
      { grams: 590, cents: 120 },
      { grams: 961, cents: 120 },
      { grams: 1332, cents: 120 },
      { grams: 5031, cents: 480 },
      { grams: 11870, cents: 480 },
      { grams: 30251, cents: 1500 },
      { grams: 166, cents: 0 },
      { grams: 537, cents: 120 },
      { grams: 908, cents: 120 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-22] case ${i + 1}/${cases.length}: grams=${c.grams}`);
      const got = surchargeFor(c.grams);
      console.log(`[prc-22]   got cents=${got}`);
      console.log(`[prc-22]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('surcharge batch 5', () => {
    const cases = [
      { grams: 1120, cents: 120 },
      { grams: 1491, cents: 120 },
      { grams: 7962, cents: 480 },
      { grams: 14801, cents: 480 },
      { grams: 42002, cents: 1500 },
      { grams: 325, cents: 0 },
      { grams: 696, cents: 120 },
      { grams: 1067, cents: 120 },
      { grams: 1438, cents: 120 },
      { grams: 6985, cents: 480 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-23] case ${i + 1}/${cases.length}: grams=${c.grams}`);
      const got = surchargeFor(c.grams);
      console.log(`[prc-23]   got cents=${got}`);
      console.log(`[prc-23]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('surcharge batch 6', () => {
    const cases = [
      { grams: 10893, cents: 480 },
      { grams: 26334, cents: 1500 },
      { grams: 113, cents: 0 },
      { grams: 484, cents: 0 },
      { grams: 855, cents: 120 },
      { grams: 1226, cents: 120 },
      { grams: 3077, cents: 480 },
      { grams: 9916, cents: 480 },
      { grams: 22417, cents: 1500 },
      { grams: 60, cents: 0 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[prc-24] case ${i + 1}/${cases.length}: grams=${c.grams}`);
      const got = surchargeFor(c.grams);
      console.log(`[prc-24]   got cents=${got}`);
      console.log(`[prc-24]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

});
