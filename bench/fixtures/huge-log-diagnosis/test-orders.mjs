import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrder, manualPackage, orderSubtotal, orderWeight, packOrder } from './orders.mjs';

describe('order weights', () => {
  test('order weight batch 1', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00001', qty: 1 }, { sku: 'SKU-00012', qty: 2 }], grams: 1045 },
      { lines: [{ sku: 'SKU-00008', qty: 2 }, { sku: 'SKU-00019', qty: 3 }, { sku: 'SKU-00030', qty: 1 }], grams: 4051 },
      { lines: [{ sku: 'SKU-00015', qty: 3 }, { sku: 'SKU-00026', qty: 1 }], grams: 2787 },
      { lines: [{ sku: 'SKU-00022', qty: 1 }, { sku: 'SKU-00033', qty: 2 }, { sku: 'SKU-00004', qty: 3 }], grams: 3940 },
      { lines: [{ sku: 'SKU-00029', qty: 2 }, { sku: 'SKU-00040', qty: 3 }], grams: 6786 },
      { lines: [{ sku: 'SKU-00036', qty: 3 }, { sku: 'SKU-00007', qty: 1 }, { sku: 'SKU-00018', qty: 2 }], grams: 5827 },
      { lines: [{ sku: 'SKU-00003', qty: 1 }, { sku: 'SKU-00014', qty: 2 }], grams: 1267 },
      { lines: [{ sku: 'SKU-00010', qty: 2 }, { sku: 'SKU-00021', qty: 3 }, { sku: 'SKU-00032', qty: 1 }], grams: 4495 },
      { lines: [{ sku: 'SKU-00017', qty: 3 }, { sku: 'SKU-00028', qty: 1 }], grams: 3083 },
      { lines: [{ sku: 'SKU-00024', qty: 1 }, { sku: 'SKU-00035', qty: 2 }, { sku: 'SKU-00006', qty: 3 }], grams: 4384 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-01] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const order = buildOrder(800 + i, c.lines);
      console.log(`[ord-01]   got grams=${orderWeight(order)}`);
      console.log(`[ord-01]   want grams=${c.grams}`);
      assert.equal(orderWeight(order), c.grams);
    }
  });

  test('order weight batch 2', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00014', qty: 1 }, { sku: 'SKU-00025', qty: 2 }], grams: 2488 },
      { lines: [{ sku: 'SKU-00021', qty: 2 }, { sku: 'SKU-00032', qty: 3 }, { sku: 'SKU-00003', qty: 1 }], grams: 5457 },
      { lines: [{ sku: 'SKU-00028', qty: 3 }, { sku: 'SKU-00039', qty: 1 }], grams: 4711 },
      { lines: [{ sku: 'SKU-00035', qty: 1 }, { sku: 'SKU-00006', qty: 2 }, { sku: 'SKU-00017', qty: 3 }], grams: 3866 },
      { lines: [{ sku: 'SKU-00002', qty: 2 }, { sku: 'SKU-00013', qty: 3 }], grams: 1791 },
      { lines: [{ sku: 'SKU-00009', qty: 3 }, { sku: 'SKU-00020', qty: 1 }, { sku: 'SKU-00031', qty: 2 }], grams: 4273 },
      { lines: [{ sku: 'SKU-00016', qty: 1 }, { sku: 'SKU-00027', qty: 2 }], grams: 2710 },
      { lines: [{ sku: 'SKU-00023', qty: 2 }, { sku: 'SKU-00034', qty: 3 }, { sku: 'SKU-00005', qty: 1 }], grams: 5901 },
      { lines: [{ sku: 'SKU-00030', qty: 3 }, { sku: 'SKU-00001', qty: 1 }], grams: 3527 },
      { lines: [{ sku: 'SKU-00037', qty: 1 }, { sku: 'SKU-00008', qty: 2 }, { sku: 'SKU-00019', qty: 3 }], grams: 4310 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-02] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const order = buildOrder(800 + i, c.lines);
      console.log(`[ord-02]   got grams=${orderWeight(order)}`);
      console.log(`[ord-02]   want grams=${c.grams}`);
      assert.equal(orderWeight(order), c.grams);
    }
  });

  test('order weight batch 3', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00027', qty: 1 }, { sku: 'SKU-00038', qty: 2 }], grams: 3931 },
      { lines: [{ sku: 'SKU-00034', qty: 2 }, { sku: 'SKU-00005', qty: 3 }, { sku: 'SKU-00016', qty: 1 }], grams: 3903 },
      { lines: [{ sku: 'SKU-00001', qty: 3 }, { sku: 'SKU-00012', qty: 1 }], grams: 715 },
      { lines: [{ sku: 'SKU-00008', qty: 1 }, { sku: 'SKU-00019', qty: 2 }, { sku: 'SKU-00030', qty: 3 }], grams: 5272 },
      { lines: [{ sku: 'SKU-00015', qty: 2 }, { sku: 'SKU-00026', qty: 3 }], grams: 4196 },
      { lines: [{ sku: 'SKU-00022', qty: 3 }, { sku: 'SKU-00033', qty: 1 }, { sku: 'SKU-00004', qty: 2 }], grams: 4199 },
      { lines: [{ sku: 'SKU-00029', qty: 1 }, { sku: 'SKU-00040', qty: 2 }], grams: 4153 },
      { lines: [{ sku: 'SKU-00036', qty: 2 }, { sku: 'SKU-00007', qty: 3 }, { sku: 'SKU-00018', qty: 1 }], grams: 4347 },
      { lines: [{ sku: 'SKU-00003', qty: 3 }, { sku: 'SKU-00014', qty: 1 }], grams: 1011 },
      { lines: [{ sku: 'SKU-00010', qty: 1 }, { sku: 'SKU-00021', qty: 2 }, { sku: 'SKU-00032', qty: 3 }], grams: 5716 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-03] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const order = buildOrder(800 + i, c.lines);
      console.log(`[ord-03]   got grams=${orderWeight(order)}`);
      console.log(`[ord-03]   want grams=${c.grams}`);
      assert.equal(orderWeight(order), c.grams);
    }
  });

  test('order weight batch 4', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00040', qty: 1 }, { sku: 'SKU-00011', qty: 2 }], grams: 2414 },
      { lines: [{ sku: 'SKU-00007', qty: 2 }, { sku: 'SKU-00018', qty: 3 }, { sku: 'SKU-00029', qty: 1 }], grams: 3829 },
      { lines: [{ sku: 'SKU-00014', qty: 3 }, { sku: 'SKU-00025', qty: 1 }], grams: 2639 },
      { lines: [{ sku: 'SKU-00021', qty: 1 }, { sku: 'SKU-00032', qty: 2 }, { sku: 'SKU-00003', qty: 3 }], grams: 3718 },
      { lines: [{ sku: 'SKU-00028', qty: 2 }, { sku: 'SKU-00039', qty: 3 }], grams: 6601 },
      { lines: [{ sku: 'SKU-00035', qty: 3 }, { sku: 'SKU-00006', qty: 1 }, { sku: 'SKU-00017', qty: 2 }], grams: 5605 },
      { lines: [{ sku: 'SKU-00002', qty: 1 }, { sku: 'SKU-00013', qty: 2 }], grams: 1156 },
      { lines: [{ sku: 'SKU-00009', qty: 2 }, { sku: 'SKU-00020', qty: 3 }, { sku: 'SKU-00031', qty: 1 }], grams: 4273 },
      { lines: [{ sku: 'SKU-00016', qty: 3 }, { sku: 'SKU-00027', qty: 1 }], grams: 2935 },
      { lines: [{ sku: 'SKU-00023', qty: 1 }, { sku: 'SKU-00034', qty: 2 }, { sku: 'SKU-00005', qty: 3 }], grams: 4162 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-04] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const order = buildOrder(800 + i, c.lines);
      console.log(`[ord-04]   got grams=${orderWeight(order)}`);
      console.log(`[ord-04]   want grams=${c.grams}`);
      assert.equal(orderWeight(order), c.grams);
    }
  });

  test('order weight batch 5', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00013', qty: 1 }, { sku: 'SKU-00024', qty: 2 }], grams: 2377 },
      { lines: [{ sku: 'SKU-00020', qty: 2 }, { sku: 'SKU-00031', qty: 3 }, { sku: 'SKU-00002', qty: 1 }], grams: 5235 },
      { lines: [{ sku: 'SKU-00027', qty: 3 }, { sku: 'SKU-00038', qty: 1 }], grams: 4563 },
      { lines: [{ sku: 'SKU-00034', qty: 1 }, { sku: 'SKU-00005', qty: 2 }, { sku: 'SKU-00016', qty: 3 }], grams: 3644 },
      { lines: [{ sku: 'SKU-00001', qty: 2 }, { sku: 'SKU-00012', qty: 3 }], grams: 1606 },
      { lines: [{ sku: 'SKU-00008', qty: 3 }, { sku: 'SKU-00019', qty: 1 }, { sku: 'SKU-00030', qty: 2 }], grams: 4051 },
      { lines: [{ sku: 'SKU-00015', qty: 1 }, { sku: 'SKU-00026', qty: 2 }], grams: 2599 },
      { lines: [{ sku: 'SKU-00022', qty: 2 }, { sku: 'SKU-00033', qty: 3 }, { sku: 'SKU-00004', qty: 1 }], grams: 5679 },
      { lines: [{ sku: 'SKU-00029', qty: 3 }, { sku: 'SKU-00040', qty: 1 }], grams: 4859 },
      { lines: [{ sku: 'SKU-00036', qty: 1 }, { sku: 'SKU-00007', qty: 2 }, { sku: 'SKU-00018', qty: 3 }], grams: 4088 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-05] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const order = buildOrder(800 + i, c.lines);
      console.log(`[ord-05]   got grams=${orderWeight(order)}`);
      console.log(`[ord-05]   want grams=${c.grams}`);
      assert.equal(orderWeight(order), c.grams);
    }
  });

  test('order weight batch 6', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00026', qty: 1 }, { sku: 'SKU-00037', qty: 2 }], grams: 3820 },
      { lines: [{ sku: 'SKU-00033', qty: 2 }, { sku: 'SKU-00004', qty: 3 }, { sku: 'SKU-00015', qty: 1 }], grams: 3681 },
      { lines: [{ sku: 'SKU-00040', qty: 3 }, { sku: 'SKU-00011', qty: 1 }], grams: 5007 },
      { lines: [{ sku: 'SKU-00007', qty: 1 }, { sku: 'SKU-00018', qty: 2 }, { sku: 'SKU-00029', qty: 3 }], grams: 5050 },
      { lines: [{ sku: 'SKU-00014', qty: 2 }, { sku: 'SKU-00025', qty: 3 }], grams: 4011 },
      { lines: [{ sku: 'SKU-00021', qty: 3 }, { sku: 'SKU-00032', qty: 1 }, { sku: 'SKU-00003', qty: 2 }], grams: 3977 },
      { lines: [{ sku: 'SKU-00028', qty: 1 }, { sku: 'SKU-00039', qty: 2 }], grams: 4042 },
      { lines: [{ sku: 'SKU-00035', qty: 2 }, { sku: 'SKU-00006', qty: 3 }, { sku: 'SKU-00017', qty: 1 }], grams: 4125 },
      { lines: [{ sku: 'SKU-00002', qty: 3 }, { sku: 'SKU-00013', qty: 1 }], grams: 863 },
      { lines: [{ sku: 'SKU-00009', qty: 1 }, { sku: 'SKU-00020', qty: 2 }, { sku: 'SKU-00031', qty: 3 }], grams: 5494 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-06] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const order = buildOrder(800 + i, c.lines);
      console.log(`[ord-06]   got grams=${orderWeight(order)}`);
      console.log(`[ord-06]   want grams=${c.grams}`);
      assert.equal(orderWeight(order), c.grams);
    }
  });

});

