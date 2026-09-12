import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startRepair,
  planRepair,
  applyRepairResponse,
  repairSummary,
} from '../workflow/appointment-repair.js';
const now = Date.parse('2030-01-01T12:00:00Z');
const base = 'https://bf56-kms-wms-web-pr9.jdadelivers.com/data/WM/wm';
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
  schbat: 'WAVE-1',
  shipmentId: 'SHIP-1',
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
const load = () => ({
  resourceId: 'LOAD-1',
  carrierMoveId: 'LOAD-1',
  warehouseId: 'AZ02',
  appointmentId: 'APP-OLD',
  waves_uri: base + '/outboundLoads/LOAD-1/waves',
  close: 0,
  dispatch: 0,
  isLoading: 0,
  loaded: 0,
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
  externalAppointmentId: 'KEEP-ME',
  noteText: 'Existing appointment note',
});
const shipment = () => ({
  resourceId: 'SHIP-1',
  shipmentId: 'SHIP-1',
  warehouseId: 'AZ02',
  carrierMoveId: 'LOAD-1',
});
const wave = (name = 'WAVE-1') => ({
  waveNumber: name,
  resourceId: name,
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
  totalShipments: 1,
  replCount: 0,
  xdkCount: 0,
  dateLastModified: '2030-01-01T10:00:00Z',
  picks_uri: base + '/waves/' + encodeURIComponent(name) + '/picks',
  loads_uri: base + '/waves/' + encodeURIComponent(name) + '/outboundLoads',
});
const response = (data, statusCode = 200) => ({
  statusCode,
  body: { data, ...(Array.isArray(data) ? { totalCount: data.length } : {}) },
});
function simulate({
  existing = null,
  appointment = app(),
  overrides = {},
  savedRow = row,
} = {}) {
  let s = startRepair(
    {
      ...run(),
      summaryJson: JSON.stringify({
        processed: 1,
        failed: 1,
        results: [savedRow],
      }),
    },
    request(),
    now,
  );
  let currentWave = existing,
    currentAppointment = appointment;
  const requests = [],
    visited = [];
  const association = () =>
    currentWave ? [{ waveNumber: currentWave, warehouseId: null }] : [];
  for (let i = 0; s.phase !== 'done' && i < 150; i++) {
    s = planRepair(s, now);
    if (s.phase === 'done') break;
    const phase = s.phase;
    visited.push(phase);
    requests.push({
      phase,
      ...s.request,
      appointmentVerified: s.audit.appointmentVerified,
    });
    let result;
    if (overrides[phase])
      result = overrides[phase]({
        s,
        requests,
        visited,
        wave: currentWave,
        appointment: currentAppointment,
      });
    if (result === undefined) {
      switch (phase) {
        case 'load':
        case 'recheckLoad':
        case 'verifyMovedLoad':
        case 'loadBeforeWave':
        case 'verifyFinalLoad':
          result = response([load()]);
          break;
        case 'appointment':
        case 'recheckAppointment':
        case 'verifyMovedAppointment':
        case 'appointmentBeforeWave':
        case 'verifyFinalAppointment':
          result = response(currentAppointment);
          break;
        case 'waves':
        case 'recheckWaves':
        case 'verifyCreatedWaves':
        case 'verifyFinalWaves':
        case 'shipmentWaves':
        case 'recheckShipmentWaves':
        case 'verifyFinalShipmentWaves':
          result = response(association());
          break;
        case 'targetName':
        case 'recheckTargetName':
          result = response(
            currentWave === savedRow.schbat ? [wave(currentWave)] : [],
          );
          break;
        case 'wave':
        case 'recheckWave':
          result = response(wave(currentWave));
          break;
        case 'waveLoads':
          result = response([load()]);
          break;
        case 'picks':
        case 'loadPicks':
        case 'recheckPicks':
        case 'recheckLoadPicks':
          result = response([]);
          break;
        case 'shipment':
        case 'recheckShipment':
          result = response(shipment());
          break;
        case 'wavableLines':
          result = response([
            { shipmentId: 'SHIP-1', shipmentLineId: 'LINE-1' },
          ]);
          break;
        case 'createWave':
          result = response(
            {
              asynchronousResources_uri:
                base + '/waves/planWave/async/TASK/resources',
            },
            202,
          );
          break;
        case 'pollCreateWave':
          currentWave = savedRow.schbat;
          result = response([{ asynchronousStatus: 'COMPLETE' }]);
          break;
        case 'moveAppointment':
          currentAppointment = { ...currentAppointment, ...s.request.body };
          result = { statusCode: 204 };
          break;
        default:
          throw new Error('Unhandled fixture phase ' + phase);
      }
    }
    s = applyRepairResponse(s, result, now);
  }
  assert.equal(
    s.phase,
    'done',
    'Every simulated run must finish within its request limit',
  );
  return {
    s,
    requests,
    visited,
    writes: requests.filter((r) => r.method !== 'GET'),
  };
}
function unchanged(result) {
  assert.equal(result.writes.length, 0);
  assert.equal(result.s.audit.repairWriteAttempted, false);
  assert.equal(result.s.audit.appointmentMoved, false);
  assert.equal(result.s.audit.waveCreated, false);
}

