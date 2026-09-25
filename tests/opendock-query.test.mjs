import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime, Settings } from 'luxon';
import { buildAppointmentQuery } from '../workflow/opendock-query.js';

const cfg = {
  apiUrl: 'https://neutron.opendock.com',
  warehouseNameContains: 'Fairlife Arizona',
  daysAhead: 1,
};
const warehouses = [
  {
    json: {
      data: [
        {
          id: 'warehouse-fixture',
          name: 'Fairlife Arizona',
          timezone: 'America/Phoenix',
        },
      ],
    },
  },
];
Settings.now = () => Date.parse('2026-09-25T20:00:00Z');

test('Sunday selection queries exactly Sunday midnight through Monday midnight in Arizona', () => {
  const [{ json: result }] = buildAppointmentQuery(
    { ...cfg, planDate: '2026-09-27' },
    warehouses,
    DateTime,
  );
  assert.equal(result.dateLabel, '2026-09-27');
  assert.equal(result.windowStartUtc, '2026-09-27T07:00:00.000Z');
  assert.equal(result.windowEndUtc, '2026-09-28T07:00:00.000Z');
  const url = new URL(result.appointmentsUrl);
  assert.deepEqual(JSON.parse(url.searchParams.get('s')), {
    $and: [
      { start: { $gte: result.windowStartUtc } },
      { start: { $lt: result.windowEndUtc } },
      { 'dock.warehouseId': { $eq: 'warehouse-fixture' } },
    ],
  });
  assert.equal(url.searchParams.get('warehouseId'), 'warehouse-fixture');
  assert.equal(result.uploadSheetName, '9.25');
});

test('manual preparation still defaults to tomorrow in the warehouse timezone', () => {
  const [{ json: result }] = buildAppointmentQuery(cfg, warehouses, DateTime);
  assert.equal(result.dateLabel, '2026-09-26');
});

test('an explicitly invalid date stops before requesting appointments', () => {
  for (const planDate of ['', null, '2026-02-30', '2026-09-27T08:00:00Z'])
    assert.throws(
      () => buildAppointmentQuery({ ...cfg, planDate }, warehouses, DateTime),
      /appointment date/,
    );
});

test('query retains the warehouse timezone when a day crosses a daylight-saving boundary', () => {
  const [{ json: result }] = buildAppointmentQuery(
    { ...cfg, planDate: '2026-11-01' },
    [
      {
        json: { id: 'fixture', name: 'Warehouse', timezone: 'America/Chicago' },
      },
    ],
    DateTime,
  );
  assert.equal(result.windowStartUtc, '2026-11-01T05:00:00.000Z');
  assert.equal(result.windowEndUtc, '2026-11-02T06:00:00.000Z');
});
