import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareInbound,
  checkUnlinkedInbound,
  verifyUnlinkedInbound,
  recordInboundResult,
} from '../workflow/inbound-appointments.js';
const cfg = { byBaseUrl: 'https://warehouse.test', siteQuery: 'siteId=AZ02' };
const base = {
  trknum: '311000001',
  ordnum: '311000001',
  direction: 'IB',
  whId: 'AZ02',
  carcod: 'CHR',
  slotId: 'CHILLED_DOORS',
  startIso: '2030-01-02T01:00:00-07:00',
  endIso: '2030-01-02T03:00:00-07:00',
};
const missing = {
  statusCode: 404,
  body: JSON.stringify({ errors: [{ userMessage: 'Not found' }] }),
};
const reply = (data, statusCode = 200) => ({
  statusCode,
  body: { data, ...(Array.isArray(data) ? { totalCount: data.length } : {}) },
});
const runOriginal = (row, response) => prepareInbound(row, response, cfg);
test('a confirmed missing inbound reference can prepare an unlinked receiving appointment', () => {
  for (const ref of [
    '311000001',
    '0311000002',
    '6600000001',
    'ITRN000000001',
  ]) {
    const r = runOriginal(
      {
        trknum: ref,
        ordnum: ref,
        direction: 'IB',
        whId: 'AZ02',
        carcod: 'CHR',
        slotId: 'CHILLED_DOORS',
        startIso: '2030-01-02T01:00:00-07:00',
        endIso: '2030-01-02T03:00:00-07:00',
      },
      {
        statusCode: 404,
        body: JSON.stringify({ errors: [{ userMessage: 'Not found' }] }),
      },
    );
    assert.equal(r.inboundUnlinked, true);
    assert.equal(r.apptBody.trailerCode, 'RCV');
    assert.match(r.apptBody.noteText, new RegExp(ref));
    assert.equal(r.assignBody, undefined);
  }
});
test('failed lookups, unknown references and missing carriers never enable fallback', () => {
  for (const statusCode of [0, 401, 403, 422, 500, 503])
    assert.equal(
      prepareInbound(base, { ...missing, statusCode }, cfg).inboundFound,
      false,
    );
  for (const row of [
    { ...base, trknum: 'anything' },
    { ...base, carcod: '' },
    { ...base, whId: 'OTHER' },
    { ...base, endIso: 'invalid' },
  ])
    assert.equal(prepareInbound(row, missing, cfg).inboundFound, false);
  assert.equal(prepareInbound(base, reply([]), cfg).inboundFound, false);
  assert.throws(
    () =>
      prepareInbound(
        base,
        { statusCode: 200, body: '<html>Login</html>' },
        cfg,
      ),
    /expired/,
  );
});
test('a found inbound keeps the existing link path and never duplicates an assigned appointment', () => {
  const row = { ...base, trknum: '6600000001', ordnum: '6600000001' };
  const truck = {
    masterReceiptId: row.trknum,
    warehouseId: 'AZ02',
    carrierCode: 'CHR',
  };
  const r = prepareInbound(row, reply(truck), cfg);
  assert.equal(r.inboundUnlinked, false);
  assert.equal(r.assignBody.masterReceiptId, row.trknum);
  assert.equal(
    prepareInbound(row, reply({ ...truck, appointmentId: 'EXISTING' }), cfg)
      .inboundFound,
    false,
  );
  assert.equal(
    prepareInbound(row, reply({ ...truck, warehouseId: 'OTHER' }), cfg)
      .inboundFound,
    false,
  );
});
const appointment = (r) => ({
  ...r.apptBody,
  appointmentId: 'APP-1',
  resourceId: 'APP-1',
  inboundLoads: [],
});
test('a repeated fallback reuses only an exactly matching inactive appointment', () => {
  const row = prepareInbound(base, missing, cfg);
  assert.equal(checkUnlinkedInbound(row, reply([])).shouldCreate, true);
  const r = checkUnlinkedInbound(row, reply([appointment(row)]));
  assert.equal(r.shouldCreate, false);
  assert.equal(r.appointmentReused, true);
  assert.equal(r.ok, true);
  for (const change of [
    { carrierCode: 'OTHER' },
    { trailerCheckedIn: true },
    { noteText: '' },
    { inboundLoads: [{ masterReceiptId: 'TRUCK' }] },
    { masterReceiptId: 'TRUCK' },
  ]) {
    const blocked = checkUnlinkedInbound(
      row,
      reply([{ ...appointment(row), ...change }]),
    );
    assert.equal(blocked.shouldCreate, false);
    assert.equal(blocked.ok, false);
  }
  assert.equal(
    checkUnlinkedInbound(row, { statusCode: 500 }).shouldCreate,
    false,
  );
  assert.equal(
    checkUnlinkedInbound(row, reply([appointment(row), appointment(row)]))
      .shouldCreate,
    false,
  );
  const a = prepareInbound({ ...base, trknum: '0311000001' }, missing, cfg);
  assert.equal(row.inboundAppointmentKey, a.inboundAppointmentKey);
});
test('unlinked creation succeeds only after reading back the saved note and appointment fields', () => {
  const row = {
    ...prepareInbound(base, missing, cfg),
    appointmentId: 'APP-1',
    stepAppointment: 201,
  };
  const verified = verifyUnlinkedInbound(row, reply(appointment(row)));
  assert.equal(verified.ok, true);
  assert.equal(verified.manualReviewRequired, true);
  assert.equal(verified.stepLink, 0);
  const saved = recordInboundResult(verified, {});
  assert.equal(saved.ok, true);
  assert.equal(saved.apptBody, undefined);
  assert.equal(saved.inboundReference, base.trknum);
  assert.equal(
    verifyUnlinkedInbound(row, reply({ ...appointment(row), noteText: '' })).ok,
    false,
  );
  assert.equal(verifyUnlinkedInbound(row, { statusCode: 500 }).ok, false);
});