describe('hand-weighed packages', () => {
  test('manual package batch 1', () => {
    const cases = [
      { seq: 1, grams: 60, id: 'PKG-00001', tier: 'letter' },
      { seq: 2, grams: 325, id: 'PKG-00002', tier: 'letter' },
      { seq: 3, grams: 590, id: 'PKG-00003', tier: 'parcel' },
      { seq: 4, grams: 855, id: 'PKG-00004', tier: 'parcel' },
      { seq: 5, grams: 1120, id: 'PKG-00005', tier: 'parcel' },
      { seq: 6, grams: 1385, id: 'PKG-00006', tier: 'parcel' },
      { seq: 7, grams: 4054, id: 'PKG-00007', tier: 'freight' },
      { seq: 8, grams: 8939, id: 'PKG-00008', tier: 'freight' },
      { seq: 9, grams: 13824, id: 'PKG-00009', tier: 'freight' },
      { seq: 10, grams: 30251, id: 'PKG-00010', tier: 'pallet' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-07] case ${i + 1}/${cases.length}: seq=${c.seq} grams=${c.grams}`);
      const pkg = manualPackage(c.seq, c.grams);
      console.log(`[ord-07]   got id=${pkg.id} tier=${pkg.tier}`);
      console.log(`[ord-07]   want id=${c.id} tier=${c.tier}`);
      assert.equal(pkg.id, c.id);
      assert.equal(pkg.tier, c.tier);
    }
  });

  test('manual package batch 2', () => {
    const cases = [
      { seq: 11, grams: 537, id: 'PKG-00011', tier: 'parcel' },
      { seq: 12, grams: 802, id: 'PKG-00012', tier: 'parcel' },
      { seq: 13, grams: 1067, id: 'PKG-00013', tier: 'parcel' },
      { seq: 14, grams: 1332, id: 'PKG-00014', tier: 'parcel' },
      { seq: 15, grams: 3077, id: 'PKG-00015', tier: 'freight' },
      { seq: 16, grams: 7962, id: 'PKG-00016', tier: 'freight' },
      { seq: 17, grams: 12847, id: 'PKG-00017', tier: 'freight' },
      { seq: 18, grams: 26334, id: 'PKG-00018', tier: 'pallet' },
      { seq: 19, grams: 45919, id: 'PKG-00019', tier: 'pallet' },
      { seq: 20, grams: 272, id: 'PKG-00020', tier: 'letter' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-08] case ${i + 1}/${cases.length}: seq=${c.seq} grams=${c.grams}`);
      const pkg = manualPackage(c.seq, c.grams);
      console.log(`[ord-08]   got id=${pkg.id} tier=${pkg.tier}`);
      console.log(`[ord-08]   want id=${c.id} tier=${c.tier}`);
      assert.equal(pkg.id, c.id);
      assert.equal(pkg.tier, c.tier);
    }
  });

  test('manual package batch 3', () => {
    const cases = [
      { seq: 21, grams: 1014, id: 'PKG-00021', tier: 'parcel' },
      { seq: 22, grams: 1279, id: 'PKG-00022', tier: 'parcel' },
      { seq: 23, grams: 2100, id: 'PKG-00023', tier: 'freight' },
      { seq: 24, grams: 6985, id: 'PKG-00024', tier: 'freight' },
      { seq: 25, grams: 11870, id: 'PKG-00025', tier: 'freight' },
      { seq: 26, grams: 22417, id: 'PKG-00026', tier: 'pallet' },
      { seq: 27, grams: 42002, id: 'PKG-00027', tier: 'pallet' },
      { seq: 28, grams: 219, id: 'PKG-00028', tier: 'letter' },
      { seq: 29, grams: 484, id: 'PKG-00029', tier: 'letter' },
      { seq: 30, grams: 749, id: 'PKG-00030', tier: 'parcel' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-09] case ${i + 1}/${cases.length}: seq=${c.seq} grams=${c.grams}`);
      const pkg = manualPackage(c.seq, c.grams);
      console.log(`[ord-09]   got id=${pkg.id} tier=${pkg.tier}`);
      console.log(`[ord-09]   want id=${c.id} tier=${c.tier}`);
      assert.equal(pkg.id, c.id);
      assert.equal(pkg.tier, c.tier);
    }
  });

  test('manual package batch 4', () => {
    const cases = [
      { seq: 31, grams: 1491, id: 'PKG-00031', tier: 'parcel' },
      { seq: 32, grams: 6008, id: 'PKG-00032', tier: 'freight' },
      { seq: 33, grams: 10893, id: 'PKG-00033', tier: 'freight' },
      { seq: 34, grams: 18500, id: 'PKG-00034', tier: 'freight' },
      { seq: 35, grams: 38085, id: 'PKG-00035', tier: 'pallet' },
      { seq: 36, grams: 166, id: 'PKG-00036', tier: 'letter' },
      { seq: 37, grams: 431, id: 'PKG-00037', tier: 'letter' },
      { seq: 38, grams: 696, id: 'PKG-00038', tier: 'parcel' },
      { seq: 39, grams: 961, id: 'PKG-00039', tier: 'parcel' },
      { seq: 40, grams: 1226, id: 'PKG-00040', tier: 'parcel' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-10] case ${i + 1}/${cases.length}: seq=${c.seq} grams=${c.grams}`);
      const pkg = manualPackage(c.seq, c.grams);
      console.log(`[ord-10]   got id=${pkg.id} tier=${pkg.tier}`);
      console.log(`[ord-10]   want id=${c.id} tier=${c.tier}`);
      assert.equal(pkg.id, c.id);
      assert.equal(pkg.tier, c.tier);
    }
  });

  test('counter packages pack as letters through the 500 g handbook ceiling', () => {
    const cases = [
      { seq: 41, grams: 455, id: 'PKG-00041', tier: 'letter' },
      { seq: 42, grams: 461, id: 'PKG-00042', tier: 'letter' },
      { seq: 43, grams: 468, id: 'PKG-00043', tier: 'letter' },
      { seq: 44, grams: 473, id: 'PKG-00044', tier: 'letter' },
      { seq: 45, grams: 480, id: 'PKG-00045', tier: 'letter' },
      { seq: 46, grams: 487, id: 'PKG-00046', tier: 'letter' },
      { seq: 47, grams: 500, id: 'PKG-00047', tier: 'letter' },
      { seq: 48, grams: 491, id: 'PKG-00048', tier: 'letter' },
      { seq: 49, grams: 495, id: 'PKG-00049', tier: 'letter' },
      { seq: 50, grams: 499, id: 'PKG-00050', tier: 'letter' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-11] case ${i + 1}/${cases.length}: seq=${c.seq} grams=${c.grams}`);
      const pkg = manualPackage(c.seq, c.grams);
      console.log(`[ord-11]   got id=${pkg.id} tier=${pkg.tier}`);
      console.log(`[ord-11]   want id=${c.id} tier=${c.tier}`);
      assert.equal(pkg.id, c.id);
      assert.equal(pkg.tier, c.tier);
    }
  });

  test('manual package batch 6', () => {
    const cases = [
      { seq: 51, grams: 30251, id: 'PKG-00051', tier: 'pallet' },
      { seq: 52, grams: 60, id: 'PKG-00052', tier: 'letter' },
      { seq: 53, grams: 325, id: 'PKG-00053', tier: 'letter' },
      { seq: 54, grams: 590, id: 'PKG-00054', tier: 'parcel' },
      { seq: 55, grams: 855, id: 'PKG-00055', tier: 'parcel' },
      { seq: 56, grams: 1120, id: 'PKG-00056', tier: 'parcel' },
      { seq: 57, grams: 1385, id: 'PKG-00057', tier: 'parcel' },
      { seq: 58, grams: 4054, id: 'PKG-00058', tier: 'freight' },
      { seq: 59, grams: 8939, id: 'PKG-00059', tier: 'freight' },
      { seq: 60, grams: 13824, id: 'PKG-00060', tier: 'freight' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-12] case ${i + 1}/${cases.length}: seq=${c.seq} grams=${c.grams}`);
      const pkg = manualPackage(c.seq, c.grams);
      console.log(`[ord-12]   got id=${pkg.id} tier=${pkg.tier}`);
      console.log(`[ord-12]   want id=${c.id} tier=${c.tier}`);
      assert.equal(pkg.id, c.id);
      assert.equal(pkg.tier, c.tier);
    }
  });

});

