import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appointmentConflicts,
  hasAppointmentConflict,
  repairUnavailable,
} from '../lib/appointment-conflicts.ts';

test('historical load conflicts are visible without inventing recovery actions', () => {
  const rows = appointmentConflicts([
    {
      carMoveId: '0000123',
      ordnum: 'ORDER-1',
      apptWarning:
        'Load has been assigned to another appointment. Please deassign Load from existing appointment before proceeding.&#x20;',
      schbat: 'NEW WAVE',
      stepAppointment: 422,
      stepWave: 200,
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].load, '0000123');
  assert.equal(rows[0].previousWave, 'Not recorded');
  assert.equal(rows[0].allocation, 'Not recorded');
  assert.equal(rows[0].waveDeleted, 'Not recorded');
  assert.equal(rows[0].outcome, 'Manual review required');
});

test('repair availability preserves original result indices and blocks past or already changed loads', () => {
  const row = {
    direction: 'OB',
    carMoveId: 'LOAD',
    carcod: 'TEST',
    slotId: 'AMBIENT_SOUTH_DOORS',
    startIso: '2030-01-02T10:00:00-07:00',
    appointmentConflict: true,
  };
  const now = Date.parse('2030-01-01T00:00:00Z');
  assert.equal(repairUnavailable(row, 'completed_with_issues', now), '');
  assert.equal(appointmentConflicts([{}, row])[0].rowIndex, 1);
  assert.match(repairUnavailable(row, 'repairing', now), /progress/);
  assert.match(
    repairUnavailable(
      { ...row, repairWriteAttempted: true },
      'completed_with_issues',
      now,
    ),
    /Review/,
  );
  assert.match(
    repairUnavailable(
      row,
      'completed_with_issues',
      Date.parse('2030-01-03T12:00:00Z'),
    ),
    /passed/,
  );
});

test('slot and closed-hours warnings do not enter the appointment conflict list', () => {
  assert.equal(
    hasAppointmentConflict({
      apptWarning:
        'Appointment to be created will result in overbooking the current slot.',
    }),
    false,
  );
  assert.equal(
    hasAppointmentConflict({
      apptWarning:
        'Appointment to be created is scheduled during closed hours of operation.',
    }),
    false,
  );
  assert.equal(
    hasAppointmentConflict({
      apptWarning: 'Load has been assigned to another appoitment.',
    }),
    true,
  );
});

test('audited recovery keeps original identifiers and still requests manual verification', () => {
  const [row] = appointmentConflicts([
    {
      appointmentConflict: true,
      carMoveId: 'LOAD-1',
      previousWave: 'OLD WAVE',
      previousAppointmentId: 'OLD-APPT',
      appointmentId: 'NEW-APPT',
      allocationStatus: 'Unallocated',
      recoveryStatus: 'Recreated',
      recoveryNote: 'Recreated at the requested time.',
      waveDeleted: true,
      appointmentDeleted: true,
      appointmentRecreated: true,
      ok: true,
    },
  ]);
  assert.equal(row.previousAppointment, 'OLD-APPT');
  assert.equal(row.newAppointment, 'NEW-APPT');
  assert.equal(row.appointmentRecreated, 'Yes');
  assert.equal(row.manualReview, 'Required');
});

test('protected rows report no deletion and preserve failure details', () => {
  const [row] = appointmentConflicts([
    {
      appointmentConflict: true,
      recoveryStatus: 'Protected',
      allocationStatus: 'Allocated',
      recoveryNote: 'Allocated wave left unchanged.',
      waveDeleted: false,
      appointmentDeleted: false,
      appointmentRecreated: false,
      ok: false,
    },
  ]);
  assert.equal(row.waveDeleted, 'No');
  assert.equal(row.appointmentDeleted, 'No');
  assert.equal(row.details, 'Allocated wave left unchanged.');
});
