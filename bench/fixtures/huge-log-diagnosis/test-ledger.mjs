import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { balance, entryCount, openLedger, record, statement } from './ledger.mjs';
import { formatCents } from './util.mjs';

describe('cents formatting', () => {
  test('formatCents batch 1', () => {
    const cases = [
      { cents: -31000, text: '-$310.00' },
      { cents: -29248, text: '-$292.48' },
      { cents: -27522, text: '-$275.22' },
      { cents: -25770, text: '-$257.70' },
      { cents: -24044, text: '-$240.44' },
      { cents: -22292, text: '-$222.92' },
      { cents: -20566, text: '-$205.66' },
      { cents: -18814, text: '-$188.14' },
      { cents: -17088, text: '-$170.88' },
      { cents: -15336, text: '-$153.36' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-01] case ${i + 1}/${cases.length}: cents=${c.cents}`);
      const got = formatCents(c.cents);
      console.log(`[led-01]   got text=${got}`);
      console.log(`[led-01]   want text=${c.text}`);
      assert.equal(got, c.text);
    }
  });

  test('formatCents batch 2', () => {
    const cases = [
      { cents: -13610, text: '-$136.10' },
      { cents: -11858, text: '-$118.58' },
      { cents: -10132, text: '-$101.32' },
      { cents: -8380, text: '-$83.80' },
      { cents: -6654, text: '-$66.54' },
      { cents: -4902, text: '-$49.02' },
      { cents: -3176, text: '-$31.76' },
      { cents: -1424, text: '-$14.24' },
      { cents: 302, text: '$3.02' },
      { cents: 2054, text: '$20.54' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-02] case ${i + 1}/${cases.length}: cents=${c.cents}`);
      const got = formatCents(c.cents);
      console.log(`[led-02]   got text=${got}`);
      console.log(`[led-02]   want text=${c.text}`);
      assert.equal(got, c.text);
    }
  });

  test('formatCents batch 3', () => {
    const cases = [
      { cents: 3780, text: '$37.80' },
      { cents: 5532, text: '$55.32' },
      { cents: 7258, text: '$72.58' },
      { cents: 9010, text: '$90.10' },
      { cents: 10736, text: '$107.36' },
      { cents: 12488, text: '$124.88' },
      { cents: 14214, text: '$142.14' },
      { cents: 15966, text: '$159.66' },
      { cents: 17692, text: '$176.92' },
      { cents: 19444, text: '$194.44' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-03] case ${i + 1}/${cases.length}: cents=${c.cents}`);
      const got = formatCents(c.cents);
      console.log(`[led-03]   got text=${got}`);
      console.log(`[led-03]   want text=${c.text}`);
      assert.equal(got, c.text);
    }
  });

  test('formatCents batch 4', () => {
    const cases = [
      { cents: 21170, text: '$211.70' },
      { cents: 22922, text: '$229.22' },
      { cents: 24648, text: '$246.48' },
      { cents: 26400, text: '$264.00' },
      { cents: 28126, text: '$281.26' },
      { cents: 29878, text: '$298.78' },
      { cents: 31604, text: '$316.04' },
      { cents: 33356, text: '$333.56' },
      { cents: 35082, text: '$350.82' },
      { cents: 36834, text: '$368.34' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-04] case ${i + 1}/${cases.length}: cents=${c.cents}`);
      const got = formatCents(c.cents);
      console.log(`[led-04]   got text=${got}`);
      console.log(`[led-04]   want text=${c.text}`);
      assert.equal(got, c.text);
    }
  });

  test('formatCents batch 5', () => {
    const cases = [
      { cents: 38560, text: '$385.60' },
      { cents: 40312, text: '$403.12' },
      { cents: 42038, text: '$420.38' },
      { cents: 43790, text: '$437.90' },
      { cents: 45516, text: '$455.16' },
      { cents: 47268, text: '$472.68' },
      { cents: 48994, text: '$489.94' },
      { cents: 50746, text: '$507.46' },
      { cents: 52472, text: '$524.72' },
      { cents: 54224, text: '$542.24' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-05] case ${i + 1}/${cases.length}: cents=${c.cents}`);
      const got = formatCents(c.cents);
      console.log(`[led-05]   got text=${got}`);
      console.log(`[led-05]   want text=${c.text}`);
      assert.equal(got, c.text);
    }
  });

  test('formatCents batch 6', () => {
    const cases = [
      { cents: 55950, text: '$559.50' },
      { cents: 57702, text: '$577.02' },
      { cents: 59428, text: '$594.28' },
      { cents: 61180, text: '$611.80' },
      { cents: 62906, text: '$629.06' },
      { cents: 64658, text: '$646.58' },
      { cents: 66384, text: '$663.84' },
      { cents: 68136, text: '$681.36' },
      { cents: 69862, text: '$698.62' },
      { cents: 71614, text: '$716.14' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-06] case ${i + 1}/${cases.length}: cents=${c.cents}`);
      const got = formatCents(c.cents);
      console.log(`[led-06]   got text=${got}`);
      console.log(`[led-06]   want text=${c.text}`);
      assert.equal(got, c.text);
    }
  });

});

