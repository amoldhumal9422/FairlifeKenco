import test from 'node:test';
import assert from 'node:assert/strict';
import { executionProgress } from '../workflow/execution-progress.js';
import { inspectExecution, prepareControl } from '../workflow/run-control.js';

const now = '2026-09-13T12:00:00Z';
function task(items = [{}], at = Date.parse(now) - 10000, extra = {}) {
  return {
    startTime: at,
    executionTime: 100,
    executionStatus: 'success',
    data: { main: [items.map((json) => ({ json }))] },
    ...extra,
  };
}
const execution = (runData) => ({
  id: '201',
  workflowId: 'w1',
  status: 'running',
  startedAt: '2026-09-13T11:50:00Z',
  data: { resultData: { runData } },
});
test('preparation progress follows completed stages, not elapsed time', () => {
  const run = { status: 'generating', executionId: '201' };
  const e = execution({ 'Get WAVING DATA (SharePoint)': [task()] });
  const p = executionProgress(run, e, now);
  assert.equal(p.mode, 'preparation');
  assert.equal(p.percent, 20);
  assert.equal(p.lastCompletedStep, 'Get WAVING DATA (SharePoint)');
  assert.equal(executionProgress(run, e, '2026-09-13T16:00:00Z').percent, 20);
});
test('unknown or errored node data cannot invent progress', () => {
  const p = executionProgress(
    { status: 'generating' },
    execution({
      'Get appointments': [
        task([], 0, { error: { message: 'private detail' } }),
      ],
      'Other node': [task()],
    }),
    now,
  );
  assert.equal(p.percent, null);
});
test('production percentage counts rows that reached the loop result', () => {
  const data = {
    'Load Approved Rows': [
      task(Array.from({ length: 10 }, () => ({ valid: true }))),
    ],
    'Record Result': [task([{ ok: true }, { ok: false }])],
    'Record IB Result': [task([{ ok: true }])],
    'Record Skip': [task([{ ok: false }])],
    'Record Conflict Audit': [task([{ ok: false }])],
  };
  const p = executionProgress({ status: 'running' }, execution(data), now);
  assert.equal(p.mode, 'production');
  assert.equal(p.processed, 5);
  assert.equal(p.total, 10);
  assert.equal(p.percent, 55);
  assert.equal(p.failed, 3);
});
test('all rows processed is not a finished run before results are saved', () => {
  const p = executionProgress(
    { status: 'running' },
    execution({
      'Load Approved Rows': [task([{}])],
      'Record Result': [task([{ ok: true }])],
    }),
    now,
  );
  assert.equal(p.percent, 90);
  assert.notEqual(p.percent, 100);
});
test('repair percentage reflects verified appointment then wave steps', () => {
  const p = executionProgress(
    { status: 'repairing' },
    execution({
      'Plan Repair Request': [
        task([
          {
            phase: 'createWave',
            audit: { appointmentVerified: true },
            headers: { Authorization: 'SECRET' },
          },
        ]),
      ],
    }),
    now,
  );
  assert.equal(p.mode, 'repair');
  assert.equal(p.percent, 70);
  assert.equal(p.stage, 'Create or verify the wave');
  assert.ok(!JSON.stringify(p).includes('SECRET'));
});
test('only safe progress fields reach the website through sync', () => {
  const row = {
    runId: '100',
    executionId: '201',
    status: 'generating',
    summaryJson: '{}',
    updatedAt: now,
  };
  const context = prepareControl(
    row,
    { action: 'sync', actor: 'Operator' },
    now,
  );
  const result = inspectExecution(
    context,
    {
      statusCode: 200,
      body: execution({
        'Get appointments': [
          task([{ password: 'SECRET', body: { private: 'SECRET' } }]),
        ],
        'Ensure BY Login': [task([{ cookie: 'SECRET' }])],
      }),
    },
    'w1',
  );
  assert.equal(result.controlRoute, 0);
  assert.equal(result.response.progress.percent, 60);
  assert.ok(!JSON.stringify(result.response).includes('SECRET'));
  assert.equal(
    inspectExecution(
      context,
      { statusCode: 200, body: { ...execution({}), workflowId: 'other' } },
      'w1',
    ).httpStatus,
    409,
  );
});
