type ResultRow = Record<string, string | number | boolean>;

export function hasAppointmentConflict(row: ResultRow): boolean {
  return (
    row.appointmentConflict === true ||
    /load has been assigned to another appoi(?:nt|t)ment/i.test(
      String(row.apptWarning || ''),
    )
  );
}

export function appointmentConflicts(rows: ResultRow[]): ResultRow[] {
  return rows.filter(hasAppointmentConflict).map((row) => ({
    load: row.carMoveId || row.ordnum || '',
    order: row.ordnum || '',
    requestedStart: row.startIso || '',
    requestedEnd: row.endIso || '',
    allocation: row.allocationStatus || 'Not recorded',
    previousWave: row.previousWave || 'Not recorded',
    previousAppointment: row.previousAppointmentId || 'Not recorded',
    previousAppointmentStart: row.previousAppointmentStart || '',
    previousAppointmentEnd: row.previousAppointmentEnd || '',
    outcome: row.recoveryStatus || 'Manual review required',
    details:
      row.recoveryNote ||
      'An existing appointment blocked this load. This run did not record a recovery audit; check the current wave and appointment in Blue Yonder.',
    waveDeleted:
      typeof row.waveDeleted === 'boolean'
        ? row.waveDeleted
          ? 'Yes'
          : 'No'
        : 'Not recorded',
    appointmentDeleted:
      typeof row.appointmentDeleted === 'boolean'
        ? row.appointmentDeleted
          ? 'Yes'
          : 'No'
        : 'Not recorded',
    appointmentRecreated:
      typeof row.appointmentRecreated === 'boolean'
        ? row.appointmentRecreated
          ? 'Yes'
          : 'No'
        : 'Not recorded',
    newAppointment: row.appointmentId || '',
    checkedAt: row.recoveryCheckedAt || '',
    manualReview: 'Required',
  }));
}