describe('balances accumulate entries', () => {
  test('balance batch 1', () => {
    const cases = [
      { cents: [-4000, 853, 5706], total: 2559 },
      { cents: [-413, 4440, 9293, 14146], total: 27466 },
      { cents: [3174, 8027, 12880, 17733, 22586], total: 64400 },
      { cents: [6761, 11614, 16467], total: 34842 },
      { cents: [10348, 15201, 20054, 24907], total: 70510 },
      { cents: [13935, 18788, 23641, 28494, 33347], total: 118205 },
      { cents: [17522, 22375, 27228], total: 67125 },
      { cents: [21109, 25962, 30815, 35668], total: 113554 },
      { cents: [24696, 29549, 34402, 39255, 44108], total: 172010 },
      { cents: [28283, 33136, 37989], total: 99408 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-07] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      console.log(`[led-07]   got balance=${balance(ledger)}`);
      console.log(`[led-07]   want balance=${c.total}`);
      assert.equal(balance(ledger), c.total);
    }
  });

  test('balance batch 2', () => {
    const cases = [
      { cents: [2541, 7394, 12247], total: 22182 },
      { cents: [6128, 10981, 15834, 20687], total: 53630 },
      { cents: [9715, 14568, 19421, 24274, 29127], total: 97105 },
      { cents: [13302, 18155, 23008], total: 54465 },
      { cents: [16889, 21742, 26595, 31448], total: 96674 },
      { cents: [20476, 25329, 30182, 35035, 39888], total: 150910 },
      { cents: [24063, 28916, 33769], total: 86748 },
      { cents: [27650, 32503, 37356, 42209], total: 139718 },
      { cents: [31237, 36090, 40943, 45796, 50649], total: 204715 },
      { cents: [34824, 39677, 44530], total: 119031 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-08] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      console.log(`[led-08]   got balance=${balance(ledger)}`);
      console.log(`[led-08]   want balance=${c.total}`);
      assert.equal(balance(ledger), c.total);
    }
  });

  test('balance batch 3', () => {
    const cases = [
      { cents: [9082, 13935, 18788], total: 41805 },
      { cents: [12669, 17522, 22375, 27228], total: 79794 },
      { cents: [16256, 21109, 25962, 30815, 35668], total: 129810 },
      { cents: [19843, 24696, 29549], total: 74088 },
      { cents: [23430, 28283, 33136, 37989], total: 122838 },
      { cents: [27017, 31870, 36723, 41576, 46429], total: 183615 },
      { cents: [30604, 35457, 40310], total: 106371 },
      { cents: [34191, 39044, 43897, 48750], total: 165882 },
      { cents: [37778, 42631, 47484, 52337, 57190], total: 237420 },
      { cents: [41365, 46218, 51071], total: 138654 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-09] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      console.log(`[led-09]   got balance=${balance(ledger)}`);
      console.log(`[led-09]   want balance=${c.total}`);
      assert.equal(balance(ledger), c.total);
    }
  });

  test('balance batch 4', () => {
    const cases = [
      { cents: [15623, 20476, 25329], total: 61428 },
      { cents: [19210, 24063, 28916, 33769], total: 105958 },
      { cents: [22797, 27650, 32503, 37356, 42209], total: 162515 },
      { cents: [26384, 31237, 36090], total: 93711 },
      { cents: [29971, 34824, 39677, 44530], total: 149002 },
      { cents: [33558, 38411, 43264, 48117, 52970], total: 216320 },
      { cents: [37145, 41998, 46851], total: 125994 },
      { cents: [40732, 45585, 50438, 55291], total: 192046 },
      { cents: [44319, 49172, 54025, 58878, 63731], total: 270125 },
      { cents: [47906, 52759, 57612], total: 158277 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-10] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      console.log(`[led-10]   got balance=${balance(ledger)}`);
      console.log(`[led-10]   want balance=${c.total}`);
      assert.equal(balance(ledger), c.total);
    }
  });

  test('balance batch 5', () => {
    const cases = [
      { cents: [22164, 27017, 31870], total: 81051 },
      { cents: [25751, 30604, 35457, 40310], total: 132122 },
      { cents: [29338, 34191, 39044, 43897, 48750], total: 195220 },
      { cents: [32925, 37778, 42631], total: 113334 },
      { cents: [36512, 41365, 46218, 51071], total: 175166 },
      { cents: [40099, 44952, 49805, 54658, 59511], total: 249025 },
      { cents: [43686, 48539, 53392], total: 145617 },
      { cents: [47273, 52126, 56979, 61832], total: 218210 },
      { cents: [50860, 55713, 60566, 65419, 70272], total: 302830 },
      { cents: [54447, 59300, 64153], total: 177900 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-11] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      console.log(`[led-11]   got balance=${balance(ledger)}`);
      console.log(`[led-11]   want balance=${c.total}`);
      assert.equal(balance(ledger), c.total);
    }
  });

  test('balance batch 6', () => {
    const cases = [
      { cents: [28705, 33558, 38411], total: 100674 },
      { cents: [32292, 37145, 41998, 46851], total: 158286 },
      { cents: [35879, 40732, 45585, 50438, 55291], total: 227925 },
      { cents: [39466, 44319, 49172], total: 132957 },
      { cents: [43053, 47906, 52759, 57612], total: 201330 },
      { cents: [46640, 51493, 56346, 61199, 66052], total: 281730 },
      { cents: [50227, 55080, 59933], total: 165240 },
      { cents: [53814, 58667, 63520, 68373], total: 244374 },
      { cents: [57401, 62254, 67107, 71960, 76813], total: 335535 },
      { cents: [60988, 65841, 70694], total: 197523 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-12] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      console.log(`[led-12]   got balance=${balance(ledger)}`);
      console.log(`[led-12]   want balance=${c.total}`);
      assert.equal(balance(ledger), c.total);
    }
  });

});

