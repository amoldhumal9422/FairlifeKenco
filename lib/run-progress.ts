export type ProgressSnapshot = {
  mode: 'preparation' | 'production' | 'repair';
  percent: number | null;
  stage: string;
  executionId?: string;
  checkedAt?: string;
  lastEventAt?: string;
  lastCompletedStep?: string;
  processed?: number | null;
  total?: number | null;
  failed?: number | null;
  timeline?: { step: string; at: string }[];
};
type ProgressRun = {
  status: string;
  executionId?: string;
  summary?: {
    runControl?: { progress?: ProgressSnapshot };
    repairActive?: Record<string, unknown> | null;
  };
};
export function displayProgress(run: ProgressRun, observed?: ProgressSnapshot) {
  const active = ['generating', 'running', 'repairing'].includes(run.status);
  const mode =
    run.status === 'generating' || ['pending', 'rejected'].includes(run.status)
      ? 'preparation'
      : run.status.startsWith('repair')
        ? 'repair'
        : 'production';
  const repairExecutionId = run.summary?.repairActive?.repairExecutionId;
  const expectedId =
    run.status === 'repairing'
      ? typeof repairExecutionId === 'string' ||
        typeof repairExecutionId === 'number'
        ? String(repairExecutionId)
        : ''
      : run.executionId;
  const snapshot =
    observed &&
    (!expectedId || observed.executionId === expectedId) &&
    (!active || observed.mode === mode)
      ? observed
      : run.summary?.runControl?.progress;
  const percent = snapshot?.percent;
  const base: ProgressSnapshot & { active: boolean } = {
    ...snapshot,
    mode: snapshot?.mode || mode,
    active,
    percent:
      typeof percent === 'number' && Number.isFinite(percent)
        ? Math.max(0, Math.min(99, percent))
        : null,
    stage: snapshot?.stage || 'Waiting for the first saved step',
  };
  if (run.status === 'pending')
    return {
      ...base,
      mode: 'preparation' as const,
      percent: 100,
      stage: 'File ready for your review',
    };
  if (run.status === 'rejected')
    return {
      ...base,
      mode: 'preparation' as const,
      percent: 100,
      stage: 'Choose a replacement workbook',
    };
  if (['completed', 'completed_with_issues'].includes(run.status))
    return {
      ...base,
      percent: 100,
      stage:
        run.status === 'completed'
          ? 'Run complete'
          : 'Run finished with issues to review',
    };
  if (!active)
    return {
      ...base,
      stage:
        (
          {
            failed: 'Run failed',
            stopped: 'Run stopped',
            discarded: 'Removed from review',
            repair_attention: 'Repair needs manual review',
          } as Record<string, string>
        )[run.status] || run.status,
    };
  return base;
}
type HistoryRun = {
  runId: string;
  status: string;
  createdAt?: string;
  planDate?: string;
  fileName?: string;
  replacementFileName?: string;
  requestedBy?: string;
};
export function oldReviewFiles<T extends HistoryRun>(
  runs: T[],
  through: string,
): T[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) return [];
  const end = Date.parse(through + 'T23:59:59.999-07:00');
  return runs.filter(
    (r) =>
      ['pending', 'rejected', 'failed', 'stopped'].includes(r.status) &&
      Date.parse(r.createdAt || '') <= end,
  );
}
export function filterRuns<T extends HistoryRun>(
  runs: T[],
  query: string,
  status: string,
  planDate: string,
): T[] {
  const q = query.trim().toLowerCase();
  return runs.filter(
    (r) =>
      (status === 'all' || r.status === status) &&
      (!planDate || r.planDate === planDate) &&
      (!q ||
        [r.runId, r.fileName, r.replacementFileName, r.requestedBy].some((v) =>
          String(v || '')
            .toLowerCase()
            .includes(q),
        )),
  );
}
