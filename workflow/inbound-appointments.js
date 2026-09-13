function inboundResponse(response) {
  const status = Number(response?.statusCode || 0);
  let body = response?.body ?? response?.data;
  if (typeof body === 'string') {
    if (body.trim().startsWith('<'))
      throw new Error(
        'Blue Yonder session expired. Review completed rows before another run.',
      );
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  return {
    status,
    body,
    ok:
      status >= 200 &&
      status < 300 &&
      body &&
      typeof body === 'object' &&
      !body.errors,
  };
}
function inboundStop(row, reason) {
  return {
    ...row,
    inboundFound: false,
    shouldCreate: false,
    notesReady: false,
    shouldSaveNotes: false,
    notesVerified: false,
    ok: false,
    reason,
    manualReviewRequired: true,
    _inboundStandaloneResult: true,
  };
}
function compactInboundKey(reference, startIso, warehouseId) {
  // Keep the database reference short; full identity is verified from the notes and appointment fields.
  const identity =
    warehouseId + '|' + reference + '|' + new Date(startIso).toISOString();
  let hash = 14695981039346656037n;
  for (const char of identity) {
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt(char.charCodeAt(0))) * 1099511628211n,
    );
  }
  return 'IB' + (hash % 36n ** 8n).toString(36).toUpperCase().padStart(8, '0');
}

export function inboundWarningCanOverride(response) {
  if (Number(response?.statusCode) !== 422) return false;
  let body = response.body ?? response.data;
  try {
    if (typeof body === 'string') body = JSON.parse(body);
  } catch {
    return false;
  }
  const errors = body?.errors;
  return (
    Array.isArray(errors) &&
    errors.length > 0 &&
    errors.every(
      (error) =>
        !/^\s*-\d+\s*$/.test(String(error.errorCode ?? '')) &&
        !/load has been assigned to another appoi(?:nt|t)ment|String or binary data would be truncated/i.test(
          String(error.userMessage || error.message || ''),
        ),
    )
  );
}

