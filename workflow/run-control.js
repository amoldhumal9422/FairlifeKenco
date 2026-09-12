import { executionProgress } from './execution-progress.js';
const activeRunStates = ['generating', 'running', 'repairing'];
const activeExecutionStates = ['new', 'running', 'waiting', 'unknown'];
function controlReply(httpStatus, response) {
  return { controlRoute: 0, httpStatus, response };
}
function controlError(status, error) {
  return controlReply(status, { error });
}
function readSummary(row) {
  try {
    return JSON.parse(row.summaryJson || '{}');
  } catch {
    return {};
  }
}
export function prepareControl(row, request, now = new Date().toISOString()) {
  if (!row.runId) return controlError(404, 'Run not found.');
  if (!['stop', 'sync', 'discard'].includes(request.action))
    return controlError(400, 'Unknown run control.');
  const context = {
    ...row,
    action: request.action,
    actor: request.actor,
    expectedStatus: row.status,
    expectedUpdatedAt: row.updatedAt,
    checkedAt: now,
  };
  if (request.action !== 'sync' && request.confirm !== true)
    return controlError(400, 'Confirm this action before continuing.');
  if (request.action === 'discard') {
    if (!['pending', 'rejected', 'failed', 'stopped'].includes(row.status))
      return controlError(
        409,
        'Only unused or stopped files can be removed from the queue.',
      );
    if (request.expectedUpdatedAt !== row.updatedAt)
      return controlError(
        409,
        'This run has changed. Refresh before removing it.',
      );
    const summary = readSummary(row);
    summary.queueRemoval = {
      actor: request.actor,
      at: now,
      previousStatus: row.status,
    };
    return {
      ...context,
      controlRoute: 2,
      status: 'discarded',
      summaryJson: JSON.stringify(summary),
      finishedAt: row.finishedAt || now,
    };
  }
  if (!activeRunStates.includes(row.status))
    return controlReply(200, {
      runId: row.runId,
      status: row.status,
      message: 'This run is already finished.',
    });
  const summary = readSummary(row);
  const targetExecutionId = String(
    row.status === 'repairing'
      ? summary.repairActive?.repairExecutionId || ''
      : row.executionId || '',
  );
  if (!/^\d+$/.test(targetExecutionId))
    return controlError(
      409,
      'No execution is recorded for this run. Check it in n8n.',
    );
  return { ...context, controlRoute: 1, targetExecutionId };
}
export function inspectExecution(
  context,
  response,
  workflowId,
  afterStop = false,
) {
  if (response.statusCode !== 200 || !response.body || response.error)
    return controlError(
      503,
      'Could not verify the execution in n8n. Refresh before retrying; no stop has been confirmed.',
    );
  const execution = response.body;
  if (
    String(execution.id) !== context.targetExecutionId ||
    execution.workflowId !== workflowId
  )
    return controlError(409, 'Execution does not match this workflow and run.');
  if (activeExecutionStates.includes(execution.status)) {
    if (afterStop)
      return controlError(
        503,
        'n8n has not confirmed that the run stopped. Refresh its status before retrying.',
      );
    if (context.action === 'stop') return { ...context, controlRoute: 1 };
    return controlReply(200, {
      runId: context.runId,
      status: context.status,
      progress: executionProgress(context, execution, context.checkedAt),
    });
  }
  if (
    !['success', 'error', 'crashed', 'canceled', 'cancelled'].includes(
      execution.status,
    )
  )
    return controlError(
      503,
      'n8n returned an unrecognized execution status. Check the execution before continuing.',
    );
  const stopped = ['canceled', 'cancelled'].includes(execution.status);
  const summary = readSummary(context);
  const repairing = context.expectedStatus === 'repairing';
  const message = repairing
    ? 'Appointment repair ended. Check the recorded actions and Blue Yonder manually before releasing the repair lock.'
    : stopped
      ? 'Run stopped. Any warehouse changes already completed are retained; check the execution before starting again.'
      : execution.status === 'success'
        ? 'The execution ended before its final results were saved. Check the execution before starting again.'
        : 'The execution failed in n8n. Open its execution details to inspect the failed step.';
  summary.error = message;
  summary.runControl = {
    action: context.action,
    actor: context.actor,
    at: context.checkedAt,
    executionId: context.targetExecutionId,
    executionStatus: execution.status,
    progress: executionProgress(context, execution, context.checkedAt),
  };
  if (repairing && summary.repairActive)
    summary.repairActive = {
      ...summary.repairActive,
      interrupted: true,
      executionStatus: execution.status,
    };
  return {
    ...context,
    controlRoute: 2,
    status: repairing ? 'repair_attention' : stopped ? 'stopped' : 'failed',
    summaryJson: JSON.stringify(summary),
    finishedAt: execution.stoppedAt || context.checkedAt,
  };
}