describe('statements close with the running total', () => {
  test('statement batch 1', () => {
    const cases = [
      { cents: [9082, 13935, 18788], lines: 5, last: '  total $418.05' },
      { cents: [12669, 17522, 22375, 27228], lines: 6, last: '  total $797.94' },
      { cents: [16256, 21109, 25962, 30815, 35668], lines: 7, last: '  total $1298.10' },
      { cents: [19843, 24696, 29549], lines: 5, last: '  total $740.88' },
      { cents: [23430, 28283, 33136, 37989], lines: 6, last: '  total $1228.38' },
      { cents: [27017, 31870, 36723, 41576, 46429], lines: 7, last: '  total $1836.15' },
      { cents: [30604, 35457, 40310], lines: 5, last: '  total $1063.71' },
      { cents: [34191, 39044, 43897, 48750], lines: 6, last: '  total $1658.82' },
      { cents: [37778, 42631, 47484, 52337, 57190], lines: 7, last: '  total $2374.20' },
      { cents: [41365, 46218, 51071], lines: 5, last: '  total $1386.54' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-13] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      const lines = statement(ledger);
      console.log(`[led-13]   got lines=${lines.length} last=${lines[lines.length - 1]}`);
      console.log(`[led-13]   want lines=${c.lines} last=${c.last}`);
      assert.equal(lines.length, c.lines);
      assert.equal(lines[lines.length - 1], c.last);
    }
  });

  test('statement batch 2', () => {
    const cases = [
      { cents: [15623, 20476, 25329], lines: 5, last: '  total $614.28' },
      { cents: [19210, 24063, 28916, 33769], lines: 6, last: '  total $1059.58' },
      { cents: [22797, 27650, 32503, 37356, 42209], lines: 7, last: '  total $1625.15' },
      { cents: [26384, 31237, 36090], lines: 5, last: '  total $937.11' },
      { cents: [29971, 34824, 39677, 44530], lines: 6, last: '  total $1490.02' },
      { cents: [33558, 38411, 43264, 48117, 52970], lines: 7, last: '  total $2163.20' },
      { cents: [37145, 41998, 46851], lines: 5, last: '  total $1259.94' },
      { cents: [40732, 45585, 50438, 55291], lines: 6, last: '  total $1920.46' },
      { cents: [44319, 49172, 54025, 58878, 63731], lines: 7, last: '  total $2701.25' },
      { cents: [47906, 52759, 57612], lines: 5, last: '  total $1582.77' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-14] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      const lines = statement(ledger);
      console.log(`[led-14]   got lines=${lines.length} last=${lines[lines.length - 1]}`);
      console.log(`[led-14]   want lines=${c.lines} last=${c.last}`);
      assert.equal(lines.length, c.lines);
      assert.equal(lines[lines.length - 1], c.last);
    }
  });

  test('statement batch 3', () => {
    const cases = [
      { cents: [22164, 27017, 31870], lines: 5, last: '  total $810.51' },
      { cents: [25751, 30604, 35457, 40310], lines: 6, last: '  total $1321.22' },
      { cents: [29338, 34191, 39044, 43897, 48750], lines: 7, last: '  total $1952.20' },
      { cents: [32925, 37778, 42631], lines: 5, last: '  total $1133.34' },
      { cents: [36512, 41365, 46218, 51071], lines: 6, last: '  total $1751.66' },
      { cents: [40099, 44952, 49805, 54658, 59511], lines: 7, last: '  total $2490.25' },
      { cents: [43686, 48539, 53392], lines: 5, last: '  total $1456.17' },
      { cents: [47273, 52126, 56979, 61832], lines: 6, last: '  total $2182.10' },
      { cents: [50860, 55713, 60566, 65419, 70272], lines: 7, last: '  total $3028.30' },
      { cents: [54447, 59300, 64153], lines: 5, last: '  total $1779.00' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-15] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      const lines = statement(ledger);
      console.log(`[led-15]   got lines=${lines.length} last=${lines[lines.length - 1]}`);
      console.log(`[led-15]   want lines=${c.lines} last=${c.last}`);
      assert.equal(lines.length, c.lines);
      assert.equal(lines[lines.length - 1], c.last);
    }
  });

  test('statement batch 4', () => {
    const cases = [
      { cents: [28705, 33558, 38411], lines: 5, last: '  total $1006.74' },
      { cents: [32292, 37145, 41998, 46851], lines: 6, last: '  total $1582.86' },
      { cents: [35879, 40732, 45585, 50438, 55291], lines: 7, last: '  total $2279.25' },
      { cents: [39466, 44319, 49172], lines: 5, last: '  total $1329.57' },
      { cents: [43053, 47906, 52759, 57612], lines: 6, last: '  total $2013.30' },
      { cents: [46640, 51493, 56346, 61199, 66052], lines: 7, last: '  total $2817.30' },
      { cents: [50227, 55080, 59933], lines: 5, last: '  total $1652.40' },
      { cents: [53814, 58667, 63520, 68373], lines: 6, last: '  total $2443.74' },
      { cents: [57401, 62254, 67107, 71960, 76813], lines: 7, last: '  total $3355.35' },
      { cents: [60988, 65841, 70694], lines: 5, last: '  total $1975.23' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-16] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      const lines = statement(ledger);
      console.log(`[led-16]   got lines=${lines.length} last=${lines[lines.length - 1]}`);
      console.log(`[led-16]   want lines=${c.lines} last=${c.last}`);
      assert.equal(lines.length, c.lines);
      assert.equal(lines[lines.length - 1], c.last);
    }
  });

  test('statement batch 5', () => {
    const cases = [
      { cents: [35246, 40099, 44952], lines: 5, last: '  total $1202.97' },
      { cents: [38833, 43686, 48539, 53392], lines: 6, last: '  total $1844.50' },
      { cents: [42420, 47273, 52126, 56979, 61832], lines: 7, last: '  total $2606.30' },
      { cents: [46007, 50860, 55713], lines: 5, last: '  total $1525.80' },
      { cents: [49594, 54447, 59300, 64153], lines: 6, last: '  total $2274.94' },
      { cents: [53181, 58034, 62887, 67740, 72593], lines: 7, last: '  total $3144.35' },
      { cents: [56768, 61621, 66474], lines: 5, last: '  total $1848.63' },
      { cents: [60355, 65208, 70061, 74914], lines: 6, last: '  total $2705.38' },
      { cents: [63942, 68795, 73648, 78501, 83354], lines: 7, last: '  total $3682.40' },
      { cents: [67529, 72382, 77235], lines: 5, last: '  total $2171.46' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-17] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      const lines = statement(ledger);
      console.log(`[led-17]   got lines=${lines.length} last=${lines[lines.length - 1]}`);
      console.log(`[led-17]   want lines=${c.lines} last=${c.last}`);
      assert.equal(lines.length, c.lines);
      assert.equal(lines[lines.length - 1], c.last);
    }
  });

  test('statement batch 6', () => {
    const cases = [
      { cents: [41787, 46640, 51493], lines: 5, last: '  total $1399.20' },
      { cents: [45374, 50227, 55080, 59933], lines: 6, last: '  total $2106.14' },
      { cents: [48961, 53814, 58667, 63520, 68373], lines: 7, last: '  total $2933.35' },
      { cents: [52548, 57401, 62254], lines: 5, last: '  total $1722.03' },
      { cents: [56135, 60988, 65841, 70694], lines: 6, last: '  total $2536.58' },
      { cents: [59722, 64575, 69428, 74281, 79134], lines: 7, last: '  total $3471.40' },
      { cents: [63309, 68162, 73015], lines: 5, last: '  total $2044.86' },
      { cents: [66896, 71749, 76602, 81455], lines: 6, last: '  total $2967.02' },
      { cents: [70483, 75336, 80189, 85042, 89895], lines: 7, last: '  total $4009.45' },
      { cents: [74070, 78923, 83776], lines: 5, last: '  total $2367.69' },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-18] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      const lines = statement(ledger);
      console.log(`[led-18]   got lines=${lines.length} last=${lines[lines.length - 1]}`);
      console.log(`[led-18]   want lines=${c.lines} last=${c.last}`);
      assert.equal(lines.length, c.lines);
      assert.equal(lines[lines.length - 1], c.last);
    }
  });

});