export function prepareInbound(row, response, cfg) {
  const r = { ...row, inboundFound: false, inboundUnlinked: false };
  const result = inboundResponse(response);
  const d = result.ok
    ? Array.isArray(result.body.data)
      ? result.body.data.length === 1
        ? result.body.data[0]
        : null
      : result.body.data
    : null;
  const ref = String(row.trknum || '')
    .trim()
    .toUpperCase();
  const supported = /^(?:0?311\d{6}|6600\d{6}|ITR[NA]\d+)$/i.test(ref);
  const absent =
    result.status === 404 && result.body && typeof result.body === 'object';
  if (!d?.masterReceiptId && !absent)
    return inboundStop(
      r,
      'Inbound lookup could not be verified (HTTP ' +
        (result.status || 'unavailable') +
        '). No appointment was created.',
    );
  if (d) {
    if (d.masterReceiptId !== ref || d.warehouseId !== r.whId)
      return inboundStop(
        r,
        'Inbound load identity or warehouse does not match the requested reference.',
      );
    r.truckStatus = d.masterReceiptStatus || '';
    r.truckStatusDesc = d.masterReceiptStatusDescription || '';
    r.truckCarrier = d.carrierCode || '';
    r.existingApptId = d.appointmentId || '';
    r.trailerNumber = d.trailerNumber || null;
    r.trailerId = d.trailerId || null;
    if (r.existingApptId)
      return inboundStop(
        r,
        'Truck ' +
          ref +
          ' already has appointment ' +
          r.existingApptId +
          ' in BY - skipped to avoid a duplicate',
      );
    if (!r.carcod && r.truckCarrier) {
      r.carcod = r.truckCarrier;
      r.carrierNote = [
        r.carrierNote,
        'Carrier taken from the BY inbound load (' + r.truckCarrier + ')',
      ]
        .filter(Boolean)
        .join('; ');
    }
  } else if (!supported)
    return inboundStop(
      r,
      'The inbound reference is not a supported 311, 660 or ITRN/ITRA identifier. Review it before creating an appointment.',
    );
  if (!r.carcod)
    return inboundStop(
      r,
      'No carrier could be verified for this inbound appointment.',
    );
  if (
    r.direction !== 'IB' ||
    r.whId !== 'AZ02' ||
    !['CHILLED_DOORS', 'AMBIENT_NORTH_DOORS', 'AMBIENT_SOUTH_DOORS'].includes(
      r.slotId,
    ) ||
    !Number.isFinite(Date.parse(r.startIso)) ||
    !Number.isFinite(Date.parse(r.endIso)) ||
    Date.parse(r.endIso) <= Date.parse(r.startIso)
  )
    return inboundStop(
      r,
      'The inbound appointment date, time, direction or door group is invalid.',
    );
  r.apptBody = {
    appointmentType: 'S',
    trailerCode: 'RCV',
    carrierCode: r.carcod,
    slotId: r.slotId,
    startDate: r.startIso,
    endDate: r.endIso,
    warehouseId: r.whId,
    dispatch: false,
    close: false,
    liveLoadFlag: false,
    hotFlag: false,
    hazmat: false,
    turnAroundFlag: false,
    surplusFlag: false,
    advancedAllocation: false,
    advancedAllocationHours: 0,
    expectedQuantity: 0,
    receivedQuantity: 0,
    isAvailable: false,
    short: false,
    storageLocation: '',
    trailerNumber: '',
    scacCode: r.carcod,
    autoGenerated: false,
    waiting: false,
    overTime: false,
    lateToDoor: false,
    trailerCheckedIn: false,
  };
  r.inboundFound = true;
  r.reason = '';
  if (d) {
    r.assignBody = {
      masterReceiptId: ref,
      warehouseId: r.whId,
      trailerNumber: r.trailerNumber,
      trailerId: r.trailerId,
    };
    r.assignUrlBase =
      cfg.byBaseUrl +
      '/data/WM/wm/inboundLoads/' +
      encodeURIComponent(ref + '*!' + r.whId) +
      '/assign';
    return r;
  }
  r.inboundUnlinked = true;
  r.inboundReference = ref;
  r.inboundNote = ref + '\nnot in system when appointment was made';
  r.manualReviewRequired = true;
  const keyRef = ref.replace(/^0(311\d{6})$/, '$1');
  r.inboundAppointmentKey = compactInboundKey(keyRef, r.startIso, r.whId);
  r.apptBody.externalAppointmentId = r.inboundAppointmentKey;
  const query = [
    {
      column: 'externalAppointmentId',
      operator: 'EQ',
      value: r.inboundAppointmentKey,
      options: { exact: [true, true] },
    },
  ];
  r.inboundDuplicateUrl =
    cfg.byBaseUrl +
    '/data/WM/wm/appointments?query=' +
    encodeURIComponent(JSON.stringify(query)) +
    '&offset=0&limit=2&warehouseId=' +
    encodeURIComponent(r.whId) +
    '&' +
    cfg.siteQuery;
  delete r.assignBody;
  delete r.assignUrlBase;
  return r;
}
function unlinkedMatches(r, a) {
  return (
    a &&
    typeof a.appointmentId === 'string' &&
    a.appointmentId &&
    a.resourceId === a.appointmentId &&
    a.warehouseId === r.whId &&
    a.appointmentType === 'S' &&
    a.trailerCode === 'RCV' &&
    a.carrierCode === r.carcod &&
    a.slotId === r.slotId &&
    Date.parse(a.startDate) === Date.parse(r.startIso) &&
    Date.parse(a.endDate) === Date.parse(r.endIso) &&
    a.externalAppointmentId === r.inboundAppointmentKey &&
    !a.masterReceiptId &&
    !a.carrierMoveId &&
    !a.trailerId &&
    !a.trailerNumber &&
    a.trailerCheckedIn === false &&
    a.close === false &&
    a.dispatch === false &&
    !a.recurringAppointmentId &&
    (!Array.isArray(a.inboundLoads) || a.inboundLoads.length === 0)
  );
}
export function checkUnlinkedInbound(row, response) {
  const r = { ...row };
  const result = inboundResponse(response);
  const list = result.body?.data;
  if (
    !r.inboundUnlinked ||
    !result.ok ||
    !Array.isArray(list) ||
    (result.body.totalCount !== undefined &&
      result.body.totalCount !== list.length) ||
    list.length > 1
  )
    return inboundStop(
      r,
      'Could not rule out an existing inbound appointment. No new appointment was created.',
    );
  if (!list.length) return { ...r, shouldCreate: true };
  if (!unlinkedMatches(r, list[0]))
    return inboundStop(
      r,
      'An appointment with this inbound reference already exists but its details differ or it is active. Review it manually.',
    );
  return {
    ...r,
    shouldCreate: false,
    appointmentId: list[0].appointmentId,
    appointmentReused: true,
    appointmentVerified: false,
    stepAppointment: 200,
    stepLink: 0,
    ok: false,
    reason:
      'Matching appointment found; its current details and reference notes still need verification.',
    _inboundStandaloneResult: true,
  };
}
export function verifyUnlinkedInbound(row, response) {
  const r = { ...row, _inboundStandaloneResult: true, stepLink: 0 };
  const result = inboundResponse(response);
  const a =
    result.ok && !Array.isArray(result.body.data) ? result.body.data : null;
  if (!a || a.appointmentId !== r.appointmentId || !unlinkedMatches(r, a))
    return inboundStop(
      r,
      'An inbound appointment exists but its ID, date, carrier or unlinked status could not be verified. Check Blue Yonder before retrying.',
    );
  r.appointmentVerified = true;
  r.notesReady = true;
  r.ok = false;
  r.reason =
    'Appointment details verified; reference notes still need verification.';
  return r;
}

