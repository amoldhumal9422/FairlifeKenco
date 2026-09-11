export function canStopRun(status: string) {
  return ['generating', 'running', 'repairing'].includes(status);
}
export function canDiscardRun(status: string) {
  return ['pending', 'rejected', 'failed', 'stopped'].includes(status);
}
