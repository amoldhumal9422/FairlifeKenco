import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareControl, inspectExecution } from '../workflow/run-control.js';

const run = {
  runId: '100',
  executionId: '101',
  status: 'generating',
  updatedAt: 'v1',
  summaryJson: '{}',
};
const request = {
  action: 'stop',
  runId: '100',
  confirm: true,
  actor: 'Operator',
};
const execution = (status) => ({
  statusCode: 200,
  body: {
    id: '101',
    workflowId: 'workflow',
    status,
    stoppedAt: '2026-09-11T20:00:00Z',
  },
});
test('stop requires confirmation and uses only the saved execution', () => {
  assert.equal(
    prepareControl(run, { ...request, confirm: false }).httpStatus,
    400,
  );
  assert.equal(
    prepareControl(run, { ...request, executionId: '999' }).targetExecutionId,
    '101',
  );
  assert.equal(prepareControl(run, request).controlRoute, 1);
});
test('discard prevents approval races and never removes running or completed work', () => {
  const q = {
    action: 'discard',
    confirm: true,
    expectedUpdatedAt: 'v1',
    actor: 'Operator',
  };
  assert.equal(
    prepareControl({ ...run, status: 'pending' }, q).status,
    'discarded',
  );
  assert.equal(
    prepareControl({ ...run, status: 'rejected' }, q).controlRoute,
    2,
  );
  assert.equal(
    prepareControl(
      { ...run, status: 'pending' },
      { ...q, expectedUpdatedAt: 'old' },
    ).httpStatus,
    409,
  );
  for (const status of [
    'running',
    'repairing',
    'completed',
    'completed_with_issues',
    'repair_attention',
  ])
    assert.equal(prepareControl({ ...run, status }, q).httpStatus, 409);
});
test('sync reconciles a failed manual preparation without stopping any execution', () => {
  const context = prepareControl(run, { ...request, action: 'sync' });
  const failed = inspectExecution(context, execution('error'), 'workflow');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.controlRoute, 2);
  assert.equal(
    inspectExecution(context, execution('running'), 'workflow').controlRoute,
    0,
  );
});
test('stop requires matching workflow and execution; API failures cannot fake success', () => {
  const context = prepareControl(run, request);
  assert.equal(
    inspectExecution(context, execution('running'), 'other').httpStatus,
    409,
  );
  assert.equal(
    inspectExecution(context, { statusCode: 403, body: {} }, 'workflow')
      .httpStatus,
    503,
  );
  assert.equal(
    inspectExecution(context, { statusCode: 404, body: {} }, 'workflow')
      .httpStatus,
    503,
  );
  assert.equal(
    inspectExecution(
      context,
      { statusCode: 200, body: { ...execution('running').body, id: '999' } },
      'workflow',
    ).httpStatus,
    409,
  );
  assert.equal(
    inspectExecution(context, execution('running'), 'workflow').controlRoute,
    1,
  );
});
test('stop is recorded only after confirmation from n8n', () => {
  const context = prepareControl(run, request);
  assert.equal(
    inspectExecution(context, execution('running'), 'workflow', true)
      .httpStatus,
    503,
  );
  const stopped = inspectExecution(
    context,
    execution('canceled'),
    'workflow',
    true,
  );
  assert.equal(stopped.status, 'stopped');
  assert.equal(JSON.parse(stopped.summaryJson).runControl.actor, 'Operator');
});
test('repair cancellation retains results and requires manual review', () => {
  const r = {
    ...run,
    status: 'repairing',
    summaryJson: JSON.stringify({
      wavesCreated: 43,
      repairActive: { repairExecutionId: '202', load: 'L1' },
    }),
  };
  const context = prepareControl(r, request);
  assert.equal(context.targetExecutionId, '202');
  const result = inspectExecution(
    context,
    {
      statusCode: 200,
      body: { id: '202', workflowId: 'workflow', status: 'canceled' },
    },
    'workflow',
  );
  assert.equal(result.status, 'repair_attention');
  assert.equal(JSON.parse(result.summaryJson).wavesCreated, 43);
  assert.equal(JSON.parse(result.summaryJson).repairActive.load, 'L1');
});
