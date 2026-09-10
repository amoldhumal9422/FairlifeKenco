import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWorkbook } from '../lib/wave-metrics.ts';

test('cancelled appointments stay in the mix but leave active charts', () => {
  const result = analyzeWorkbook([
    { 'IB-OB': 'Outbound', 'Appt Time': '02:30', 'Carrier Name': 'Carrier A' },
    { 'IB-OB': 'Inbound', 'Appt Time': 0.5, 'Carrier Name': 'Carrier B' },
    {
      'IB-OB': 'OB-CANCELLED',
      'Appt Time': '02:30',
      'Carrier Name': 'Carrier A',
    },
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.active, 2);
  assert.deepEqual(result.mix, {
    outbound: 1,
    inbound: 1,
    cancelled: 1,
    other: 0,
  });
  assert.equal(result.schedule[1].outbound, 1);
  assert.equal(result.schedule[6].inbound, 1);
  assert.equal(result.carriers.find((c) => c.name === 'Carrier A').count, 1);
});

test('missing direction and time remain visible instead of being misclassified', () => {
  const result = analyzeWorkbook([
    { 'IB-OB': '', 'Appt Time': 'not a time' },
    { 'IB-OB': 'OB', 'Appt Time': '24:00' },
    { 'IB-OB': 'IB', 'Appt Time': 1 },
  ]);
  assert.equal(result.untimed, 3);
  assert.equal(result.mix.other, 1);
  assert.equal(result.active, 3);
  assert.equal(result.carriers[0].name, 'Not specified');
  assert.equal(
    result.schedule.reduce(
      (sum, bin) => sum + bin.outbound + bin.inbound + bin.other,
      0,
    ),
    0,
  );
});

test('midnight, noon, end of day, and case variants are aggregated accurately', () => {
  const result = analyzeWorkbook([
    { 'IB-OB': 'ob', 'Appt Time': '12:00 AM', 'Carrier Name': 'Example' },
    { 'IB-OB': 'Outbound', 'Appt Time': '12:00 PM', 'Carrier Name': 'EXAMPLE' },
    { 'IB-OB': 'IB', 'Appt Time': '23:59', 'Carrier Name': 'Example' },
    { 'IB-OB': 'Inbound', 'Appt Time': 0, 'Carrier Name': 'Example' },
  ]);
  assert.equal(result.carriers.length, 1);
  assert.equal(result.carriers[0].count, 4);
  assert.equal(result.schedule[0].outbound, 1);
  assert.equal(result.schedule[0].inbound, 1);
  assert.equal(result.schedule[6].outbound, 1);
  assert.equal(result.schedule[11].inbound, 1);
  assert.equal(result.untimed, 0);
});

test('empty workbooks produce no fabricated data', () => {
  const result = analyzeWorkbook([]);
  assert.equal(result.total, 0);
  assert.equal(result.active, 0);
  assert.equal(result.carriers.length, 0);
});
