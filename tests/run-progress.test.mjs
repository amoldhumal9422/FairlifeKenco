import test from 'node:test';
import assert from 'node:assert/strict';
import {
  displayProgress,
  oldReviewFiles,
  filterRuns,
} from '../lib/run-progress.ts';
test('file review is the end of preparation, not permission to run production', () => {
  const p = displayProgress({ status: 'pending' });
  assert.equal(p.percent, 100);
  assert.equal(p.mode, 'preparation');
  assert.equal(p.active, false);
});
test('active runs without an execution update show unknown progress', () => {
  assert.equal(displayProgress({ status: 'running' }).percent, null);
});
test('failed and stopped runs do not falsely display 100 percent', () => {
  for (const status of ['failed', 'stopped', 'repair_attention'])
    assert.notEqual(displayProgress({ status }).percent, 100);
});
test('progress for a previous execution is ignored', () => {
  assert.equal(
    displayProgress(
      { status: 'running', executionId: '12' },
      { mode: 'production', executionId: '11', percent: 80, stage: 'Old' },
    ).percent,
    null,
  );
});
test('old review cleanup excludes production, finished runs, and repair review', () => {
  const statuses = [
    'pending',
    'rejected',
    'failed',
    'stopped',
    'running',
    'generating',
    'repairing',
    'repair_attention',
    'completed',
    'discarded',
  ];
  const rows = statuses.map((status, i) => ({
    runId: String(i),
    status,
    createdAt: '2026-09-01T12:00:00Z',
  }));
  assert.deepEqual(
    oldReviewFiles(rows, '2026-09-05').map((r) => r.status),
    statuses.slice(0, 4),
  );
  assert.equal(
    oldReviewFiles(
      [
        ...rows,
        { runId: 'new', status: 'pending', createdAt: '2026-09-06T12:00:00Z' },
      ],
      '2026-09-05',
    ).length,
    4,
  );
  assert.equal(oldReviewFiles(rows, 'invalid').length, 0);
});
test('history search combines status and date without dropping hidden history', () => {
  const rows = [
    {
      runId: '7',
      status: 'pending',
      planDate: '2026-09-13',
      fileName: 'Arizona.xlsx',
    },
    {
      runId: '8',
      status: 'completed',
      planDate: '2026-09-13',
      fileName: 'Arizona.xlsx',
    },
  ];
  assert.equal(filterRuns(rows, 'arizona', 'pending', '2026-09-13').length, 1);
  assert.equal(filterRuns(rows, '', 'all', '').length, 2);
});
