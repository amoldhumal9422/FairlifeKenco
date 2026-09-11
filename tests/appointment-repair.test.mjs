import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startRepair,
  planRepair,
  applyRepairResponse,
  repairSummary,
} from '../workflow/appointment-repair.js';

const now = Date.parse('2030-01-01T12:00:00Z');
const row = {
  carMoveId: 'LOAD-1',
  ordnum: 'ORDER-1',
  direction: 'OB',
  whId: 'AZ02',
  carcod: 'TEST',
  slotId: 'AMBIENT_SOUTH_DOORS',
  startIso: '2030-01-02T10:00:00-07:00',
  endIso: '2030-01-02T12:00:00-07:00',
  appointmentConflict: true,
};
const run = () => ({
  runId: '123',
  status: 'completed_with_issues',
  summaryJson: JSON.stringify({ processed: 1, failed: 1, results: [row] }),
  updatedAt: '2030-01-01T10:00:00Z',
});
const request = () => ({
  action: 'repair',
  runId: '123',
  rowIndex: 0,
  load: 'LOAD-1',
  expectedUpdatedAt: '2030-01-01T10:00:00Z',
  repairId: '12345678-1234-4234-9234-123456789abc',
  confirm: true,
  actor: 'Operator',
});
const base = 'https://bf56-kms-wms-web-pr9.jdadelivers.com/data/WM/wm';
const wave = () => ({
  waveNumber: 'WAVE-1',
  resourceId: 'WAVE-1',
  warehouseId: 'AZ02',
  waveStatus: 'PLAN',
  pickQuantity: null,
  pickedQuantity: null,
  actualLpnPicks: null,
  actualSubLpnPicks: null,
  actualDetailLpnPicks: null,
  totalShipmentsStaged: 0,
  pickCount: 0,
  loadCount: 1,
  replCount: 0,
  xdkCount: 0,
  dateLastModified: '2030-01-01T10:00:00Z',
  picks_uri: base + '/waves/WAVE-1/picks',
  loads_uri: base + '/waves/WAVE-1/outboundLoads',
});
const load = () => ({
  resourceId: 'LOAD-1',
  carrierMoveId: 'LOAD-1',
  warehouseId: 'AZ02',
  appointmentId: 'APP-OLD',
  waves_uri: base + '/outboundLoads/LOAD-1/waves',
});
const app = () => ({
  resourceId: 'APP-OLD',
  appointmentId: 'APP-OLD',
  carrierMoveId: 'LOAD-1',
  warehouseId: 'AZ02',
  appointmentType: 'S',
  trailerCode: 'SHIP',
  carrierCode: 'TEST',
  slotId: 'AMBIENT_SOUTH_DOORS',
  startDate: '2030-01-01T17:00:00Z',
  endDate: '2030-01-01T19:00:00Z',
  dispatch: false,
  close: false,
  trailerCheckedIn: false,
  advancedAllocation: false,
  version: 1,
});
const response = (data, statusCode = 200) => ({
  statusCode,
  body: JSON.stringify({
    data,
    ...(Array.isArray(data) ? { totalCount: data.length } : {}),
  }),
});
function advance(s, data, status = 200) {
  return applyRepairResponse(planRepair(s, now), response(data, status), now);
}
function eligible() {
  let s = startRepair(run(), request(), now);
  s = advance(s, [load()]);
  s = advance(s, app());
  s = advance(s, [wave()]);
  s = advance(s, wave());
  s = advance(s, [load()]);
  s = advance(s, []);
  s = advance(s, wave());
  s = advance(s, app());
  return advance(s, [load()]);
}