test('the appointment is moved and verified before a missing wave is created', () => {
  const { s, writes, visited } = simulate();
  assert.deepEqual(
    writes.map((r) => r.phase),
    ['moveAppointment', 'createWave'],
  );
  assert.deepEqual(writes[1].body, {
    shipmentList: "'SHIP-1'",
    dtlFlg: 0,
    warehouseId: 'AZ02',
    waveNumber: 'WAVE-1',
    waveSet: '',
  });
  assert.match(writes[1].url, /car_move_id=LOAD-1/);
  assert(
    visited.indexOf('verifyMovedAppointment') < visited.indexOf('createWave'),
  );
  assert(visited.indexOf('verifyMovedLoad') < visited.indexOf('createWave'));
  assert.equal(writes[1].appointmentVerified, true);
  assert.equal(writes[0].method, 'PUT');
  assert.match(writes[0].url, /appointments\/APP-OLD\?ignoreWarnings=false/);
  assert.equal(writes[0].body.startDate, row.startIso);
  assert.equal(writes[0].body.endDate, row.endIso);
  assert.equal(writes[0].body.externalAppointmentId, 'KEEP-ME');
  assert.equal(writes[0].body.noteText, 'Existing appointment note');
  assert.equal(s.audit.waveCreated, true);
  assert.equal(s.audit.waveLinked, true);
  assert.equal(s.audit.appointmentMoved, true);
  assert.equal(s.audit.appointmentId, 'APP-OLD');
  assert.equal(s.audit.appointmentDeleted, false);
  assert.equal(s.audit.appointmentRecreated, false);
  const summary = repairSummary(s);
  assert.equal(summary.failed, 1);
  assert.equal(summary.results[0].ok, undefined);
  assert.equal(summary.results[0].manualReviewRequired, true);
  assert.equal(summary.appointmentRepairs[0].intendedWave, 'WAVE-1');
});
test('a correctly linked planned wave is reused without creating a duplicate', () => {
  const { s, writes } = simulate({ existing: 'WAVE-1' });
  assert.deepEqual(
    writes.map((r) => r.phase),
    ['moveAppointment'],
  );
  assert.equal(s.audit.waveCreated, false);
  assert.equal(s.audit.waveReused, true);
  assert.equal(s.audit.waveDeleted, false);
  assert.equal(s.audit.waveLinked, true);
});
test('a different unallocated wave name stops for review without deletion', () => {
  const r = simulate({ existing: 'OLD-WAVE' });
  unchanged(r);
  const { s } = r;
  assert.equal(s.audit.previousWave, 'OLD-WAVE');
  assert.match(s.audit.recoveryNote, /name differs/);
  assert.equal(s.audit.waveDeleted, false);
  assert.equal(s.audit.waveCreated, false);
  assert.equal(s.audit.appointmentDeleted, false);
});
test('allocated, unknown, active or shared waves never reach a write', () => {
  for (const change of [
    { waveStatus: 'ALOC' },
    { waveStatus: 'AINP' },
    { waveStatus: 'REL' },
    { waveStatus: 'SCH' },
    { waveStatus: 'CMPL' },
    { waveStatus: 'UNKNOWN' },
    { pickCount: null },
    { pickCount: 1 },
    { pickQuantity: 2 },
    { loadCount: 2 },
    { totalShipments: 2 },
    { totalShipments: undefined },
    { replCount: 1 },
    { dateReleased: '2030-01-01' },
    { warehouseId: 'OTHER' },
  ]) {
    unchanged(
      simulate({
        existing: 'OLD-WAVE',
        overrides: { wave: () => response({ ...wave('OLD-WAVE'), ...change }) },
      }),
    );
  }
});
test('a target-name collision or multiple linked waves cannot create a duplicate or delete another wave', () => {
  for (const existing of [null, 'OLD-WAVE'])
    unchanged(
      simulate({
        existing,
        overrides: { targetName: () => response([wave()]) },
      }),
    );
  unchanged(
    simulate({
      overrides: { waves: () => response([wave(), wave('ANOTHER')]) },
    }),
  );
  unchanged(
    simulate({
      overrides: {
        waves: () => ({ statusCode: 200, body: { data: [], totalCount: 1 } }),
      },
    }),
  );
});
test('the saved shipment, its wave association and empty load picks must all be verified', () => {
  for (const [phase, result] of [
    ['shipment', response({ ...shipment(), carrierMoveId: 'OTHER' })],
    ['shipment', response({ ...shipment(), warehouseId: 'OTHER' })],
    ['shipmentWaves', response([wave('OTHER')])],
    ['loadPicks', response([{ pickId: 'PICK' }])],
    ['wavableLines', response([])],
  ])
    unchanged(simulate({ overrides: { [phase]: () => result } }));
  unchanged(
    simulate({
      existing: 'WAVE-1',
      overrides: {
        waveLoads: () =>
          response([load(), { ...load(), carrierMoveId: 'OTHER' }]),
      },
    }),
  );
});
test('recurring, checked-in and active appointments and loads remain unchanged', () => {
  for (const change of [
    { recurringAppointmentId: 'SERIES' },
    { trailerCheckedIn: true },
    { close: true },
    { dispatch: true },
    { trailerId: 'TRAILER' },
    { advancedAllocation: true },
  ])
    unchanged(simulate({ appointment: { ...app(), ...change } }));
  for (const change of [
    { loaded: 1 },
    { isLoading: 1 },
    { close: undefined },
    { trailerNumber: 'TRAILER' },
  ])
    unchanged(
      simulate({
        overrides: { load: () => response([{ ...load(), ...change }]) },
      }),
    );
});
test('changes to a wave, appointment, shipment or load during inspection prevent the first write', () => {
  for (const [phase, result, existing] of [
    ['recheckAppointment', response({ ...app(), version: 2 }), null],
    ['recheckLoad', response([{ ...load(), appointmentId: 'OTHER' }]), null],
    ['recheckWaves', response([wave()]), null],
    [
      'recheckShipment',
      response({ ...shipment(), carrierMoveId: 'OTHER' }),
      null,
    ],
    ['recheckShipmentWaves', response([wave()]), null],
    ['recheckLoadPicks', response([{ pickId: 'PICK' }]), null],
    ['recheckTargetName', response([wave()]), null],
    [
      'recheckWave',
      response({ ...wave(), dateLastModified: 'CHANGED' }),
      'WAVE-1',
    ],
    ['recheckWave', response({ ...wave(), waveStatus: 'ALOC' }), 'WAVE-1'],
    ['recheckPicks', response([{ pickId: 'PICK' }]), 'WAVE-1'],
  ])
    unchanged(simulate({ existing, overrides: { [phase]: () => result } }));
});
test('an already correct appointment still gets its missing wave but requires no appointment write', () => {
  const appointment = {
    ...app(),
    startDate: row.startIso,
    endDate: row.endIso,
  };
  const missing = simulate({ appointment });
  assert.deepEqual(
    missing.writes.map((r) => r.phase),
    ['createWave'],
  );
  assert.equal(missing.s.audit.waveCreated, true);
  assert.equal(missing.s.audit.appointmentMoved, false);
  const existing = simulate({ appointment, existing: 'WAVE-1' });
  unchanged(existing);
  assert.equal(existing.s.audit.waveReused, true);
  assert.match(existing.s.audit.recoveryStatus, /already correct/i);
});
test('wave creation failures preserve the verified appointment audit without claiming a completed wave', () => {
  for (const [phase, result] of [
    ['createWave', { error: 'timeout' }],
    [
      'createWave',
      response({ asynchronousResources_uri: 'https://example.com/task' }, 202),
    ],
    ['pollCreateWave', response([{ asynchronousStatus: 'FAILURE' }])],
    ['pollCreateWave', response([{ asynchronousStatus: 'RUNNING' }])],
    ['verifyCreatedWaves', response([])],
    ['verifyCreatedWaves', response([wave('WRONG')])],
  ]) {
    const r = simulate({ overrides: { [phase]: () => result } });
    assert.deepEqual(
      r.writes.map((r) => r.phase),
      ['moveAppointment', 'createWave'],
    );
    assert.equal(r.s.audit.repairNeedsReview, true);
    assert.equal(r.s.audit.appointmentMoved, true);
    assert.equal(r.s.audit.appointmentVerified, true);
    assert.equal(r.s.audit.verifiedAppointmentStart, row.startIso);
    assert.match(r.s.audit.recoveryNote, /Appointment APP-OLD was verified/);
    assert.equal(r.s.audit.waveCreated, false);
  }
  const allocated = simulate({
    overrides: { wave: () => response({ ...wave(), waveStatus: 'ALOC' }) },
  });
  assert.equal(allocated.writes.length, 2);
  assert.equal(allocated.s.audit.repairNeedsReview, true);
});
test('removed deletion stages cannot be planned from an older saved state', () => {
  for (const phase of [
    'cancelWave',
    'pollWave',
    'verifyWavesGone',
    'deleteAppointment',
  ])
    assert.throws(
      () => planRepair({ ...startRepair(run(), request(), now), phase }, now),
      /Unknown repair stage/,
    );
});
test('failed or uncertain appointment movement is recorded without retry or a successful movement claim', () => {
  for (const [phase, result] of [
    ['moveAppointment', { error: 'timeout' }],
    [
      'moveAppointment',
      {
        statusCode: 422,
        body: { errors: [{ userMessage: 'Slot unavailable' }] },
      },
    ],
    ['verifyMovedAppointment', response(app())],
    ['verifyMovedLoad', response([{ ...load(), appointmentId: 'OTHER' }])],
  ]) {
    for (const existing of [null, 'WAVE-1']) {
      const r = simulate({ existing, overrides: { [phase]: () => result } });
      assert.equal(r.writes.length, 1);
      assert.equal(r.writes[0].phase, 'moveAppointment');
      assert.equal(r.s.audit.appointmentMoved, false);
      assert.equal(r.s.audit.repairNeedsReview, true);
      if (phase === 'moveAppointment' && result.statusCode === 422)
        assert.match(r.s.audit.recoveryNote, /Slot unavailable/);
    }
  }
});
test('changes after the appointment moves block wave creation and preserve partial progress', () => {
  for (const [phase, result] of [
    ['targetName', response([wave()])],
    ['shipment', response({ ...shipment(), carrierMoveId: 'OTHER' })],
    ['shipmentWaves', response([wave('OTHER')])],
    ['loadPicks', response([{ pickId: 'PICK' }])],
    ['wavableLines', response([])],
    ['recheckAppointment', response(app())],
    ['recheckLoad', response([{ ...load(), isLoading: 1 }])],
    ['recheckWaves', response([wave()])],
    ['appointmentBeforeWave', response(app())],
    ['loadBeforeWave', response([{ ...load(), appointmentId: 'OTHER' }])],
  ]) {
    const r = simulate({
      overrides: {
        [phase]: ({ s }) => (s.audit.appointmentVerified ? result : undefined),
      },
    });
    assert.deepEqual(
      r.writes.map((r) => r.phase),
      ['moveAppointment'],
    );
    assert.equal(r.s.audit.appointmentMoved, true);
    assert.equal(r.s.audit.waveCreated, false);
    assert.equal(r.s.audit.repairNeedsReview, true);
  }
});
test('a wave allocated after appointment verification is protected without additional writes', () => {
  const r = simulate({
    existing: 'WAVE-1',
    overrides: {
      wave: ({ s }) =>
        s.audit.appointmentVerified
          ? response({ ...wave(), waveStatus: 'ALOC' })
          : undefined,
    },
  });
  assert.deepEqual(
    r.writes.map((r) => r.phase),
    ['moveAppointment'],
  );
  assert.equal(r.s.audit.appointmentMoved, true);
  assert.equal(r.s.audit.allocationStatus, 'Allocated');
  assert.equal(r.s.audit.repairNeedsReview, true);
});
test('final verification failures keep confirmed actions but cannot claim a completed repair', () => {
  for (const [phase, result] of [
    ['verifyFinalAppointment', response(app())],
    ['verifyFinalLoad', response([{ ...load(), appointmentId: 'OTHER' }])],
    ['verifyFinalWaves', response([])],
    ['verifyFinalShipmentWaves', response([])],
  ]) {
    const r = simulate({ overrides: { [phase]: () => result } });
    assert.deepEqual(
      r.writes.map((r) => r.phase),
      ['moveAppointment', 'createWave'],
    );
    assert.equal(r.s.audit.appointmentMoved, true);
    assert.equal(r.s.audit.waveCreated, true);
    assert.equal(r.s.audit.repairNeedsReview, true);
    assert.equal(r.s.audit.recoveryStatus, 'Manual review required');
  }
});
test('authorization, saved identity, dates and mutation replay are enforced', () => {
  for (const q of [
    { ...request(), confirm: false },
    { ...request(), load: 'OTHER' },
    { ...request(), expectedUpdatedAt: 'STALE' },
  ])
    assert.throws(() => startRepair(run(), q, now));
  assert.throws(
    () => startRepair({ ...run(), status: 'running' }, request(), now),
    /finish/,
  );
  assert.throws(
    () => startRepair(run(), request(), Date.parse('2030-01-03T12:00:00Z')),
    /past/,
  );
  for (const change of [
    { direction: 'IB' },
    { whId: 'OTHER' },
    { schbat: '' },
    { shipmentId: '' },
    { shipmentId: "SID'; delete" },
    { repairWriteAttempted: true },
    { waveCreated: true },
    { appointmentMoved: true },
  ])
    assert.throws(() =>
      startRepair(
        {
          ...run(),
          summaryJson: JSON.stringify({ results: [{ ...row, ...change }] }),
        },
        request(),
        now,
      ),
    );
  assert.throws(
    () =>
      startRepair(
        {
          ...run(),
          summaryJson: JSON.stringify({
            results: [row],
            appointmentRepairs: [{ repairId: request().repairId }],
          }),
        },
        request(),
        now,
      ),
    /already/,
  );
  const { whId: _whId, ...older } = row;
  assert.equal(
    startRepair(
      { ...run(), summaryJson: JSON.stringify({ results: [older] }) },
      request(),
      now,
    ).row.whId,
    'AZ02',
  );
});
test('untrusted response destinations, HTML and pagination ambiguity stop the repair', () => {
  unchanged(
    simulate({
      overrides: {
        load: () =>
          response([{ ...load(), waves_uri: 'https://example.com/steal' }]),
      },
    }),
  );
  unchanged(
    simulate({
      overrides: {
        load: () => ({ statusCode: 200, body: '<html>Sign in</html>' }),
      },
    }),
  );
  unchanged(
    simulate({
      overrides: {
        loadPicks: () => ({
          statusCode: 200,
          body: { data: [], totalCount: 1 },
        }),
      },
    }),
  );
});
test('the intended wave name is encoded without changing its saved spelling', () => {
  const name = 'AM 0102 1000 LOAD-1 000123';
  const r = simulate({ savedRow: { ...row, schbat: name } });
  assert.equal(r.writes[1].body.waveNumber, name);
  assert.equal(r.s.audit.verifiedWave, name);
  assert.match(
    r.requests.find((r) => r.phase === 'recheckTargetName').url,
    /AM%200102%201000/,
  );
});