describe('packing assigns tiers', () => {
  test('pack order batch 1', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00040', qty: 1 }, { sku: 'SKU-00011', qty: 2 }], grams: 2414, tier: 'freight' },
      { lines: [{ sku: 'SKU-00007', qty: 2 }, { sku: 'SKU-00018', qty: 3 }, { sku: 'SKU-00029', qty: 1 }], grams: 3829, tier: 'freight' },
      { lines: [{ sku: 'SKU-00014', qty: 3 }, { sku: 'SKU-00025', qty: 1 }], grams: 2639, tier: 'freight' },
      { lines: [{ sku: 'SKU-00021', qty: 1 }, { sku: 'SKU-00032', qty: 2 }, { sku: 'SKU-00003', qty: 3 }], grams: 3718, tier: 'freight' },
      { lines: [{ sku: 'SKU-00028', qty: 2 }, { sku: 'SKU-00039', qty: 3 }], grams: 6601, tier: 'freight' },
      { lines: [{ sku: 'SKU-00035', qty: 3 }, { sku: 'SKU-00006', qty: 1 }, { sku: 'SKU-00017', qty: 2 }], grams: 5605, tier: 'freight' },
      { lines: [{ sku: 'SKU-00002', qty: 1 }, { sku: 'SKU-00013', qty: 2 }], grams: 1156, tier: 'parcel' },
      { lines: [{ sku: 'SKU-00009', qty: 2 }, { sku: 'SKU-00020', qty: 3 }, { sku: 'SKU-00031', qty: 1 }], grams: 4273, tier: 'freight' },
      { lines: [{ sku: 'SKU-00016', qty: 3 }, { sku: 'SKU-00027', qty: 1 }], grams: 2935, tier: 'freight' },
      { lines: [{ sku: 'SKU-00023', qty: 1 }, { sku: 'SKU-00034', qty: 2 }, { sku: 'SKU-00005', qty: 3 }], grams: 4162, tier: 'freight' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-13] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const packed = packOrder(buildOrder(600 + i, c.lines));
      console.log(`[ord-13]   got grams=${packed.grams} tier=${packed.tier}`);
      console.log(`[ord-13]   want grams=${c.grams} tier=${c.tier}`);
      assert.equal(packed.grams, c.grams);
      assert.equal(packed.tier, c.tier);
    }
  });

  test('pack order batch 2', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00013', qty: 1 }, { sku: 'SKU-00024', qty: 2 }], grams: 2377, tier: 'freight' },
      { lines: [{ sku: 'SKU-00020', qty: 2 }, { sku: 'SKU-00031', qty: 3 }, { sku: 'SKU-00002', qty: 1 }], grams: 5235, tier: 'freight' },
      { lines: [{ sku: 'SKU-00027', qty: 3 }, { sku: 'SKU-00038', qty: 1 }], grams: 4563, tier: 'freight' },
      { lines: [{ sku: 'SKU-00034', qty: 1 }, { sku: 'SKU-00005', qty: 2 }, { sku: 'SKU-00016', qty: 3 }], grams: 3644, tier: 'freight' },
      { lines: [{ sku: 'SKU-00001', qty: 2 }, { sku: 'SKU-00012', qty: 3 }], grams: 1606, tier: 'parcel' },
      { lines: [{ sku: 'SKU-00008', qty: 3 }, { sku: 'SKU-00019', qty: 1 }, { sku: 'SKU-00030', qty: 2 }], grams: 4051, tier: 'freight' },
      { lines: [{ sku: 'SKU-00015', qty: 1 }, { sku: 'SKU-00026', qty: 2 }], grams: 2599, tier: 'freight' },
      { lines: [{ sku: 'SKU-00022', qty: 2 }, { sku: 'SKU-00033', qty: 3 }, { sku: 'SKU-00004', qty: 1 }], grams: 5679, tier: 'freight' },
      { lines: [{ sku: 'SKU-00029', qty: 3 }, { sku: 'SKU-00040', qty: 1 }], grams: 4859, tier: 'freight' },
      { lines: [{ sku: 'SKU-00036', qty: 1 }, { sku: 'SKU-00007', qty: 2 }, { sku: 'SKU-00018', qty: 3 }], grams: 4088, tier: 'freight' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-14] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const packed = packOrder(buildOrder(600 + i, c.lines));
      console.log(`[ord-14]   got grams=${packed.grams} tier=${packed.tier}`);
      console.log(`[ord-14]   want grams=${c.grams} tier=${c.tier}`);
      assert.equal(packed.grams, c.grams);
      assert.equal(packed.tier, c.tier);
    }
  });

  test('pack order batch 3', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00026', qty: 1 }, { sku: 'SKU-00037', qty: 2 }], grams: 3820, tier: 'freight' },
      { lines: [{ sku: 'SKU-00033', qty: 2 }, { sku: 'SKU-00004', qty: 3 }, { sku: 'SKU-00015', qty: 1 }], grams: 3681, tier: 'freight' },
      { lines: [{ sku: 'SKU-00040', qty: 3 }, { sku: 'SKU-00011', qty: 1 }], grams: 5007, tier: 'freight' },
      { lines: [{ sku: 'SKU-00007', qty: 1 }, { sku: 'SKU-00018', qty: 2 }, { sku: 'SKU-00029', qty: 3 }], grams: 5050, tier: 'freight' },
      { lines: [{ sku: 'SKU-00014', qty: 2 }, { sku: 'SKU-00025', qty: 3 }], grams: 4011, tier: 'freight' },
      { lines: [{ sku: 'SKU-00021', qty: 3 }, { sku: 'SKU-00032', qty: 1 }, { sku: 'SKU-00003', qty: 2 }], grams: 3977, tier: 'freight' },
      { lines: [{ sku: 'SKU-00028', qty: 1 }, { sku: 'SKU-00039', qty: 2 }], grams: 4042, tier: 'freight' },
      { lines: [{ sku: 'SKU-00035', qty: 2 }, { sku: 'SKU-00006', qty: 3 }, { sku: 'SKU-00017', qty: 1 }], grams: 4125, tier: 'freight' },
      { lines: [{ sku: 'SKU-00002', qty: 3 }, { sku: 'SKU-00013', qty: 1 }], grams: 863, tier: 'parcel' },
      { lines: [{ sku: 'SKU-00009', qty: 1 }, { sku: 'SKU-00020', qty: 2 }, { sku: 'SKU-00031', qty: 3 }], grams: 5494, tier: 'freight' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-15] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const packed = packOrder(buildOrder(600 + i, c.lines));
      console.log(`[ord-15]   got grams=${packed.grams} tier=${packed.tier}`);
      console.log(`[ord-15]   want grams=${c.grams} tier=${c.tier}`);
      assert.equal(packed.grams, c.grams);
      assert.equal(packed.tier, c.tier);
    }
  });

  test('pack order batch 4', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00039', qty: 1 }, { sku: 'SKU-00010', qty: 2 }], grams: 2303, tier: 'freight' },
      { lines: [{ sku: 'SKU-00006', qty: 2 }, { sku: 'SKU-00017', qty: 3 }, { sku: 'SKU-00028', qty: 1 }], grams: 3607, tier: 'freight' },
      { lines: [{ sku: 'SKU-00013', qty: 3 }, { sku: 'SKU-00024', qty: 1 }], grams: 2491, tier: 'freight' },
      { lines: [{ sku: 'SKU-00020', qty: 1 }, { sku: 'SKU-00031', qty: 2 }, { sku: 'SKU-00002', qty: 3 }], grams: 3496, tier: 'freight' },
      { lines: [{ sku: 'SKU-00027', qty: 2 }, { sku: 'SKU-00038', qty: 3 }], grams: 6416, tier: 'freight' },
      { lines: [{ sku: 'SKU-00034', qty: 3 }, { sku: 'SKU-00005', qty: 1 }, { sku: 'SKU-00016', qty: 2 }], grams: 5383, tier: 'freight' },
      { lines: [{ sku: 'SKU-00001', qty: 1 }, { sku: 'SKU-00012', qty: 2 }], grams: 1045, tier: 'parcel' },
      { lines: [{ sku: 'SKU-00008', qty: 2 }, { sku: 'SKU-00019', qty: 3 }, { sku: 'SKU-00030', qty: 1 }], grams: 4051, tier: 'freight' },
      { lines: [{ sku: 'SKU-00015', qty: 3 }, { sku: 'SKU-00026', qty: 1 }], grams: 2787, tier: 'freight' },
      { lines: [{ sku: 'SKU-00022', qty: 1 }, { sku: 'SKU-00033', qty: 2 }, { sku: 'SKU-00004', qty: 3 }], grams: 3940, tier: 'freight' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-16] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const packed = packOrder(buildOrder(600 + i, c.lines));
      console.log(`[ord-16]   got grams=${packed.grams} tier=${packed.tier}`);
      console.log(`[ord-16]   want grams=${c.grams} tier=${c.tier}`);
      assert.equal(packed.grams, c.grams);
      assert.equal(packed.tier, c.tier);
    }
  });

  test('pack order batch 5', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00012', qty: 1 }, { sku: 'SKU-00023', qty: 2 }], grams: 2266, tier: 'freight' },
      { lines: [{ sku: 'SKU-00019', qty: 2 }, { sku: 'SKU-00030', qty: 3 }, { sku: 'SKU-00001', qty: 1 }], grams: 5013, tier: 'freight' },
      { lines: [{ sku: 'SKU-00026', qty: 3 }, { sku: 'SKU-00037', qty: 1 }], grams: 4415, tier: 'freight' },
      { lines: [{ sku: 'SKU-00033', qty: 1 }, { sku: 'SKU-00004', qty: 2 }, { sku: 'SKU-00015', qty: 3 }], grams: 3422, tier: 'freight' },
      { lines: [{ sku: 'SKU-00040', qty: 2 }, { sku: 'SKU-00011', qty: 3 }], grams: 4381, tier: 'freight' },
      { lines: [{ sku: 'SKU-00007', qty: 3 }, { sku: 'SKU-00018', qty: 1 }, { sku: 'SKU-00029', qty: 2 }], grams: 3829, tier: 'freight' },
      { lines: [{ sku: 'SKU-00014', qty: 1 }, { sku: 'SKU-00025', qty: 2 }], grams: 2488, tier: 'freight' },
      { lines: [{ sku: 'SKU-00021', qty: 2 }, { sku: 'SKU-00032', qty: 3 }, { sku: 'SKU-00003', qty: 1 }], grams: 5457, tier: 'freight' },
      { lines: [{ sku: 'SKU-00028', qty: 3 }, { sku: 'SKU-00039', qty: 1 }], grams: 4711, tier: 'freight' },
      { lines: [{ sku: 'SKU-00035', qty: 1 }, { sku: 'SKU-00006', qty: 2 }, { sku: 'SKU-00017', qty: 3 }], grams: 3866, tier: 'freight' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-17] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const packed = packOrder(buildOrder(600 + i, c.lines));
      console.log(`[ord-17]   got grams=${packed.grams} tier=${packed.tier}`);
      console.log(`[ord-17]   want grams=${c.grams} tier=${c.tier}`);
      assert.equal(packed.grams, c.grams);
      assert.equal(packed.tier, c.tier);
    }
  });

  test('pack order batch 6', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00025', qty: 1 }, { sku: 'SKU-00036', qty: 2 }], grams: 3709, tier: 'freight' },
      { lines: [{ sku: 'SKU-00032', qty: 2 }, { sku: 'SKU-00003', qty: 3 }, { sku: 'SKU-00014', qty: 1 }], grams: 3459, tier: 'freight' },
      { lines: [{ sku: 'SKU-00039', qty: 3 }, { sku: 'SKU-00010', qty: 1 }], grams: 4859, tier: 'freight' },
      { lines: [{ sku: 'SKU-00006', qty: 1 }, { sku: 'SKU-00017', qty: 2 }, { sku: 'SKU-00028', qty: 3 }], grams: 4828, tier: 'freight' },
      { lines: [{ sku: 'SKU-00013', qty: 2 }, { sku: 'SKU-00024', qty: 3 }], grams: 3826, tier: 'freight' },
      { lines: [{ sku: 'SKU-00020', qty: 3 }, { sku: 'SKU-00031', qty: 1 }, { sku: 'SKU-00002', qty: 2 }], grams: 3755, tier: 'freight' },
      { lines: [{ sku: 'SKU-00027', qty: 1 }, { sku: 'SKU-00038', qty: 2 }], grams: 3931, tier: 'freight' },
      { lines: [{ sku: 'SKU-00034', qty: 2 }, { sku: 'SKU-00005', qty: 3 }, { sku: 'SKU-00016', qty: 1 }], grams: 3903, tier: 'freight' },
      { lines: [{ sku: 'SKU-00001', qty: 3 }, { sku: 'SKU-00012', qty: 1 }], grams: 715, tier: 'parcel' },
      { lines: [{ sku: 'SKU-00008', qty: 1 }, { sku: 'SKU-00019', qty: 2 }, { sku: 'SKU-00030', qty: 3 }], grams: 5272, tier: 'freight' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-18] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const packed = packOrder(buildOrder(600 + i, c.lines));
      console.log(`[ord-18]   got grams=${packed.grams} tier=${packed.tier}`);
      console.log(`[ord-18]   want grams=${c.grams} tier=${c.tier}`);
      assert.equal(packed.grams, c.grams);
      assert.equal(packed.tier, c.tier);
    }
  });

});

