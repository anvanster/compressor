import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogSkus, lineCents, lineWeight, priceOf, weightOf } from './inventory.mjs';

describe('catalog weights', () => {
  test('catalog weight batch 1', () => {
    const cases = [
      { sku: 'SKU-00001', grams: 77 },
      { sku: 'SKU-00002', grams: 114 },
      { sku: 'SKU-00003', grams: 151 },
      { sku: 'SKU-00004', grams: 188 },
      { sku: 'SKU-00005', grams: 225 },
      { sku: 'SKU-00006', grams: 262 },
      { sku: 'SKU-00007', grams: 299 },
      { sku: 'SKU-00008', grams: 336 },
      { sku: 'SKU-00009', grams: 373 },
      { sku: 'SKU-00010', grams: 410 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-01] case ${i + 1}/${cases.length}: sku=${c.sku}`);
      const got = weightOf(c.sku);
      console.log(`[inv-01]   got grams=${got}`);
      console.log(`[inv-01]   want grams=${c.grams}`);
      assert.equal(got, c.grams);
    }
  });

  test('catalog weight batch 2', () => {
    const cases = [
      { sku: 'SKU-00011', grams: 447 },
      { sku: 'SKU-00012', grams: 484 },
      { sku: 'SKU-00013', grams: 521 },
      { sku: 'SKU-00014', grams: 558 },
      { sku: 'SKU-00015', grams: 595 },
      { sku: 'SKU-00016', grams: 632 },
      { sku: 'SKU-00017', grams: 669 },
      { sku: 'SKU-00018', grams: 706 },
      { sku: 'SKU-00019', grams: 743 },
      { sku: 'SKU-00020', grams: 780 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-02] case ${i + 1}/${cases.length}: sku=${c.sku}`);
      const got = weightOf(c.sku);
      console.log(`[inv-02]   got grams=${got}`);
      console.log(`[inv-02]   want grams=${c.grams}`);
      assert.equal(got, c.grams);
    }
  });

  test('catalog weight batch 3', () => {
    const cases = [
      { sku: 'SKU-00021', grams: 817 },
      { sku: 'SKU-00022', grams: 854 },
      { sku: 'SKU-00023', grams: 891 },
      { sku: 'SKU-00024', grams: 928 },
      { sku: 'SKU-00025', grams: 965 },
      { sku: 'SKU-00026', grams: 1002 },
      { sku: 'SKU-00027', grams: 1039 },
      { sku: 'SKU-00028', grams: 1076 },
      { sku: 'SKU-00029', grams: 1113 },
      { sku: 'SKU-00030', grams: 1150 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-03] case ${i + 1}/${cases.length}: sku=${c.sku}`);
      const got = weightOf(c.sku);
      console.log(`[inv-03]   got grams=${got}`);
      console.log(`[inv-03]   want grams=${c.grams}`);
      assert.equal(got, c.grams);
    }
  });

  test('catalog weight batch 4', () => {
    const cases = [
      { sku: 'SKU-00031', grams: 1187 },
      { sku: 'SKU-00032', grams: 1224 },
      { sku: 'SKU-00033', grams: 1261 },
      { sku: 'SKU-00034', grams: 1298 },
      { sku: 'SKU-00035', grams: 1335 },
      { sku: 'SKU-00036', grams: 1372 },
      { sku: 'SKU-00037', grams: 1409 },
      { sku: 'SKU-00038', grams: 1446 },
      { sku: 'SKU-00039', grams: 1483 },
      { sku: 'SKU-00040', grams: 1520 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-04] case ${i + 1}/${cases.length}: sku=${c.sku}`);
      const got = weightOf(c.sku);
      console.log(`[inv-04]   got grams=${got}`);
      console.log(`[inv-04]   want grams=${c.grams}`);
      assert.equal(got, c.grams);
    }
  });

  test('catalog weight batch 5', () => {
    const cases = [
      { sku: 'SKU-00001', grams: 77 },
      { sku: 'SKU-00002', grams: 114 },
      { sku: 'SKU-00003', grams: 151 },
      { sku: 'SKU-00004', grams: 188 },
      { sku: 'SKU-00005', grams: 225 },
      { sku: 'SKU-00006', grams: 262 },
      { sku: 'SKU-00007', grams: 299 },
      { sku: 'SKU-00008', grams: 336 },
      { sku: 'SKU-00009', grams: 373 },
      { sku: 'SKU-00010', grams: 410 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-05] case ${i + 1}/${cases.length}: sku=${c.sku}`);
      const got = weightOf(c.sku);
      console.log(`[inv-05]   got grams=${got}`);
      console.log(`[inv-05]   want grams=${c.grams}`);
      assert.equal(got, c.grams);
    }
  });

  test('catalog weight batch 6', () => {
    const cases = [
      { sku: 'SKU-00011', grams: 447 },
      { sku: 'SKU-00012', grams: 484 },
      { sku: 'SKU-00013', grams: 521 },
      { sku: 'SKU-00014', grams: 558 },
      { sku: 'SKU-00015', grams: 595 },
      { sku: 'SKU-00016', grams: 632 },
      { sku: 'SKU-00017', grams: 669 },
      { sku: 'SKU-00018', grams: 706 },
      { sku: 'SKU-00019', grams: 743 },
      { sku: 'SKU-00020', grams: 780 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-06] case ${i + 1}/${cases.length}: sku=${c.sku}`);
      const got = weightOf(c.sku);
      console.log(`[inv-06]   got grams=${got}`);
      console.log(`[inv-06]   want grams=${c.grams}`);
      assert.equal(got, c.grams);
    }
  });

});

