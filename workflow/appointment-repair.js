const REPAIR_BASE = 'https://bf56-kms-wms-web-pr9.jdadelivers.com/data/WM/wm';
const REPAIR_SITE = 'siteId=AZ02&subsites=COKE&subsites=FAIRLIFE';
const REPAIR_ACTIVITY = [
  'pickQuantity',
  'pickedQuantity',
  'actualLpnPicks',
  'actualSubLpnPicks',
  'actualDetailLpnPicks',
  'completedLpnPicks',
  'completedSubLpnPicks',
  'completedDetailPicks',
];
const REPAIR_PHASES = {
  load: 'Checking the load',
  appointment: 'Checking the existing appointment',
  waves: 'Finding linked waves',
  targetName: 'Finding the saved wave name',
  wave: 'Checking allocation',
  waveLoads: 'Checking wave ownership',
  picks: 'Checking wave picks',
  shipment: 'Checking the saved shipment',
  shipmentWaves: 'Checking shipment waves',
  loadPicks: 'Checking load picks',
  wavableLines: 'Checking wavable shipment lines',
  recheckAppointment: 'Rechecking the appointment',
  recheckLoad: 'Rechecking the load',
  recheckWaves: 'Rechecking linked waves',
  recheckShipment: 'Rechecking the saved shipment',
  recheckShipmentWaves: 'Rechecking shipment waves',
  recheckLoadPicks: 'Rechecking load picks',
  recheckTargetName: 'Checking for a duplicate wave',
  recheckWave: 'Rechecking allocation',
  recheckPicks: 'Rechecking wave picks',
  cancelWave: 'Deleting the old unallocated wave',
  pollWave: 'Waiting for wave deletion',
  verifyWavesGone: 'Verifying wave deletion',
  createWave: 'Creating and linking the saved wave',
  pollCreateWave: 'Waiting for wave creation',
  verifyCreatedWaves: 'Verifying the created wave link',
  moveAppointment: 'Moving the existing appointment',
  verifyMovedAppointment: 'Verifying the appointment time',
  verifyMovedLoad: 'Verifying the appointment assignment',
  verifyFinalWaves: 'Verifying the final wave link',
  verifyFinalShipmentWaves: 'Verifying the final shipment link',
};
function repairParse(value, fallback) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback);
  } catch {
    return fallback;
  }
}
function repairDate(value) {
  return new Date(value - 7 * 3600000).toISOString().slice(0, 10);
}
function repairStop(s, status, note, uncertain = false) {
  s.phase = 'done';
  s.audit.recoveryStatus = status;
  s.audit.recoveryNote = note;
  s.audit.repairNeedsReview = uncertain;
  s.audit.manualReviewRequired = true;
  return s;
}
function repairResponse(response) {
  const body = repairParse(response.body ?? response.data, null),
    status = Number(response.statusCode);
  return {
    status,
    body,
    ok:
      Number.isInteger(status) &&
      status >= 200 &&
      status < 300 &&
      body &&
      typeof body === 'object' &&
      !body.errors,
  };
}
function repairList(result) {
  if (!result.ok || !Array.isArray(result.body.data)) return null;
  const list = result.body.data;
  if (
    result.body.totalCount !== undefined &&
    result.body.totalCount !== list.length
  )
    return null;
  return list;
}
function repairObject(result) {
  if (!result.ok) return null;
  const d = result.body.data;
  return Array.isArray(d)
    ? d.length === 1
      ? d[0]
      : null
    : d && typeof d === 'object'
      ? d
      : null;
}
function repairLoadMatches(s, l, appointment) {
  return (
    l &&
    l.resourceId === s.loadResourceId &&
    l.carrierMoveId === s.row.carMoveId &&
    l.warehouseId === 'AZ02' &&
    (!appointment || l.appointmentId === appointment)
  );
}
function repairAppMatches(s, a, id) {
  return (
    a &&
    a.appointmentId === id &&
    a.resourceId === id &&
    a.carrierMoveId === s.row.carMoveId &&
    a.warehouseId === 'AZ02' &&
    a.appointmentType === 'S' &&
    a.trailerCode === 'SHIP'
  );
}
function repairAppSafe(a) {
  return (
    a &&
    a.dispatch === false &&
    a.close === false &&
    a.trailerCheckedIn === false &&
    !a.trailerId &&
    !a.trailerNumber &&
    !a.trailerArrivalDate &&
    !a.closeDate &&
    !a.recurringAppointmentId &&
    !a.recurrenceRule &&
    !a.advancedAllocation &&
    !a.storageLocation
  );
}
function repairAppFingerprint(a) {
  return JSON.stringify([
    a.resourceId,
    a.carrierMoveId,
    a.warehouseId,
    a.startDate,
    a.endDate,
    a.slotId,
    a.carrierCode,
    a.version,
    a.dateLastModified,
    a.dispatch,
    a.close,
    a.trailerCheckedIn,
    a.trailerId,
    a.storageLocation,
    a.advancedAllocation,
    a.recurringAppointmentId,
    a.recurrenceRule,
  ]);
}
function repairLoadSafe(l) {
  return (
    l &&
    ['close', 'dispatch', 'isLoading', 'loaded'].every(
      (k) => l[k] === 0 || l[k] === false,
    ) &&
    !l.arrivalDate &&
    !l.loadedDate &&
    !l.trailerId &&
    !l.trailerNumber &&
    !l.location
  );
}
function repairShipmentMatches(s, p) {
  return (
    p &&
    p.resourceId === s.row.shipmentId &&
    p.shipmentId === s.row.shipmentId &&
    p.warehouseId === 'AZ02' &&
    p.carrierMoveId === s.row.carMoveId
  );
}
function repairWaveList(list, name) {
  return (
    !!list &&
    list.length === (name ? 1 : 0) &&
    (!name ||
      (list[0].waveNumber === name &&
        (list[0].warehouseId == null || list[0].warehouseId === 'AZ02')))
  );
}
function repairAppTimeMatches(s, a) {
  return (
    Date.parse(a.startDate) === Date.parse(s.row.startIso) &&
    Date.parse(a.endDate) === Date.parse(s.row.endIso) &&
    a.slotId === s.row.slotId
  );
}
function repairReady(s) {
  if (s.waveMode === 'create') {
    s.phase = 'createWave';
    return s;
  }
  if (s.waveMode === 'replace') {
    s.phase = 'cancelWave';
    return s;
  }
  s.audit.waveLinked = true;
  s.audit.verifiedWave = s.row.schbat;
  s.audit.waveCreated = !!s.createdWavePending;
  s.audit.waveReused = !s.createdWavePending;
  s.audit.appointmentId = s.audit.previousAppointmentId;
  if (repairAppTimeMatches(s, s.appointment))
    return repairStop(
      s,
      'Wave ready — appointment already correct',
      'The saved wave and shipment link were verified. The appointment already has the requested date, time and slot. Manually verify this load before further processing.',
    );
  s.phase = 'moveAppointment';
  return s;
}
function repairWaveSafe(s, w) {
  if (!w || w.waveNumber !== s.waveNumber || w.warehouseId !== 'AZ02')
    return 'The wave identity or warehouse could not be verified.';
  const labels = {
    ALOC: 'Allocated',
    AINP: 'Allocation in progress',
    REL: 'Released',
    SCH: 'Scheduled for release',
    CMPL: 'Complete',
  };
  if (
    labels[w.waveStatus] ||
    w.dateReleased ||
    w.dateCompleted ||
    REPAIR_ACTIVITY.some((k) => typeof w[k] === 'number' && w[k] > 0) ||
    [w.pickCount, w.totalShipmentsStaged, w.replCount, w.xdkCount].some(
      (v) => typeof v === 'number' && v > 0,
    )
  ) {
    s.audit.allocationStatus =
      labels[w.waveStatus] || 'Allocation or work activity';
    return 'The wave has allocation or work activity and must remain unchanged.';
  }
  if (
    w.waveStatus !== 'PLAN' ||
    w.pickCount !== 0 ||
    w.totalShipmentsStaged !== 0 ||
    w.replCount !== 0 ||
    w.xdkCount !== 0 ||
    REPAIR_ACTIVITY.some(
      (k) =>
        w[k] != null &&
        (typeof w[k] !== 'number' || !Number.isFinite(w[k]) || w[k] !== 0),
    )
  )
    return 'Allocation is not confirmed as empty; manual review is required.';
  if (w.loadCount !== 1 || w.totalShipments !== 1)
    return 'The wave does not belong to exactly one load and shipment; manual review is required.';
  const expected = REPAIR_BASE + '/waves/' + encodeURIComponent(s.waveNumber);
  if (
    w.picks_uri !== expected + '/picks' ||
    w.loads_uri !== expected + '/outboundLoads'
  )
    return 'Wave association links could not be verified.';
  s.audit.allocationStatus = 'Unallocated';
  return '';
}
export function startRepair(run, q, now = Date.now()) {
  if (q.confirm !== true)
    throw new Error('Confirm the production appointment repair.');
  if (
    !run?.runId ||
    String(q.runId) !== run.runId ||
    !['completed', 'completed_with_issues', 'failed'].includes(run.status)
  )
    throw new Error(
      'The selected run must finish before repairing an appointment.',
    );
  if (q.expectedUpdatedAt !== run.updatedAt)
    throw new Error('The run has changed. Refresh before continuing.');
  if (
    !Number.isInteger(q.rowIndex) ||
    q.rowIndex < 0 ||
    !/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/i.test(q.repairId || '')
  )
    throw new Error('The repair request is invalid.');
  const summary = repairParse(run.summaryJson, {}),
    storedRow = summary.results?.[q.rowIndex];
  const row = storedRow
    ? { ...storedRow, whId: storedRow.whId ?? 'AZ02' }
    : null;
  if (!row || row.carMoveId !== q.load)
    throw new Error('The selected load no longer matches the saved result.');
  if (row.direction !== 'OB' || row.whId !== 'AZ02')
    throw new Error(
      'Only outbound AZ02 appointment conflicts can be repaired here.',
    );
  if (
    row.appointmentConflict !== true &&
    !/load has been assigned to another appoi(?:nt|t)ment/i.test(
      String(row.apptWarning || ''),
    )
  )
    throw new Error('This load has no recorded appointment conflict.');
  if (summary.appointmentRepairs?.some((a) => a.repairId === q.repairId))
    throw new Error(
      'This repair request was already submitted. Refresh to see its result.',
    );
  if (
    row.repairWriteAttempted ||
    row.appointmentMoved ||
    row.waveCreated ||
    row.appointmentRecreated ||
    row.waveDeleted ||
    row.appointmentDeleted
  )
    throw new Error(
      'A previous repair changed or may have changed this load. Review it in Blue Yonder before taking further action.',
    );
  if (
    !/^[A-Za-z0-9_-]{1,100}$/.test(row.carMoveId) ||
    !String(row.carcod || '').trim() ||
    !['CHILLED_DOORS', 'AMBIENT_NORTH_DOORS', 'AMBIENT_SOUTH_DOORS'].includes(
      row.slotId,
    )
  )
    throw new Error(
      'The saved load, carrier or appointment slot is incomplete.',
    );
  if (
    typeof row.schbat !== 'string' ||
    !row.schbat.trim() ||
    row.schbat !== row.schbat.trim() ||
    row.schbat.length > 100 ||
    [...row.schbat].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(row.shipmentId || '')
  )
    throw new Error(
      'The saved wave name or shipment is incomplete. Prepare a current file before repairing this load.',
    );
  if (
    !Number.isFinite(Date.parse(row.startIso)) ||
    !Number.isFinite(Date.parse(row.endIso)) ||
    repairDate(Date.parse(row.startIso)) < repairDate(now) ||
    Date.parse(row.endIso) <= Date.parse(row.startIso) ||
    Date.parse(row.endIso) - Date.parse(row.startIso) > 86400000
  )
    throw new Error(
      'The requested appointment date is invalid or in the past. Prepare a current file.',
    );
  return {
    runId: run.runId,
    originalStatus: run.status,
    rowIndex: q.rowIndex,
    row: { ...row },
    summary,
    phase: 'load',
    startedAt: new Date(now).toISOString(),
    step: 0,
    pollCount: 0,
    repairId: q.repairId,
    actor: String(q.actor || '').slice(0, 240),
    persistedSummary: run.summaryJson,
    audit: {
      repairId: q.repairId,
      repairBy: String(q.actor || '').slice(0, 240),
      repairStartedAt: new Date(now).toISOString(),
      recoveryStatus: 'Checking',
      recoveryNote: 'Repair requested from Wave Bot.',
      allocationStatus: 'Not checked',
      intendedWave: row.schbat,
      shipmentId: row.shipmentId,
      waveCreated: false,
      waveLinked: false,
      waveReused: false,
      appointmentMoved: false,
      waveDeleted: false,
      appointmentDeleted: false,
      appointmentRecreated: false,
      repairWriteAttempted: false,
      repairNeedsReview: false,
      manualReviewRequired: true,
      previousWave: '',
      previousAppointmentId: '',
    },
  };
}
export function planRepair(input, now = Date.now()) {
  const s = JSON.parse(JSON.stringify(input));
  s.step++;
  if (
    s.phase !== 'done' &&
    (s.step > 140 || now - Date.parse(s.startedAt) > 10 * 60000)
  )
    repairStop(
      s,
      'Stopped',
      'The repair exceeded its time limit. Review the recorded actions before trying again.',
      s.audit.repairWriteAttempted,
    );
  const enc = encodeURIComponent,
    loadPath =
      REPAIR_BASE +
      '/outboundLoads/' +
      enc(s.loadResourceId || s.row.carMoveId),
    wavePath = REPAIR_BASE + '/waves/' + enc(s.waveNumber || ''),
    shipmentPath = REPAIR_BASE + '/shipments/' + enc(s.row.shipmentId),
    apptPath =
      REPAIR_BASE + '/appointments/' + enc(s.audit.previousAppointmentId || '');
  const get = (url) => ({ method: 'GET', url, body: {} }),
    withSite = (url) => url + (url.includes('?') ? '&' : '?') + REPAIR_SITE;
  const query = (column, value) =>
    enc(
      JSON.stringify([
        { column, operator: 'EQ', value, options: { exact: [true, true] } },
      ]),
    );
  let request,
    route = 1;
  switch (s.phase) {
    case 'done':
      route = 0;
      break;
    case 'load':
    case 'recheckLoad':
    case 'verifyMovedLoad':
      request = get(
        withSite(
          REPAIR_BASE +
            '/outboundLoads?query=' +
            query('carrierMoveId', s.row.carMoveId) +
            '&offset=0&limit=2',
        ),
      );
      break;
    case 'appointment':
    case 'recheckAppointment':
    case 'verifyMovedAppointment':
      request = get(withSite(apptPath));
      break;
    case 'waves':
    case 'recheckWaves':
    case 'verifyWavesGone':
    case 'verifyCreatedWaves':
    case 'verifyFinalWaves':
      request = get(withSite(loadPath + '/waves?warehouseId=AZ02'));
      break;
    case 'targetName':
    case 'recheckTargetName':
      request = get(
        withSite(
          REPAIR_BASE +
            '/waves?query=' +
            query('waveNumber', s.row.schbat) +
            '&offset=0&limit=2',
        ),
      );
      break;
    case 'wave':
    case 'recheckWave':
      request = get(
        withSite(
          REPAIR_BASE +
            '/waves/waveDetail?schbat=' +
            enc(s.waveNumber) +
            '&wh_id=AZ02',
        ),
      );
      break;
    case 'waveLoads':
      request = get(withSite(wavePath + '/outboundLoads?offset=0&limit=2'));
      break;
    case 'picks':
    case 'recheckPicks':
      request = get(withSite(wavePath + '/picks?offset=0&limit=1'));
      break;
    case 'shipment':
    case 'recheckShipment':
      request = get(withSite(shipmentPath));
      break;
    case 'shipmentWaves':
    case 'recheckShipmentWaves':
    case 'verifyFinalShipmentWaves':
      request = get(withSite(shipmentPath + '/waves?warehouseId=AZ02'));
      break;
    case 'loadPicks':
    case 'recheckLoadPicks':
      request = get(withSite(loadPath + '/picks?offset=0&limit=1'));
      break;
    case 'wavableLines':
      request = get(
        withSite(
          shipmentPath +
            '/wavableShipmentLines?rule_nam=OUTBND-SHIPSELECTION&wh_id=AZ02&ship_id_list=' +
            enc("'" + s.row.shipmentId + "'"),
        ),
      );
      break;
    case 'cancelWave':
      route = 2;
      request = {
        method: 'PUT',
        url: withSite(REPAIR_BASE + '/waves/cancelWave/async'),
        body: s.wave,
      };
      break;
    case 'pollWave':
    case 'pollCreateWave':
      request = get(s.pollUrl);
      break;
    case 'createWave':
      route = 3;
      request = {
        method: 'POST',
        url: withSite(
          REPAIR_BASE +
            '/waves/planWave/async?rule_nam=OUTBND-SHIPSELECTION&dtlFlg=0&warehouseId=AZ02&car_move_id=' +
            enc(s.row.carMoveId) +
            '&rush_flg=0',
        ),
        body: {
          shipmentList: "'" + s.row.shipmentId + "'",
          dtlFlg: 0,
          warehouseId: 'AZ02',
          waveNumber: s.row.schbat,
          waveSet: '',
        },
      };
      break;
    case 'moveAppointment':
      route = 4;
      request = {
        method: 'PUT',
        url: withSite(apptPath + '?ignoreWarnings=false'),
        body: {
          ...s.appointment,
          startDate: s.row.startIso,
          endDate: s.row.endIso,
          slotId: s.row.slotId,
        },
      };
      break;
    default:
      throw new Error('Unknown repair stage.');
  }
  if (
    request &&
    (!request.url.startsWith(REPAIR_BASE + '/') || /[\r\n#]/.test(request.url))
  )
    throw new Error('Unexpected repair request destination.');
  if (route >= 2) {
    if (repairDate(Date.parse(s.row.startIso)) < repairDate(now))
      return planRepair(
        repairStop(
          s,
          'Stopped',
          'The requested appointment date has passed.',
          s.audit.repairWriteAttempted,
        ),
        now,
      );
    if (
      !s.loadVerified ||
      !s.appointmentVerified ||
      !s.shipmentVerified ||
      !s.shipmentWavesVerified ||
      !s.loadPicksVerified
    )
      throw new Error(
        'Load, appointment and shipment safeguards are incomplete.',
      );
    if (
      route === 2 &&
      (s.waveMode !== 'replace' ||
        !s.targetNameAbsent ||
        !s.picksVerified ||
        repairWaveSafe(s, s.wave))
    )
      throw new Error('Wave deletion safeguards are incomplete.');
    if (
      route === 3 &&
      (s.waveMode !== 'create' ||
        !s.targetNameAbsent ||
        !s.emptyWavesVerified ||
        !s.wavableVerified)
    )
      throw new Error('Wave creation safeguards are incomplete.');
    if (
      route === 4 &&
      (s.waveMode !== 'reuse' ||
        !s.audit.waveLinked ||
        s.waveNumber !== s.row.schbat ||
        !s.picksVerified ||
        repairWaveSafe(s, s.wave))
    )
      throw new Error('Appointment movement safeguards are incomplete.');
    s.audit.repairWriteAttempted = true;
    s.audit.lastWriteStage = s.phase;
  }
  s.audit.recoveryCheckedAt = new Date(now).toISOString();
  if (s.phase !== 'done') {
    s.audit.recoveryStatus = REPAIR_PHASES[s.phase];
    s.audit.recoveryNote =
      route >= 2
        ? 'Production change requested. Check the final result before retrying.'
        : 'Repair in progress. Wait for its recorded result before submitting another action.';
  }
  s.route = route;
  s.request = request || { method: 'GET', url: '', body: {} };
  return s;
}
export function applyRepairResponse(input, response, now = Date.now()) {
  const s = JSON.parse(JSON.stringify(input)),
    r = repairResponse(response),
    list = repairList(r),
    obj = repairObject(r);
  const stop = (note) =>
    repairStop(
      s,
      s.audit.repairWriteAttempted
        ? 'Manual review required'
        : 'Protected — left unchanged',
      note,
      s.audit.repairWriteAttempted,
    );
  if (s.phase === 'moveAppointment' && r.status === 204) {
    s.phase = 'verifyMovedAppointment';
    return s;
  }
  if (!r.ok)
    return stop(
      'Blue Yonder did not confirm ' +
        (REPAIR_PHASES[s.phase] || s.phase).toLowerCase() +
        ' (HTTP ' +
        (r.status || 'unavailable') +
        '). No automatic retry was sent.',
    );
  switch (s.phase) {
    case 'load': {
      const l = list?.length === 1 ? list[0] : null;
      if (
        !l ||
        l.carrierMoveId !== s.row.carMoveId ||
        l.warehouseId !== 'AZ02' ||
        !l.appointmentId ||
        l.resourceId !== s.row.carMoveId ||
        l.waves_uri !==
          REPAIR_BASE +
            '/outboundLoads/' +
            encodeURIComponent(l.resourceId) +
            '/waves' ||
        !repairLoadSafe(l)
      )
        return stop(
          'The load and its existing appointment could not be identified as one inactive outbound load.',
        );
      s.loadResourceId = l.resourceId;
      s.audit.previousAppointmentId = l.appointmentId;
      s.phase = 'appointment';
      break;
    }
    case 'appointment':
      if (
        !repairAppMatches(s, obj, s.audit.previousAppointmentId) ||
        !repairAppSafe(obj)
      )
        return stop(
          'The existing appointment has active, recurring or unverified details and cannot be moved.',
        );
      s.appointment = obj;
      s.appointmentFingerprint = repairAppFingerprint(obj);
      s.audit.previousAppointmentStart = obj.startDate;
      s.audit.previousAppointmentEnd = obj.endDate;
      s.phase = 'waves';
      break;
    case 'waves':
      if (
        !list ||
        list.length > 1 ||
        (list.length === 1 &&
          (!list[0].waveNumber ||
            (list[0].warehouseId != null && list[0].warehouseId !== 'AZ02')))
      )
        return stop(
          'Linked waves could not be identified uniquely. Multiple waves need manual review.',
        );
      if (list.length === 0) {
        s.waveMode = 'create';
        s.waveNumber = s.row.schbat;
        s.audit.allocationStatus =
          'No linked wave — checking shipment and picks';
        s.phase = 'targetName';
      } else {
        s.waveNumber = list[0].waveNumber;
        s.audit.previousWave = s.waveNumber;
        s.waveMode = s.waveNumber === s.row.schbat ? 'reuse' : 'replace';
        s.phase = 'wave';
      }
      break;
    case 'targetName':
    case 'recheckTargetName':
      if (!list || list.length !== 0)
        return stop(
          'The saved wave name already exists or its absence could not be verified. No duplicate wave will be created; review its current load and shipment links.',
        );
      s.targetNameAbsent = true;
      if (s.phase === 'recheckTargetName') return repairReady(s);
      s.phase = 'shipment';
      break;
    case 'wave': {
      const reason = repairWaveSafe(s, obj);
      if (reason) return stop(reason);
      s.wave = obj;
      s.phase = 'waveLoads';
      break;
    }
    case 'waveLoads':
      if (
        !list ||
        list.length !== 1 ||
        !repairLoadMatches(s, list[0], s.audit.previousAppointmentId)
      )
        return stop('The wave is shared or its load association changed.');
      s.phase = 'picks';
      break;
    case 'picks':
      if (!list || list.length !== 0)
        return stop('Wave pick work could not be confirmed as empty.');
      s.picksVerified = true;
      s.phase = s.waveMode === 'replace' ? 'targetName' : 'shipment';
      break;
    case 'shipment':
    case 'recheckShipment':
      if (!repairShipmentMatches(s, obj))
        return stop(
          'The saved shipment is missing or is not uniquely linked to this load in AZ02.',
        );
      s.shipmentVerified = true;
      s.phase =
        s.phase === 'shipment' ? 'shipmentWaves' : 'recheckShipmentWaves';
      break;
    case 'shipmentWaves':
    case 'recheckShipmentWaves':
      if (!repairWaveList(list, s.waveMode === 'create' ? '' : s.waveNumber))
        return stop(
          'The saved shipment has an unexpected wave association. No further changes were sent.',
        );
      s.shipmentWavesVerified = true;
      s.phase = s.phase === 'shipmentWaves' ? 'loadPicks' : 'recheckLoadPicks';
      break;
    case 'loadPicks':
    case 'recheckLoadPicks':
      if (!list || list.length !== 0)
        return stop(
          'The load has pick work or its pick work could not be confirmed as empty.',
        );
      s.loadPicksVerified = true;
      s.phase =
        s.phase === 'loadPicks'
          ? s.waveMode === 'create'
            ? 'wavableLines'
            : 'recheckAppointment'
          : s.waveMode === 'create'
            ? 'recheckTargetName'
            : 'recheckWave';
      break;
    case 'wavableLines':
      if (!Array.isArray(r.body.data) || r.body.data.length === 0)
        return stop(
          'The saved shipment has no confirmed wavable lines. The appointment was left at its existing time.',
        );
      s.wavableVerified = true;
      s.phase = 'recheckAppointment';
      break;
    case 'recheckAppointment':
      if (
        !repairAppMatches(s, obj, s.audit.previousAppointmentId) ||
        !repairAppSafe(obj) ||
        repairAppFingerprint(obj) !== s.appointmentFingerprint
      )
        return stop(
          'The existing appointment changed during inspection. No further changes were sent.',
        );
      s.appointment = obj;
      s.appointmentVerified = true;
      s.phase = 'recheckLoad';
      break;
    case 'recheckLoad':
      if (
        !list ||
        list.length !== 1 ||
        !repairLoadMatches(s, list[0], s.audit.previousAppointmentId) ||
        !repairLoadSafe(list[0])
      )
        return stop(
          'The load assignment or activity changed during inspection. No further changes were sent.',
        );
      s.loadVerified = true;
      s.phase = 'recheckWaves';
      break;
    case 'recheckWaves':
      if (!repairWaveList(list, s.waveMode === 'create' ? '' : s.waveNumber))
        return stop(
          'A wave appeared or the load wave association changed during inspection.',
        );
      s.emptyWavesVerified = s.waveMode === 'create';
      s.phase = 'recheckShipment';
      break;
    case 'recheckWave': {
      const reason = repairWaveSafe(s, obj);
      if (reason) return stop(reason);
      if (obj.dateLastModified !== s.wave.dateLastModified)
        return stop(
          'The wave changed during inspection. Review it before trying again.',
        );
      s.wave = obj;
      s.phase = 'recheckPicks';
      break;
    }
    case 'recheckPicks':
      if (!list || list.length !== 0)
        return stop(
          'Pick work appeared during inspection. No further changes were sent.',
        );
      return repairReady(s);
    case 'cancelWave':
    case 'createWave': {
      const creating = s.phase === 'createWave',
        uri = obj?.asynchronousResources_uri,
        prefix =
          REPAIR_BASE +
          '/waves/' +
          (creating ? 'planWave' : 'cancelWave') +
          '/async/';
      if (
        typeof uri !== 'string' ||
        !uri.startsWith(prefix) ||
        !/^https:\/\/[^?#]+(?:\?[^#]*)?$/.test(uri) ||
        /[\r\n]/.test(uri)
      )
        return stop(
          'The wave change was submitted, but its tracking address could not be verified.',
        );
      s.pollUrl = uri;
      s.pollCount = 0;
      s.phase = creating ? 'pollCreateWave' : 'pollWave';
      break;
    }
    case 'pollWave':
    case 'pollCreateWave': {
      if (!list || list.length !== 1)
        return stop(
          'The wave change returned an unexpected tracking response.',
        );
      const status = list[0].asynchronousStatus;
      if (status === 'COMPLETE')
        s.phase =
          s.phase === 'pollCreateWave'
            ? 'verifyCreatedWaves'
            : 'verifyWavesGone';
      else if (status === 'FAILURE' || ++s.pollCount >= 30)
        return stop(
          'The wave change did not finish successfully. No appointment move was sent.',
        );
      break;
    }
    case 'verifyWavesGone':
      if (!repairWaveList(list, ''))
        return stop(
          'Wave deletion completed, but the load still has a wave or its associations could not be verified.',
        );
      s.audit.waveDeleted = true;
      s.waveMode = 'create';
      s.waveNumber = s.row.schbat;
      s.loadVerified = false;
      s.appointmentVerified = false;
      s.shipmentVerified = false;
      s.shipmentWavesVerified = false;
      s.loadPicksVerified = false;
      s.picksVerified = false;
      s.targetNameAbsent = false;
      s.emptyWavesVerified = false;
      s.wavableVerified = false;
      s.phase = 'targetName';
      break;
    case 'verifyCreatedWaves':
      if (!repairWaveList(list, s.row.schbat))
        return stop(
          'Wave creation completed, but the saved wave was not uniquely linked to this load.',
        );
      s.createdWavePending = true;
      s.waveMode = 'reuse';
      s.waveNumber = s.row.schbat;
      s.loadVerified = false;
      s.appointmentVerified = false;
      s.shipmentVerified = false;
      s.shipmentWavesVerified = false;
      s.loadPicksVerified = false;
      s.picksVerified = false;
      s.phase = 'wave';
      break;
    case 'moveAppointment':
      s.phase = 'verifyMovedAppointment';
      break;
    case 'verifyMovedAppointment':
      if (
        !repairAppMatches(s, obj, s.audit.previousAppointmentId) ||
        !repairAppSafe(obj) ||
        !repairAppTimeMatches(s, obj)
      )
        return stop(
          'The appointment update did not match the saved load, date, time and slot.',
        );
      s.phase = 'verifyMovedLoad';
      break;
    case 'verifyMovedLoad':
      if (
        !list ||
        list.length !== 1 ||
        !repairLoadMatches(s, list[0], s.audit.previousAppointmentId) ||
        !repairLoadSafe(list[0])
      )
        return stop(
          'The appointment time was updated, but its load assignment could not be verified.',
        );
      s.phase = 'verifyFinalWaves';
      break;
    case 'verifyFinalWaves':
      if (!repairWaveList(list, s.row.schbat))
        return stop(
          'The appointment time was updated, but the final wave link could not be verified.',
        );
      s.phase = 'verifyFinalShipmentWaves';
      break;
    case 'verifyFinalShipmentWaves':
      if (!repairWaveList(list, s.row.schbat))
        return stop(
          'The appointment time was updated, but the final shipment wave link could not be verified.',
        );
      s.audit.appointmentMoved = true;
      return repairStop(
        s,
        'Wave ready — appointment moved',
        'The saved wave ' +
          s.row.schbat +
          ' was ' +
          (s.audit.waveCreated ? 'created' : 'reused') +
          ' and its load and shipment links were verified. Appointment ' +
          s.audit.previousAppointmentId +
          ' was moved to the requested date, time and slot. Manually verify this load before further processing.',
      );
    default:
      return stop('An unexpected repair response was received.');
  }
  s.audit.recoveryCheckedAt = new Date(now).toISOString();
  return s;
}
export function repairSummary(s) {
  const summary = JSON.parse(JSON.stringify(s.summary)),
    audit = {
      ...s.audit,
      load: s.row.carMoveId,
      order: s.row.ordnum,
      requestedStart: s.row.startIso,
      requestedEnd: s.row.endIso,
      phase: s.phase,
    };
  summary.results[s.rowIndex] = {
    ...summary.results[s.rowIndex],
    ...s.audit,
    appointmentConflict: true,
  };
  const history = Array.isArray(summary.appointmentRepairs)
    ? summary.appointmentRepairs
    : [];
  summary.appointmentRepairs = [
    ...history.filter((a) => a.repairId !== s.repairId),
    audit,
  ];
  summary.repairActive = s.phase !== 'done' ? audit : null;
  return summary;
}