describe('order subtotals', () => {
  test('subtotal batch 1', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00039', qty: 1 }, { sku: 'SKU-00010', qty: 2 }], cents: 3695 },
      { lines: [{ sku: 'SKU-00006', qty: 2 }, { sku: 'SKU-00017', qty: 3 }, { sku: 'SKU-00028', qty: 1 }], cents: 5905 },
      { lines: [{ sku: 'SKU-00013', qty: 3 }, { sku: 'SKU-00024', qty: 1 }], cents: 4065 },
      { lines: [{ sku: 'SKU-00020', qty: 1 }, { sku: 'SKU-00031', qty: 2 }, { sku: 'SKU-00002', qty: 3 }], cents: 5740 },
      { lines: [{ sku: 'SKU-00027', qty: 2 }, { sku: 'SKU-00038', qty: 3 }], cents: 9990 },
      { lines: [{ sku: 'SKU-00034', qty: 3 }, { sku: 'SKU-00005', qty: 1 }, { sku: 'SKU-00016', qty: 2 }], cents: 8545 },
      { lines: [{ sku: 'SKU-00001', qty: 1 }, { sku: 'SKU-00012', qty: 2 }], cents: 1825 },
      { lines: [{ sku: 'SKU-00008', qty: 2 }, { sku: 'SKU-00019', qty: 3 }, { sku: 'SKU-00030', qty: 1 }], cents: 6565 },
      { lines: [{ sku: 'SKU-00015', qty: 3 }, { sku: 'SKU-00026', qty: 1 }], cents: 4505 },
      { lines: [{ sku: 'SKU-00022', qty: 1 }, { sku: 'SKU-00033', qty: 2 }, { sku: 'SKU-00004', qty: 3 }], cents: 6400 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-19] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const order = buildOrder(400 + i, c.lines);
      console.log(`[ord-19]   got cents=${orderSubtotal(order)}`);
      console.log(`[ord-19]   want cents=${c.cents}`);
      assert.equal(orderSubtotal(order), c.cents);
    }
  });

  test('subtotal batch 2', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00012', qty: 1 }, { sku: 'SKU-00023', qty: 2 }], cents: 3640 },
      { lines: [{ sku: 'SKU-00019', qty: 2 }, { sku: 'SKU-00030', qty: 3 }, { sku: 'SKU-00001', qty: 1 }], cents: 7995 },
      { lines: [{ sku: 'SKU-00026', qty: 3 }, { sku: 'SKU-00037', qty: 1 }], cents: 6925 },
      { lines: [{ sku: 'SKU-00033', qty: 1 }, { sku: 'SKU-00004', qty: 2 }, { sku: 'SKU-00015', qty: 3 }], cents: 5630 },
      { lines: [{ sku: 'SKU-00040', qty: 2 }, { sku: 'SKU-00011', qty: 3 }], cents: 6965 },
      { lines: [{ sku: 'SKU-00007', qty: 3 }, { sku: 'SKU-00018', qty: 1 }, { sku: 'SKU-00029', qty: 2 }], cents: 6235 },
      { lines: [{ sku: 'SKU-00014', qty: 1 }, { sku: 'SKU-00025', qty: 2 }], cents: 3970 },
      { lines: [{ sku: 'SKU-00021', qty: 2 }, { sku: 'SKU-00032', qty: 3 }, { sku: 'SKU-00003', qty: 1 }], cents: 8655 },
      { lines: [{ sku: 'SKU-00028', qty: 3 }, { sku: 'SKU-00039', qty: 1 }], cents: 7365 },
      { lines: [{ sku: 'SKU-00035', qty: 1 }, { sku: 'SKU-00006', qty: 2 }, { sku: 'SKU-00017', qty: 3 }], cents: 6290 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-20] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const order = buildOrder(400 + i, c.lines);
      console.log(`[ord-20]   got cents=${orderSubtotal(order)}`);
      console.log(`[ord-20]   want cents=${c.cents}`);
      assert.equal(orderSubtotal(order), c.cents);
    }
  });

  test('subtotal batch 3', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00025', qty: 1 }, { sku: 'SKU-00036', qty: 2 }], cents: 5785 },
      { lines: [{ sku: 'SKU-00032', qty: 2 }, { sku: 'SKU-00003', qty: 3 }, { sku: 'SKU-00014', qty: 1 }], cents: 5685 },
      { lines: [{ sku: 'SKU-00039', qty: 3 }, { sku: 'SKU-00010', qty: 1 }], cents: 7585 },
      { lines: [{ sku: 'SKU-00006', qty: 1 }, { sku: 'SKU-00017', qty: 2 }, { sku: 'SKU-00028', qty: 3 }], cents: 7720 },
      { lines: [{ sku: 'SKU-00013', qty: 2 }, { sku: 'SKU-00024', qty: 3 }], cents: 6140 },
      { lines: [{ sku: 'SKU-00020', qty: 3 }, { sku: 'SKU-00031', qty: 1 }, { sku: 'SKU-00002', qty: 2 }], cents: 6125 },
      { lines: [{ sku: 'SKU-00027', qty: 1 }, { sku: 'SKU-00038', qty: 2 }], cents: 6115 },
      { lines: [{ sku: 'SKU-00034', qty: 2 }, { sku: 'SKU-00005', qty: 3 }, { sku: 'SKU-00016', qty: 1 }], cents: 6345 },
      { lines: [{ sku: 'SKU-00001', qty: 3 }, { sku: 'SKU-00012', qty: 1 }], cents: 1425 },
      { lines: [{ sku: 'SKU-00008', qty: 1 }, { sku: 'SKU-00019', qty: 2 }, { sku: 'SKU-00030', qty: 3 }], cents: 8380 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-21] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const order = buildOrder(400 + i, c.lines);
      console.log(`[ord-21]   got cents=${orderSubtotal(order)}`);
      console.log(`[ord-21]   want cents=${c.cents}`);
      assert.equal(orderSubtotal(order), c.cents);
    }
  });

  test('subtotal batch 4', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00038', qty: 1 }, { sku: 'SKU-00009', qty: 2 }], cents: 3530 },
      { lines: [{ sku: 'SKU-00005', qty: 2 }, { sku: 'SKU-00016', qty: 3 }, { sku: 'SKU-00027', qty: 1 }], cents: 5575 },
      { lines: [{ sku: 'SKU-00012', qty: 3 }, { sku: 'SKU-00023', qty: 1 }], cents: 3845 },
      { lines: [{ sku: 'SKU-00019', qty: 1 }, { sku: 'SKU-00030', qty: 2 }, { sku: 'SKU-00001', qty: 3 }], cents: 5410 },
      { lines: [{ sku: 'SKU-00026', qty: 2 }, { sku: 'SKU-00037', qty: 3 }], cents: 9715 },
      { lines: [{ sku: 'SKU-00033', qty: 3 }, { sku: 'SKU-00004', qty: 1 }, { sku: 'SKU-00015', qty: 2 }], cents: 8215 },
      { lines: [{ sku: 'SKU-00040', qty: 1 }, { sku: 'SKU-00011', qty: 2 }], cents: 3860 },
      { lines: [{ sku: 'SKU-00007', qty: 2 }, { sku: 'SKU-00018', qty: 3 }, { sku: 'SKU-00029', qty: 1 }], cents: 6235 },
      { lines: [{ sku: 'SKU-00014', qty: 3 }, { sku: 'SKU-00025', qty: 1 }], cents: 4285 },
      { lines: [{ sku: 'SKU-00021', qty: 1 }, { sku: 'SKU-00032', qty: 2 }, { sku: 'SKU-00003', qty: 3 }], cents: 6070 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-22] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const order = buildOrder(400 + i, c.lines);
      console.log(`[ord-22]   got cents=${orderSubtotal(order)}`);
      console.log(`[ord-22]   want cents=${c.cents}`);
      assert.equal(orderSubtotal(order), c.cents);
    }
  });

  test('subtotal batch 5', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00011', qty: 1 }, { sku: 'SKU-00022', qty: 2 }], cents: 3475 },
      { lines: [{ sku: 'SKU-00018', qty: 2 }, { sku: 'SKU-00029', qty: 3 }, { sku: 'SKU-00040', qty: 1 }], cents: 9865 },
      { lines: [{ sku: 'SKU-00025', qty: 3 }, { sku: 'SKU-00036', qty: 1 }], cents: 6705 },
      { lines: [{ sku: 'SKU-00032', qty: 1 }, { sku: 'SKU-00003', qty: 2 }, { sku: 'SKU-00014', qty: 3 }], cents: 5300 },
      { lines: [{ sku: 'SKU-00039', qty: 2 }, { sku: 'SKU-00010', qty: 3 }], cents: 6690 },
      { lines: [{ sku: 'SKU-00006', qty: 3 }, { sku: 'SKU-00017', qty: 1 }, { sku: 'SKU-00028', qty: 2 }], cents: 5905 },
      { lines: [{ sku: 'SKU-00013', qty: 1 }, { sku: 'SKU-00024', qty: 2 }], cents: 3805 },
      { lines: [{ sku: 'SKU-00020', qty: 2 }, { sku: 'SKU-00031', qty: 3 }, { sku: 'SKU-00002', qty: 1 }], cents: 8325 },
      { lines: [{ sku: 'SKU-00027', qty: 3 }, { sku: 'SKU-00038', qty: 1 }], cents: 7145 },
      { lines: [{ sku: 'SKU-00034', qty: 1 }, { sku: 'SKU-00005', qty: 2 }, { sku: 'SKU-00016', qty: 3 }], cents: 5960 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-23] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const order = buildOrder(400 + i, c.lines);
      console.log(`[ord-23]   got cents=${orderSubtotal(order)}`);
      console.log(`[ord-23]   want cents=${c.cents}`);
      assert.equal(orderSubtotal(order), c.cents);
    }
  });

  test('subtotal batch 6', () => {
    const cases = [
      { lines: [{ sku: 'SKU-00024', qty: 1 }, { sku: 'SKU-00035', qty: 2 }], cents: 5620 },
      { lines: [{ sku: 'SKU-00031', qty: 2 }, { sku: 'SKU-00002', qty: 3 }, { sku: 'SKU-00013', qty: 1 }], cents: 5355 },
      { lines: [{ sku: 'SKU-00038', qty: 3 }, { sku: 'SKU-00009', qty: 1 }], cents: 7365 },
      { lines: [{ sku: 'SKU-00005', qty: 1 }, { sku: 'SKU-00016', qty: 2 }, { sku: 'SKU-00027', qty: 3 }], cents: 7390 },
      { lines: [{ sku: 'SKU-00012', qty: 2 }, { sku: 'SKU-00023', qty: 3 }], cents: 5865 },
      { lines: [{ sku: 'SKU-00019', qty: 3 }, { sku: 'SKU-00030', qty: 1 }, { sku: 'SKU-00001', qty: 2 }], cents: 5795 },
      { lines: [{ sku: 'SKU-00026', qty: 1 }, { sku: 'SKU-00037', qty: 2 }], cents: 5950 },
      { lines: [{ sku: 'SKU-00033', qty: 2 }, { sku: 'SKU-00004', qty: 3 }, { sku: 'SKU-00015', qty: 1 }], cents: 6015 },
      { lines: [{ sku: 'SKU-00040', qty: 3 }, { sku: 'SKU-00011', qty: 1 }], cents: 7805 },
      { lines: [{ sku: 'SKU-00007', qty: 1 }, { sku: 'SKU-00018', qty: 2 }, { sku: 'SKU-00029', qty: 3 }], cents: 8050 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[ord-24] case ${i + 1}/${cases.length}: lines=${c.lines.length}`);
      const order = buildOrder(400 + i, c.lines);
      console.log(`[ord-24]   got cents=${orderSubtotal(order)}`);
      console.log(`[ord-24]   want cents=${c.cents}`);
      assert.equal(orderSubtotal(order), c.cents);
    }
  });

});