export function planInboundNotes(row, response, allowSave = true) {
  const r = { ...row, shouldSaveNotes: false, notesVerified: false, ok: false };
  const result = inboundResponse(response);
  const notes = result.body?.data;
  if (
    !r.inboundUnlinked ||
    !r.appointmentVerified ||
    !r.notesReady ||
    !r.appointmentId ||
    !r.inboundNote ||
    !result.ok ||
    !Array.isArray(notes) ||
    notes.length > 1 ||
    (result.body.totalCount !== undefined &&
      result.body.totalCount !== notes.length) ||
    notes.some((note) => note.appointmentId !== r.appointmentId)
  )
    return inboundStop(
      r,
      'The appointment reference notes could not be verified. Check Blue Yonder before retrying.',
    );

  if (notes.length === 1 && notes[0].noteText === r.inboundNote) {
    r.notesVerified = true;
    r.ok = true;
    r.reason =
      (r.appointmentReused
        ? 'Existing receiving appointment'
        : 'Receiving appointment created') +
      ' without an inbound load link. Reference verified in Appointment Notes; link the load manually when available.';
    return r;
  }
  if (
    allowSave &&
    !r.appointmentReused &&
    !notes.length &&
    r.stepAppointment >= 200 &&
    r.stepAppointment < 300
  ) {
    r.shouldSaveNotes = true;
    r.noteBody = { appointmentId: r.appointmentId, noteText: r.inboundNote };
    return r;
  }
  return inboundStop(
    r,
    'The existing appointment notes are missing or differ from the requested reference. No notes were overwritten. Review this appointment manually.',
  );
}

export function verifyInboundNotes(row, response, saveResponse) {
  const saved = inboundResponse(saveResponse);
  if (saved.status < 200 || saved.status >= 300 || saved.body?.errors)
    return inboundStop(
      row,
      'The appointment exists, but saving its reference notes was not confirmed. Check Blue Yonder before retrying.',
    );
  return planInboundNotes(row, response, false);
}
export function recordInboundResult(row, response) {
  const r = { ...row };
  if (!r.inboundUnlinked) {
    const result = inboundResponse(response);
    r.stepLink = result.status;
    r.ok =
      r.stepAppointment >= 200 &&
      r.stepAppointment < 300 &&
      result.status >= 200 &&
      result.status < 300 &&
      !result.body?.errors;
    if (!r.ok) {
      r.linkError = (result.body?.errors || [])
        .map((e) => e.userMessage || e.message || '')
        .filter(Boolean)
        .join('; ');
      r.reason = r.linkError
        ? 'Link truck to appointment: ' + r.linkError
        : 'Inbound link was not confirmed. Review the created appointment before retrying.';
      r.manualReviewRequired = !!r.appointmentId;
    }
  }
  for (const key of [
    'apptBody',
    'assignBody',
    'assignUrl',
    'assignUrlBase',
    'inboundLookupUrl',
    'lookupUrl',
    'inboundDuplicateUrl',
    'noteBody',
    'notesReady',
    'shouldSaveNotes',
    '_inboundStandaloneResult',
  ])
    delete r[key];
  return r;
}