test('repair requires explicit confirmation and a current stored outbound conflict', () => {
  assert.throws(
    () => startRepair(run(), { ...request(), confirm: false }, now),
    /confirm/i,
  );
  assert.throws(
    () => startRepair(run(), { ...request(), load: 'ANOTHER' }, now),
    /changed|match/i,
  );
  assert.throws(
    () => startRepair(run(), { ...request(), expectedUpdatedAt: 'stale' }, now),
    /refresh|changed/i,
  );
  assert.throws(
    () => startRepair({ ...run(), status: 'running' }, request(), now),
    /finish|running/i,
  );
  const r = run();
  r.summaryJson = JSON.stringify({ results: [{ ...row, direction: 'IB' }] });
  assert.throws(() => startRepair(r, request(), now), /outbound/i);
  assert.throws(
    () => startRepair(run(), request(), Date.parse('2030-01-03T12:00:00Z')),
    /past|future/i,
  );
});
test('allocated and unknown wave states cannot reach a write request', () => {
  for (const status of ['ALOC', 'AINP', 'REL', 'SCH', 'CMPL', 'UNKNOWN']) {
    let s = startRepair(run(), request(), now);
    s = advance(s, [load()]);
    s = advance(s, app());
    s = advance(s, [wave()]);
    s = advance(s, { ...wave(), waveStatus: status });
    assert.equal(s.phase, 'done');
    assert.equal(planRepair(s, now).route, 0);
    assert.equal(s.audit.waveDeleted, false);
  }
});
test('missing allocation evidence and multiple loads fail closed', () => {
  for (const change of [
    { pickCount: null },
    { pickCount: 1 },
    { pickQuantity: 2 },
    { loadCount: 2 },
    { replCount: 1 },
    { dateReleased: '2030-01-01' },
  ]) {
    let s = startRepair(run(), request(), now);
    s = advance(s, [load()]);
    s = advance(s, app());
    s = advance(s, [wave()]);
    s = advance(s, { ...wave(), ...change });
    assert.equal(s.phase, 'done');
  }
});
test('verified empty picks support a planned wave with null quantity projections', () => {
  const s = eligible(),
    p = planRepair(s, now);
  assert.equal(s.phase, 'cancelWave');
  assert.equal(p.route, 2);
  assert.equal(p.request.method, 'PUT');
  assert.equal(p.request.body.waveNumber, 'WAVE-1');
  assert.equal(s.audit.waveDeleted, false);
});
test('wave cancellation must complete before appointment deletion; timeout is not retried', () => {
  let s = eligible();
  s = advance(
    s,
    {
      asynchronousResources_uri:
        base + '/waves/cancelWave/async/TEST-1/resources',
    },
    202,
  );
  assert.equal(s.phase, 'pollWave');
  s = advance(s, [{ asynchronousStatus: 'COMPLETE' }]);
  assert.equal(s.phase, 'verifyWavesGone');
  assert.equal(s.audit.waveDeleted, false);
  const uncertain = applyRepairResponse(
    planRepair(eligible(), now),
    { error: 'timeout' },
    now,
  );
  assert.equal(uncertain.phase, 'done');
  assert.equal(uncertain.audit.repairNeedsReview, true);
  assert.equal(planRepair(uncertain, now).route, 0);
});
test('repair preserves audit through delete and recreate without rerunning the wave flow', () => {
  let s = eligible();
  s = advance(
    s,
    {
      asynchronousResources_uri:
        base + '/waves/cancelWave/async/TEST-1/resources',
    },
    202,
  );
  s = advance(s, [{ asynchronousStatus: 'COMPLETE' }]);
  s = advance(s, []);
  assert.equal(s.audit.waveDeleted, true);
  s = advance(s, app());
  s = advance(s, [load()]);
  assert.equal(s.phase, 'deleteAppointment');
  assert.equal(planRepair(s, now).route, 3);
  s = advance(s, {}, 204);
  s = advance(s, {}, 404);
  s = advance(s, [{ ...load(), appointmentId: null }]);
  s = advance(s, []);
  assert.equal(s.phase, 'createAppointment');
  assert.equal(planRepair(s, now).request.body.startDate, row.startIso);
  s = advance(s, { appointmentId: 'APP-NEW' }, 201);
  s = advance(s, {
    ...app(),
    resourceId: 'APP-NEW',
    appointmentId: 'APP-NEW',
    startDate: row.startIso,
    endDate: row.endIso,
  });
  s = advance(s, [{ ...load(), appointmentId: 'APP-NEW' }]);
  assert.equal(s.phase, 'done');
  assert.equal(s.audit.appointmentRecreated, true);
  const summary = repairSummary(s);
  assert.equal(summary.results[0].appointmentId, 'APP-NEW');
  assert.equal(summary.failed, 1);
  assert.equal(summary.appointmentRepairs.length, 1);
  assert.equal(summary.results[0].manualReviewRequired, true);
});
test('an appointment already at the requested time is preserved', () => {
  let s = startRepair(run(), request(), now);
  s = advance(s, [load()]);
  s = advance(s, { ...app(), startDate: row.startIso, endDate: row.endIso });
  s = advance(s, [wave()]);
  s = advance(s, wave());
  s = advance(s, [load()]);
  s = advance(s, []);
  s = advance(s, wave());
  assert.equal(s.phase, 'done');
  assert.match(s.audit.recoveryStatus, /Already/);
  assert.equal(s.audit.waveDeleted, false);
});
test('recurring, checked-in and changed appointments are never deleted', () => {
  for (const change of [
    { recurringAppointmentId: 'SERIES' },
    { trailerCheckedIn: true },
    { close: true },
    { dispatch: true },
    { trailerId: 'TRAILER' },
    { advancedAllocation: true },
  ]) {
    let s = startRepair(run(), request(), now);
    s = advance(s, [load()]);
    s = advance(s, { ...app(), ...change });
    assert.equal(s.phase, 'done');
  }
  let s = eligible();
  s = advance(
    s,
    {
      asynchronousResources_uri:
        base + '/waves/cancelWave/async/TEST-1/resources',
    },
    202,
  );
  s = advance(s, [{ asynchronousStatus: 'COMPLETE' }]);
  s = advance(s, []);
  s = advance(s, { ...app(), version: 2 });
  assert.equal(s.phase, 'done');
  assert.equal(s.audit.appointmentDeleted, false);
});
test('unexpected lookup destinations and response payloads stop the repair', () => {
  let s = startRepair(run(), request(), now);
  s = advance(s, [{ ...load(), waves_uri: 'https://example.com/steal' }]);
  assert.equal(s.phase, 'done');
  s = eligible();
  s = advance(
    s,
    { asynchronousResources_uri: 'https://example.com/task' },
    202,
  );
  assert.equal(s.phase, 'done');
  s = startRepair(run(), request(), now);
  s = applyRepairResponse(
    planRepair(s, now),
    { statusCode: 200, body: '<html>Sign in</html>' },
    now,
  );
  assert.equal(s.phase, 'done');
});
test('same request and a previous uncertain mutation cannot be replayed', () => {
  const r = run();
  r.summaryJson = JSON.stringify({
    results: [{ ...row, repairWriteAttempted: true }],
    appointmentRepairs: [],
  });
  assert.throws(() => startRepair(r, request(), now), /review/i);
  r.summaryJson = JSON.stringify({
    results: [row],
    appointmentRepairs: [{ repairId: request().repairId }],
  });
  assert.throws(() => startRepair(r, request(), now), /already/i);
});

test('association projections may omit warehouse and counts; full wave identity is still checked', () => {
  let s = startRepair(run(), request(), now);
  s = advance(s, [load()]);
  s = advance(s, app());
  s = applyRepairResponse(
    planRepair(s, now),
    {
      statusCode: 200,
      body: { data: [{ waveNumber: 'WAVE-1', warehouseId: null }] },
    },
    now,
  );
  assert.equal(s.phase, 'wave');
  s = advance(s, { ...wave(), warehouseId: 'OTHER' });
  assert.equal(s.phase, 'done');
});

test('older AZ02 run summaries without a warehouse field retain their saved appointment data', () => {
  const r = run();
  const { whId: _whId, ...older } = row;
  r.summaryJson = JSON.stringify({ results: [older] });
  assert.equal(startRepair(r, request(), now).row.whId, 'AZ02');
});