describe('catalog prices', () => {
  test('catalog price batch 1', () => {
    const cases = [
      { sku: 'SKU-00001', cents: 205 },
      { sku: 'SKU-00004', cents: 370 },
      { sku: 'SKU-00007', cents: 535 },
      { sku: 'SKU-00010', cents: 700 },
      { sku: 'SKU-00013', cents: 865 },
      { sku: 'SKU-00016', cents: 1030 },
      { sku: 'SKU-00019', cents: 1195 },
      { sku: 'SKU-00022', cents: 1360 },
      { sku: 'SKU-00025', cents: 1525 },
      { sku: 'SKU-00028', cents: 1690 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-07] case ${i + 1}/${cases.length}: sku=${c.sku}`);
      const got = priceOf(c.sku);
      console.log(`[inv-07]   got cents=${got}`);
      console.log(`[inv-07]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('catalog price batch 2', () => {
    const cases = [
      { sku: 'SKU-00011', cents: 755 },
      { sku: 'SKU-00014', cents: 920 },
      { sku: 'SKU-00017', cents: 1085 },
      { sku: 'SKU-00020', cents: 1250 },
      { sku: 'SKU-00023', cents: 1415 },
      { sku: 'SKU-00026', cents: 1580 },
      { sku: 'SKU-00029', cents: 1745 },
      { sku: 'SKU-00032', cents: 1910 },
      { sku: 'SKU-00035', cents: 2075 },
      { sku: 'SKU-00038', cents: 2240 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-08] case ${i + 1}/${cases.length}: sku=${c.sku}`);
      const got = priceOf(c.sku);
      console.log(`[inv-08]   got cents=${got}`);
      console.log(`[inv-08]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('catalog price batch 3', () => {
    const cases = [
      { sku: 'SKU-00021', cents: 1305 },
      { sku: 'SKU-00024', cents: 1470 },
      { sku: 'SKU-00027', cents: 1635 },
      { sku: 'SKU-00030', cents: 1800 },
      { sku: 'SKU-00033', cents: 1965 },
      { sku: 'SKU-00036', cents: 2130 },
      { sku: 'SKU-00039', cents: 2295 },
      { sku: 'SKU-00002', cents: 260 },
      { sku: 'SKU-00005', cents: 425 },
      { sku: 'SKU-00008', cents: 590 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-09] case ${i + 1}/${cases.length}: sku=${c.sku}`);
      const got = priceOf(c.sku);
      console.log(`[inv-09]   got cents=${got}`);
      console.log(`[inv-09]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('catalog price batch 4', () => {
    const cases = [
      { sku: 'SKU-00031', cents: 1855 },
      { sku: 'SKU-00034', cents: 2020 },
      { sku: 'SKU-00037', cents: 2185 },
      { sku: 'SKU-00040', cents: 2350 },
      { sku: 'SKU-00003', cents: 315 },
      { sku: 'SKU-00006', cents: 480 },
      { sku: 'SKU-00009', cents: 645 },
      { sku: 'SKU-00012', cents: 810 },
      { sku: 'SKU-00015', cents: 975 },
      { sku: 'SKU-00018', cents: 1140 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-10] case ${i + 1}/${cases.length}: sku=${c.sku}`);
      const got = priceOf(c.sku);
      console.log(`[inv-10]   got cents=${got}`);
      console.log(`[inv-10]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('catalog price batch 5', () => {
    const cases = [
      { sku: 'SKU-00001', cents: 205 },
      { sku: 'SKU-00004', cents: 370 },
      { sku: 'SKU-00007', cents: 535 },
      { sku: 'SKU-00010', cents: 700 },
      { sku: 'SKU-00013', cents: 865 },
      { sku: 'SKU-00016', cents: 1030 },
      { sku: 'SKU-00019', cents: 1195 },
      { sku: 'SKU-00022', cents: 1360 },
      { sku: 'SKU-00025', cents: 1525 },
      { sku: 'SKU-00028', cents: 1690 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-11] case ${i + 1}/${cases.length}: sku=${c.sku}`);
      const got = priceOf(c.sku);
      console.log(`[inv-11]   got cents=${got}`);
      console.log(`[inv-11]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('catalog price batch 6', () => {
    const cases = [
      { sku: 'SKU-00011', cents: 755 },
      { sku: 'SKU-00014', cents: 920 },
      { sku: 'SKU-00017', cents: 1085 },
      { sku: 'SKU-00020', cents: 1250 },
      { sku: 'SKU-00023', cents: 1415 },
      { sku: 'SKU-00026', cents: 1580 },
      { sku: 'SKU-00029', cents: 1745 },
      { sku: 'SKU-00032', cents: 1910 },
      { sku: 'SKU-00035', cents: 2075 },
      { sku: 'SKU-00038', cents: 2240 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-12] case ${i + 1}/${cases.length}: sku=${c.sku}`);
      const got = priceOf(c.sku);
      console.log(`[inv-12]   got cents=${got}`);
      console.log(`[inv-12]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

});

describe('line weights scale with quantity', () => {
  test('line weight batch 1', () => {
    const cases = [
      { sku: 'SKU-00001', qty: 1, grams: 77 },
      { sku: 'SKU-00004', qty: 2, grams: 376 },
      { sku: 'SKU-00007', qty: 3, grams: 897 },
      { sku: 'SKU-00010', qty: 4, grams: 1640 },
      { sku: 'SKU-00013', qty: 1, grams: 521 },
      { sku: 'SKU-00016', qty: 2, grams: 1264 },
      { sku: 'SKU-00019', qty: 3, grams: 2229 },
      { sku: 'SKU-00022', qty: 4, grams: 3416 },
      { sku: 'SKU-00025', qty: 1, grams: 965 },
      { sku: 'SKU-00028', qty: 2, grams: 2152 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-13] case ${i + 1}/${cases.length}: sku=${c.sku} qty=${c.qty}`);
      const got = lineWeight(c.sku, c.qty);
      console.log(`[inv-13]   got grams=${got}`);
      console.log(`[inv-13]   want grams=${c.grams}`);
      assert.equal(got, c.grams);
    }
  });

  test('line weight batch 2', () => {
    const cases = [
      { sku: 'SKU-00008', qty: 1, grams: 336 },
      { sku: 'SKU-00011', qty: 2, grams: 894 },
      { sku: 'SKU-00014', qty: 3, grams: 1674 },
      { sku: 'SKU-00017', qty: 4, grams: 2676 },
      { sku: 'SKU-00020', qty: 1, grams: 780 },
      { sku: 'SKU-00023', qty: 2, grams: 1782 },
      { sku: 'SKU-00026', qty: 3, grams: 3006 },
      { sku: 'SKU-00029', qty: 4, grams: 4452 },
      { sku: 'SKU-00032', qty: 1, grams: 1224 },
      { sku: 'SKU-00035', qty: 2, grams: 2670 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-14] case ${i + 1}/${cases.length}: sku=${c.sku} qty=${c.qty}`);
      const got = lineWeight(c.sku, c.qty);
      console.log(`[inv-14]   got grams=${got}`);
      console.log(`[inv-14]   want grams=${c.grams}`);
      assert.equal(got, c.grams);
    }
  });

  test('line weight batch 3', () => {
    const cases = [
      { sku: 'SKU-00015', qty: 1, grams: 595 },
      { sku: 'SKU-00018', qty: 2, grams: 1412 },
      { sku: 'SKU-00021', qty: 3, grams: 2451 },
      { sku: 'SKU-00024', qty: 4, grams: 3712 },
      { sku: 'SKU-00027', qty: 1, grams: 1039 },
      { sku: 'SKU-00030', qty: 2, grams: 2300 },
      { sku: 'SKU-00033', qty: 3, grams: 3783 },
      { sku: 'SKU-00036', qty: 4, grams: 5488 },
      { sku: 'SKU-00039', qty: 1, grams: 1483 },
      { sku: 'SKU-00002', qty: 2, grams: 228 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-15] case ${i + 1}/${cases.length}: sku=${c.sku} qty=${c.qty}`);
      const got = lineWeight(c.sku, c.qty);
      console.log(`[inv-15]   got grams=${got}`);
      console.log(`[inv-15]   want grams=${c.grams}`);
      assert.equal(got, c.grams);
    }
  });

  test('line weight batch 4', () => {
    const cases = [
      { sku: 'SKU-00022', qty: 1, grams: 854 },
      { sku: 'SKU-00025', qty: 2, grams: 1930 },
      { sku: 'SKU-00028', qty: 3, grams: 3228 },
      { sku: 'SKU-00031', qty: 4, grams: 4748 },
      { sku: 'SKU-00034', qty: 1, grams: 1298 },
      { sku: 'SKU-00037', qty: 2, grams: 2818 },
      { sku: 'SKU-00040', qty: 3, grams: 4560 },
      { sku: 'SKU-00003', qty: 4, grams: 604 },
      { sku: 'SKU-00006', qty: 1, grams: 262 },
      { sku: 'SKU-00009', qty: 2, grams: 746 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-16] case ${i + 1}/${cases.length}: sku=${c.sku} qty=${c.qty}`);
      const got = lineWeight(c.sku, c.qty);
      console.log(`[inv-16]   got grams=${got}`);
      console.log(`[inv-16]   want grams=${c.grams}`);
      assert.equal(got, c.grams);
    }
  });

  test('line weight batch 5', () => {
    const cases = [
      { sku: 'SKU-00029', qty: 1, grams: 1113 },
      { sku: 'SKU-00032', qty: 2, grams: 2448 },
      { sku: 'SKU-00035', qty: 3, grams: 4005 },
      { sku: 'SKU-00038', qty: 4, grams: 5784 },
      { sku: 'SKU-00001', qty: 1, grams: 77 },
      { sku: 'SKU-00004', qty: 2, grams: 376 },
      { sku: 'SKU-00007', qty: 3, grams: 897 },
      { sku: 'SKU-00010', qty: 4, grams: 1640 },
      { sku: 'SKU-00013', qty: 1, grams: 521 },
      { sku: 'SKU-00016', qty: 2, grams: 1264 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-17] case ${i + 1}/${cases.length}: sku=${c.sku} qty=${c.qty}`);
      const got = lineWeight(c.sku, c.qty);
      console.log(`[inv-17]   got grams=${got}`);
      console.log(`[inv-17]   want grams=${c.grams}`);
      assert.equal(got, c.grams);
    }
  });

  test('line weight batch 6', () => {
    const cases = [
      { sku: 'SKU-00036', qty: 1, grams: 1372 },
      { sku: 'SKU-00039', qty: 2, grams: 2966 },
      { sku: 'SKU-00002', qty: 3, grams: 342 },
      { sku: 'SKU-00005', qty: 4, grams: 900 },
      { sku: 'SKU-00008', qty: 1, grams: 336 },
      { sku: 'SKU-00011', qty: 2, grams: 894 },
      { sku: 'SKU-00014', qty: 3, grams: 1674 },
      { sku: 'SKU-00017', qty: 4, grams: 2676 },
      { sku: 'SKU-00020', qty: 1, grams: 780 },
      { sku: 'SKU-00023', qty: 2, grams: 1782 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-18] case ${i + 1}/${cases.length}: sku=${c.sku} qty=${c.qty}`);
      const got = lineWeight(c.sku, c.qty);
      console.log(`[inv-18]   got grams=${got}`);
      console.log(`[inv-18]   want grams=${c.grams}`);
      assert.equal(got, c.grams);
    }
  });

});

describe('line totals scale with quantity', () => {
  test('line cents batch 1', () => {
    const cases = [
      { sku: 'SKU-00001', qty: 2, cents: 410 },
      { sku: 'SKU-00008', qty: 3, cents: 1770 },
      { sku: 'SKU-00015', qty: 4, cents: 3900 },
      { sku: 'SKU-00022', qty: 2, cents: 2720 },
      { sku: 'SKU-00029', qty: 3, cents: 5235 },
      { sku: 'SKU-00036', qty: 4, cents: 8520 },
      { sku: 'SKU-00003', qty: 2, cents: 630 },
      { sku: 'SKU-00010', qty: 3, cents: 2100 },
      { sku: 'SKU-00017', qty: 4, cents: 4340 },
      { sku: 'SKU-00024', qty: 2, cents: 2940 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-19] case ${i + 1}/${cases.length}: sku=${c.sku} qty=${c.qty}`);
      const got = lineCents(c.sku, c.qty);
      console.log(`[inv-19]   got cents=${got}`);
      console.log(`[inv-19]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('line cents batch 2', () => {
    const cases = [
      { sku: 'SKU-00006', qty: 2, cents: 960 },
      { sku: 'SKU-00013', qty: 3, cents: 2595 },
      { sku: 'SKU-00020', qty: 4, cents: 5000 },
      { sku: 'SKU-00027', qty: 2, cents: 3270 },
      { sku: 'SKU-00034', qty: 3, cents: 6060 },
      { sku: 'SKU-00001', qty: 4, cents: 820 },
      { sku: 'SKU-00008', qty: 2, cents: 1180 },
      { sku: 'SKU-00015', qty: 3, cents: 2925 },
      { sku: 'SKU-00022', qty: 4, cents: 5440 },
      { sku: 'SKU-00029', qty: 2, cents: 3490 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-20] case ${i + 1}/${cases.length}: sku=${c.sku} qty=${c.qty}`);
      const got = lineCents(c.sku, c.qty);
      console.log(`[inv-20]   got cents=${got}`);
      console.log(`[inv-20]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('line cents batch 3', () => {
    const cases = [
      { sku: 'SKU-00011', qty: 2, cents: 1510 },
      { sku: 'SKU-00018', qty: 3, cents: 3420 },
      { sku: 'SKU-00025', qty: 4, cents: 6100 },
      { sku: 'SKU-00032', qty: 2, cents: 3820 },
      { sku: 'SKU-00039', qty: 3, cents: 6885 },
      { sku: 'SKU-00006', qty: 4, cents: 1920 },
      { sku: 'SKU-00013', qty: 2, cents: 1730 },
      { sku: 'SKU-00020', qty: 3, cents: 3750 },
      { sku: 'SKU-00027', qty: 4, cents: 6540 },
      { sku: 'SKU-00034', qty: 2, cents: 4040 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-21] case ${i + 1}/${cases.length}: sku=${c.sku} qty=${c.qty}`);
      const got = lineCents(c.sku, c.qty);
      console.log(`[inv-21]   got cents=${got}`);
      console.log(`[inv-21]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('line cents batch 4', () => {
    const cases = [
      { sku: 'SKU-00016', qty: 2, cents: 2060 },
      { sku: 'SKU-00023', qty: 3, cents: 4245 },
      { sku: 'SKU-00030', qty: 4, cents: 7200 },
      { sku: 'SKU-00037', qty: 2, cents: 4370 },
      { sku: 'SKU-00004', qty: 3, cents: 1110 },
      { sku: 'SKU-00011', qty: 4, cents: 3020 },
      { sku: 'SKU-00018', qty: 2, cents: 2280 },
      { sku: 'SKU-00025', qty: 3, cents: 4575 },
      { sku: 'SKU-00032', qty: 4, cents: 7640 },
      { sku: 'SKU-00039', qty: 2, cents: 4590 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-22] case ${i + 1}/${cases.length}: sku=${c.sku} qty=${c.qty}`);
      const got = lineCents(c.sku, c.qty);
      console.log(`[inv-22]   got cents=${got}`);
      console.log(`[inv-22]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('line cents batch 5', () => {
    const cases = [
      { sku: 'SKU-00021', qty: 2, cents: 2610 },
      { sku: 'SKU-00028', qty: 3, cents: 5070 },
      { sku: 'SKU-00035', qty: 4, cents: 8300 },
      { sku: 'SKU-00002', qty: 2, cents: 520 },
      { sku: 'SKU-00009', qty: 3, cents: 1935 },
      { sku: 'SKU-00016', qty: 4, cents: 4120 },
      { sku: 'SKU-00023', qty: 2, cents: 2830 },
      { sku: 'SKU-00030', qty: 3, cents: 5400 },
      { sku: 'SKU-00037', qty: 4, cents: 8740 },
      { sku: 'SKU-00004', qty: 2, cents: 740 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-23] case ${i + 1}/${cases.length}: sku=${c.sku} qty=${c.qty}`);
      const got = lineCents(c.sku, c.qty);
      console.log(`[inv-23]   got cents=${got}`);
      console.log(`[inv-23]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

  test('line cents batch 6', () => {
    const cases = [
      { sku: 'SKU-00026', qty: 2, cents: 3160 },
      { sku: 'SKU-00033', qty: 3, cents: 5895 },
      { sku: 'SKU-00040', qty: 4, cents: 9400 },
      { sku: 'SKU-00007', qty: 2, cents: 1070 },
      { sku: 'SKU-00014', qty: 3, cents: 2760 },
      { sku: 'SKU-00021', qty: 4, cents: 5220 },
      { sku: 'SKU-00028', qty: 2, cents: 3380 },
      { sku: 'SKU-00035', qty: 3, cents: 6225 },
      { sku: 'SKU-00002', qty: 4, cents: 1040 },
      { sku: 'SKU-00009', qty: 2, cents: 1290 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[inv-24] case ${i + 1}/${cases.length}: sku=${c.sku} qty=${c.qty}`);
      const got = lineCents(c.sku, c.qty);
      console.log(`[inv-24]   got cents=${got}`);
      console.log(`[inv-24]   want cents=${c.cents}`);
      assert.equal(got, c.cents);
    }
  });

});

test('catalog holds exactly 40 skus', () => {
  assert.equal(catalogSkus().length, 40);
});
