type ResultRow = Record<string, string | number | boolean>;

export function hasAppointmentConflict(row: ResultRow): boolean {
  return (
    row.appointmentConflict === true ||
    /load has been assigned to another appoi(?:nt|t)ment/i.test(
      String(row.apptWarning || ''),
    )
  );
}

export function repairUnavailable(
  row: ResultRow,
  status: string,
  now = Date.now(),
): string {
  if (!['completed', 'completed_with_issues', 'failed'].includes(status))
    return status === 'repairing'
      ? 'Repair in progress'
      : 'Run must be finished';
  if (row.direction !== 'OB' || (row.whId !== undefined && row.whId !== 'AZ02'))
    return 'Manual review required';
  if (
    row.repairWriteAttempted ||
    row.waveCreated ||
    row.appointmentMoved ||
    row.appointmentRecreated ||
    row.waveDeleted ||
    row.appointmentDeleted
  )
    return 'Review the recorded repair';
  if (
    !Number.isFinite(Date.parse(String(row.startIso))) ||
    new Date(Date.parse(String(row.startIso)) - 7 * 3600000)
      .toISOString()
      .slice(0, 10) < new Date(now - 7 * 3600000).toISOString().slice(0, 10)
  )
    return 'Requested date has passed';
  if (
    !row.carcod ||
    !row.slotId ||
    !row.carMoveId ||
    !row.schbat ||
    !row.shipmentId
  )
    return 'Saved details incomplete';
  return '';
}

export function appointmentConflicts(rows: ResultRow[]): ResultRow[] {
  return rows.flatMap((row, rowIndex) =>
    hasAppointmentConflict(row)
      ? [
          {
            rowIndex,
            load: row.carMoveId || row.ordnum || '',
            order: row.ordnum || '',
            requestedStart: row.startIso || '',
            requestedEnd: row.endIso || '',
            allocation: row.allocationStatus || 'Not recorded',
            previousWave: row.previousWave || 'Not recorded',
            intendedWave: row.intendedWave || row.schbat || 'Not recorded',
            verifiedWave: row.verifiedWave || '',
            shipment: row.shipmentId || 'Not recorded',
            previousAppointment: row.previousAppointmentId || 'Not recorded',
            previousAppointmentStart: row.previousAppointmentStart || '',
            previousAppointmentEnd: row.previousAppointmentEnd || '',
            verifiedAppointmentStart: row.verifiedAppointmentStart || '',
            verifiedAppointmentEnd: row.verifiedAppointmentEnd || '',
            verifiedAppointmentSlot: row.verifiedAppointmentSlot || '',
            outcome:
              row.recoveryStatus === 'Recovery disabled'
                ? 'Repair not run'
                : row.recoveryStatus || 'Manual review required',
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
            ...Object.fromEntries(
              [
                'waveCreated',
                'waveLinked',
                'waveReused',
                'appointmentMoved',
                'appointmentVerified',
                'appointmentReused',
              ].map((key) => [
                key,
                typeof row[key] === 'boolean'
                  ? row[key]
                    ? 'Yes'
                    : 'No'
                  : 'Not recorded',
              ]),
            ),
            newAppointment: row.appointmentId || '',
            checkedAt: row.recoveryCheckedAt || '',
            manualReview: 'Required',
          },
        ]
      : [],
  );
}
