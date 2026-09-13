import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareInbound,
  checkUnlinkedInbound,
  verifyUnlinkedInbound,
  recordInboundResult,
  inboundWarningCanOverride,
  planInboundNotes,
  verifyInboundNotes,
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
    assert.equal(
      r.inboundNote,
      ref + '\nnot in system when appointment was made',
    );
    assert.equal(r.apptBody.noteText, undefined);
    assert.equal(r.assignBody, undefined);
  }
});
test('fallback external IDs fit the database field without shortening the reference notes', () => {
  for (const ref of ['311000001', '6600000001', 'ITRN000000001']) {
    const r = prepareInbound({ ...base, trknum: ref }, missing, cfg);
    assert.ok(
      r.apptBody.externalAppointmentId.length <= 10,
      'External appointment reference exceeds 10 characters',
    );
    assert.equal(
      r.inboundNote,
      ref + '\nnot in system when appointment was made',
    );
    assert.equal(
      JSON.parse(new URL(r.inboundDuplicateUrl).searchParams.get('query'))[0]
        .value,
      r.apptBody.externalAppointmentId,
    );
    const nextSlot = prepareInbound(
      { ...base, trknum: ref, startIso: '2030-01-02T02:00:00-07:00' },
      missing,
      cfg,
    );
    assert.notEqual(r.inboundAppointmentKey, nextSlot.inboundAppointmentKey);
  }
});

test('hard database errors are not resubmitted as overridable warnings', () => {
  const response = (errors) => ({
    statusCode: 422,
    data: JSON.stringify({ errors }),
  });
  const closed = {
    errorCode: '11683',
    userMessage:
      'Appointment to be created is scheduled during closed hours of operation.',
  };
  const truncated = {
    errorCode: '-2628',
    userMessage:
      "String or binary data would be truncated in column 'ext_appt_id'.",
  };
  assert.equal(inboundWarningCanOverride(response([closed])), true);
  assert.equal(inboundWarningCanOverride(response([truncated])), false);
  assert.equal(inboundWarningCanOverride(response([closed, truncated])), false);
  assert.equal(
    inboundWarningCanOverride(
      response([
        { userMessage: 'Load has been assigned to another appointment.' },
      ]),
    ),
    false,
  );
  assert.equal(
    inboundWarningCanOverride({ statusCode: 422, data: '<html>Login</html>' }),
    false,
  );
});

test('a compact-key collision cannot reuse an appointment with different reference notes', () => {
  const row = prepareInbound(base, missing, cfg);
  const existing = {
    ...row.apptBody,
    appointmentId: 'APP-OTHER',
    resourceId: 'APP-OTHER',
    noteText:
      'Inbound reference: OTHER. Not in system when appointment was made.',
  };
  const result = checkUnlinkedInbound(row, reply([existing]));
  assert.equal(result.shouldCreate, false);
  assert.equal(result.ok, false);
  const checked = verifyUnlinkedInbound(result, reply(existing));
  const blocked = planInboundNotes(
    checked,
    reply([
      { appointmentId: existing.appointmentId, noteText: existing.noteText },
    ]),
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.shouldSaveNotes, false);
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
  assert.equal(r.ok, false);
  const checked = verifyUnlinkedInbound(r, reply(appointment(row)));
  const verified = planInboundNotes(
    checked,
    reply([{ appointmentId: r.appointmentId, noteText: row.inboundNote }]),
  );
  assert.equal(verified.ok, true);
  assert.equal(verified.shouldSaveNotes, false);
  assert.equal(planInboundNotes(checked, reply([])).shouldSaveNotes, false);
  for (const change of [
    { carrierCode: 'OTHER' },
    { trailerCheckedIn: true },
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
test('unlinked creation saves the separate Appointment Notes resource and verifies it before success', () => {
  const row = {
    ...prepareInbound(base, missing, cfg),
    appointmentId: 'APP-1',
    stepAppointment: 201,
  };
  const checked = verifyUnlinkedInbound(row, reply(appointment(row)));
  assert.equal(checked.ok, false);
  const plan = planInboundNotes(checked, reply([]));
  assert.equal(plan.shouldSaveNotes, true);
  assert.deepEqual(plan.noteBody, {
    appointmentId: 'APP-1',
    noteText: base.trknum + '\nnot in system when appointment was made',
  });
  const verified = verifyInboundNotes(
    plan,
    reply([plan.noteBody]),
    reply(plan.noteBody, 201),
  );
  assert.equal(verified.ok, true);
  assert.equal(verified.manualReviewRequired, true);
  assert.equal(verified.stepLink, 0);
  const saved = recordInboundResult(verified, {});
  assert.equal(saved.ok, true);
  assert.equal(saved.apptBody, undefined);
  assert.equal(saved.inboundReference, base.trknum);
  assert.equal(
    verifyInboundNotes(plan, reply([]), reply(plan.noteBody, 201)).ok,
    false,
  );
  assert.equal(verifyUnlinkedInbound(row, { statusCode: 500 }).ok, false);
  assert.equal(
    verifyInboundNotes(plan, reply([plan.noteBody]), { statusCode: 500 }).ok,
    false,
  );
});

test('notes failures, mismatched appointment IDs and existing notes never permit a note write', () => {
  const row = {
    ...prepareInbound(base, missing, cfg),
    appointmentId: 'APP-1',
    stepAppointment: 201,
  };
  const checked = verifyUnlinkedInbound(row, reply(appointment(row)));
  for (const response of [
    { statusCode: 500 },
    reply({}),
    reply([{ appointmentId: 'OTHER', noteText: row.inboundNote }]),
    reply([{ appointmentId: 'APP-1', noteText: 'Existing operator notes' }]),
    reply([
      { appointmentId: 'APP-1', noteText: row.inboundNote },
      { appointmentId: 'APP-1', noteText: 'Extra' },
    ]),
  ]) {
    const blocked = planInboundNotes(checked, response);
    assert.equal(blocked.shouldSaveNotes, false);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.appointmentId, 'APP-1');
  }
  assert.equal(planInboundNotes(row, reply([])).shouldSaveNotes, false);
});