describe('entry counting', () => {
  test('entry count batch 1', () => {
    const cases = [
      { cents: [22164, 27017, 31870], count: 3 },
      { cents: [25751, 30604, 35457, 40310], count: 4 },
      { cents: [29338, 34191, 39044, 43897, 48750], count: 5 },
      { cents: [32925, 37778, 42631], count: 3 },
      { cents: [36512, 41365, 46218, 51071], count: 4 },
      { cents: [40099, 44952, 49805, 54658, 59511], count: 5 },
      { cents: [43686, 48539, 53392], count: 3 },
      { cents: [47273, 52126, 56979, 61832], count: 4 },
      { cents: [50860, 55713, 60566, 65419, 70272], count: 5 },
      { cents: [54447, 59300, 64153], count: 3 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-19] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      console.log(`[led-19]   got count=${entryCount(ledger)}`);
      console.log(`[led-19]   want count=${c.count}`);
      assert.equal(entryCount(ledger), c.count);
    }
  });

  test('entry count batch 2', () => {
    const cases = [
      { cents: [28705, 33558, 38411], count: 3 },
      { cents: [32292, 37145, 41998, 46851], count: 4 },
      { cents: [35879, 40732, 45585, 50438, 55291], count: 5 },
      { cents: [39466, 44319, 49172], count: 3 },
      { cents: [43053, 47906, 52759, 57612], count: 4 },
      { cents: [46640, 51493, 56346, 61199, 66052], count: 5 },
      { cents: [50227, 55080, 59933], count: 3 },
      { cents: [53814, 58667, 63520, 68373], count: 4 },
      { cents: [57401, 62254, 67107, 71960, 76813], count: 5 },
      { cents: [60988, 65841, 70694], count: 3 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-20] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      console.log(`[led-20]   got count=${entryCount(ledger)}`);
      console.log(`[led-20]   want count=${c.count}`);
      assert.equal(entryCount(ledger), c.count);
    }
  });

  test('entry count batch 3', () => {
    const cases = [
      { cents: [35246, 40099, 44952], count: 3 },
      { cents: [38833, 43686, 48539, 53392], count: 4 },
      { cents: [42420, 47273, 52126, 56979, 61832], count: 5 },
      { cents: [46007, 50860, 55713], count: 3 },
      { cents: [49594, 54447, 59300, 64153], count: 4 },
      { cents: [53181, 58034, 62887, 67740, 72593], count: 5 },
      { cents: [56768, 61621, 66474], count: 3 },
      { cents: [60355, 65208, 70061, 74914], count: 4 },
      { cents: [63942, 68795, 73648, 78501, 83354], count: 5 },
      { cents: [67529, 72382, 77235], count: 3 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-21] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      console.log(`[led-21]   got count=${entryCount(ledger)}`);
      console.log(`[led-21]   want count=${c.count}`);
      assert.equal(entryCount(ledger), c.count);
    }
  });

  test('entry count batch 4', () => {
    const cases = [
      { cents: [41787, 46640, 51493], count: 3 },
      { cents: [45374, 50227, 55080, 59933], count: 4 },
      { cents: [48961, 53814, 58667, 63520, 68373], count: 5 },
      { cents: [52548, 57401, 62254], count: 3 },
      { cents: [56135, 60988, 65841, 70694], count: 4 },
      { cents: [59722, 64575, 69428, 74281, 79134], count: 5 },
      { cents: [63309, 68162, 73015], count: 3 },
      { cents: [66896, 71749, 76602, 81455], count: 4 },
      { cents: [70483, 75336, 80189, 85042, 89895], count: 5 },
      { cents: [74070, 78923, 83776], count: 3 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-22] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      console.log(`[led-22]   got count=${entryCount(ledger)}`);
      console.log(`[led-22]   want count=${c.count}`);
      assert.equal(entryCount(ledger), c.count);
    }
  });

  test('entry count batch 5', () => {
    const cases = [
      { cents: [48328, 53181, 58034], count: 3 },
      { cents: [51915, 56768, 61621, 66474], count: 4 },
      { cents: [55502, 60355, 65208, 70061, 74914], count: 5 },
      { cents: [59089, 63942, 68795], count: 3 },
      { cents: [62676, 67529, 72382, 77235], count: 4 },
      { cents: [66263, 71116, 75969, 80822, 85675], count: 5 },
      { cents: [69850, 74703, 79556], count: 3 },
      { cents: [73437, 78290, 83143, 87996], count: 4 },
      { cents: [77024, 81877, 86730, 91583, 96436], count: 5 },
      { cents: [80611, 85464, 90317], count: 3 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-23] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      console.log(`[led-23]   got count=${entryCount(ledger)}`);
      console.log(`[led-23]   want count=${c.count}`);
      assert.equal(entryCount(ledger), c.count);
    }
  });

  test('entry count batch 6', () => {
    const cases = [
      { cents: [54869, 59722, 64575], count: 3 },
      { cents: [58456, 63309, 68162, 73015], count: 4 },
      { cents: [62043, 66896, 71749, 76602, 81455], count: 5 },
      { cents: [65630, 70483, 75336], count: 3 },
      { cents: [69217, 74070, 78923, 83776], count: 4 },
      { cents: [72804, 77657, 82510, 87363, 92216], count: 5 },
      { cents: [76391, 81244, 86097], count: 3 },
      { cents: [79978, 84831, 89684, 94537], count: 4 },
      { cents: [83565, 88418, 93271, 98124, 102977], count: 5 },
      { cents: [87152, 92005, 96858], count: 3 },
    ];
    for (const [i, c] of cases.entries()) {
      console.log(`[led-24] case ${i + 1}/${cases.length}: entries=${c.cents.length}`);
      const ledger = openLedger(`acct-${i}`);
      for (const [k, cents] of c.cents.entries()) record(ledger, `entry-${k}`, cents);
      console.log(`[led-24]   got count=${entryCount(ledger)}`);
      console.log(`[led-24]   want count=${c.count}`);
      assert.equal(entryCount(ledger), c.count);
    }
  });

});
