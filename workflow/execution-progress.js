export function executionProgress(
  run,
  execution,
  checkedAt = new Date().toISOString(),
) {
  const raw = execution.data?.resultData?.runData;
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const tasks = (name) =>
    (Array.isArray(data[name]) ? data[name] : []).filter(
      (t) =>
        t &&
        !t.error &&
        (!t.executionStatus || t.executionStatus === 'success') &&
        Array.isArray(t.data?.main),
    );
  const items = (name) =>
    tasks(name).flatMap((t) => (t.data.main[0] || []).map((i) => i.json || {}));
  const seen = (name) => tasks(name).length > 0;
  const mode =
    run.status === 'repairing'
      ? 'repair'
      : run.status === 'generating'
        ? 'preparation'
        : 'production';
  const preparation = [
    ['Get WAVING DATA (SharePoint)', 20, 'Read SharePoint workbook'],
    ['WAVING DATA', 30, 'Read source orders'],
    ['Login to OpenDock', 40, 'Connect to OpenDock'],
    ['Find warehouse', 50, 'Find Arizona appointments'],
    ['Get appointments', 60, 'Gather appointments'],
    ['Build wave sheet', 80, 'Build and classify the workbook'],
    ['Check Wave File Format', 90, 'Validate the workbook'],
    ['Wave File Ready', 95, 'Save the file for review'],
    ['Store File for Approval', 99, 'File saved; updating review status'],
  ];
  const production = [
    ['Initialize BY Login', 5, 'Connect to Blue Yonder'],
    ['Session Values', 10, 'Verify the Blue Yonder session'],
    ['Verify Session', 15, 'Validate workbook rows'],
    ['Parse and Plan Rows', 20, 'Prepare the row plan'],
    ['Load Approved Rows', 20, 'Process accepted rows'],
    ['Record Result', 20, 'Process accepted rows'],
    ['Record IB Result', 20, 'Process accepted rows'],
    ['Record Skip', 20, 'Process accepted rows'],
    ['Record Conflict Audit', 20, 'Process accepted rows'],
    ['Build Summary', 95, 'Save run results'],
    ['Save Run Results', 99, 'Results saved; finishing notifications'],
  ];
  const repairs = [
    ['Validate Repair Request', 5, 'Validate the repair request'],
    ['Initialize Repair State', 10, 'Check allocation and ownership'],
    ['Plan Repair Request', 15, 'Check allocation and ownership'],
    ['Apply Repair Response', 15, 'Check allocation and ownership'],
    ['Save Repair Completion', 99, 'Repair result saved'],
  ];
  const stages =
    mode === 'preparation'
      ? preparation
      : mode === 'repair'
        ? repairs
        : production;
  let percent = null,
    stage = 'Waiting for the first saved step';
  const timeline = [];
  for (const [name, value, label] of stages) {
    if (!seen(name)) continue;
    if (percent === null || value >= percent) {
      percent = value;
      stage = label;
    }
    const task = tasks(name).at(-1);
    const ended = Number(task.startTime) + Number(task.executionTime || 0);
    timeline.push({
      step: name,
      at:
        Number.isFinite(ended) && ended > 0
          ? new Date(ended).toISOString()
          : '',
    });
  }
  let processed = null,
    total = null,
    failed = null;
  if (mode === 'production' && seen('Load Approved Rows')) {
    total = items('Load Approved Rows').length;
    const results = [
      'Record Result',
      'Record IB Result',
      'Record Skip',
      'Record Conflict Audit',
    ].flatMap(items);
    processed = Math.min(total, results.length);
    failed = results.filter((r) => r.ok === false).length;
    if (total > 0 && (percent ?? 0) < 95) {
      percent = 20 + Math.floor((70 * processed) / total);
      stage =
        processed === total
          ? 'All rows recorded; preparing results'
          : 'Process accepted rows';
    }
  }
  if (mode === 'repair' && !seen('Save Repair Completion')) {
    const latest = ['Plan Repair Request', 'Apply Repair Response']
      .flatMap((name) =>
        tasks(name).map((t) => ({
          at: Number(t.startTime),
          state: t.data.main[0]?.[0]?.json,
        })),
      )
      .sort((a, b) => a.at - b.at)
      .at(-1)?.state;
    const phase = String(latest?.phase || '');
    if (phase.startsWith('verifyFinal')) {
      percent = 90;
      stage = 'Verify the final links and appointment';
    } else if (latest?.audit?.appointmentVerified) {
      percent = 85;
      stage = 'Recheck allocation and links after the appointment';
    } else if (
      /^(moveAppointment|verifyMovedAppointment|verifyMovedLoad)$/.test(phase)
    ) {
      percent = 80;
      stage = 'Move or verify the existing appointment';
    } else if (latest?.audit?.waveCreated || latest?.audit?.waveLinked) {
      percent = 70;
      stage = 'Verify the wave before the appointment';
    } else if (
      /^(createWave|pollCreateWave|verifyCreatedWaves|appointmentBeforeWave|loadBeforeWave)$/.test(
        phase,
      )
    ) {
      percent = 55;
      stage = 'Create or verify the intended wave';
    } else if (
      /^(replaceOldWave|pollReplaceWave|verifyOldLoadWaves|verifyOldShipmentWaves|oldWaveName)$/.test(
        phase,
      ) ||
      latest?.audit?.waveDeleted
    ) {
      percent = 40;
      stage = 'Remove and verify the old unallocated wave';
    } else if (latest) {
      percent = 25;
      stage = 'Check allocation and ownership';
    }
    if (phase === 'done') {
      percent = 95;
      stage = 'Save the repair outcome';
    }
  }
  timeline.sort(
    (a, b) =>
      Date.parse(a.at || '1970-01-01') - Date.parse(b.at || '1970-01-01'),
  );
  const last = timeline.at(-1);
  return {
    mode,
    percent,
    stage,
    processed,
    total,
    failed,
    executionId: String(execution.id || ''),
    checkedAt,
    lastEventAt: last?.at || '',
    lastCompletedStep: last?.step || '',
    timeline: timeline.slice(-6),
  };
}
