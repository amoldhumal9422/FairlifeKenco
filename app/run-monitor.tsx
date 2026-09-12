import { useEffect, useState, type CSSProperties } from 'react';
import { Check, Clock3, ExternalLink, Activity } from 'lucide-react';
import { displayProgress, type ProgressSnapshot } from '@/lib/run-progress';
import type { Run } from './wave-desk';

function age(value: string | undefined, now: number) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not reported yet';
  const s = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.floor(s / 60)}m ago`
      : `${Math.floor(s / 3600)}h ago`;
}
const stamp = (value: string) =>
  value
    ? new Date(value).toLocaleString('en-US', {
        timeZone: 'America/Phoenix',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
export default function RunMonitor({
  run,
  snapshot,
}: {
  run: Run;
  snapshot?: ProgressSnapshot;
}) {
  const [now, setNow] = useState(Date.now);
  const p = displayProgress(run, snapshot);
  useEffect(() => {
    if (!p.active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [p.active]);
  const phases =
    p.mode === 'preparation'
      ? ['Read sources', 'Build workbook', 'Review file']
      : p.mode === 'repair'
        ? ['Check protection', 'Appointment', 'Wave & verify']
        : ['Verify session', 'Process rows', 'Save results'];
  const index =
    p.percent === null
      ? -1
      : p.mode === 'preparation'
        ? p.percent < 80
          ? 0
          : p.percent < 100
            ? 1
            : 2
        : p.mode === 'repair'
          ? p.percent < 50
            ? 0
            : p.percent < 70
              ? 1
              : 2
          : p.percent < 20
            ? 0
            : p.percent < 95
              ? 1
              : 2;
  const stale =
    p.active && !!p.checkedAt && now - Date.parse(p.checkedAt) > 60000;
  const quiet =
    p.active && !!p.lastEventAt && now - Date.parse(p.lastEventAt) > 120000;
  const id = p.executionId || run.executionId;
  return (
    <section
      className={
        'run-monitor' +
        (p.active ? ' is-active' : '') +
        (stale ? ' is-stale' : '')
      }
      aria-label="Run progress"
    >
      <div className="monitor-title">
        <span>
          <Activity />{' '}
          {p.mode === 'preparation'
            ? 'File preparation'
            : p.mode === 'repair'
              ? 'Appointment repair'
              : 'Production run'}
        </span>
        <span className="monitor-run">RUN {run.runId}</span>
      </div>
      <div className="monitor-heading">
        <div>
          <h3>{p.stage}</h3>
          <p>
            {p.processed != null && p.total != null
              ? `${p.processed} of ${p.total} rows recorded${p.failed ? ` · ${p.failed} with issues` : ''}`
              : p.mode === 'preparation'
                ? 'Preparation finishes before approval.'
                : p.mode === 'repair'
                  ? 'Existing appointment first, then the intended wave.'
                  : 'Progress follows the recorded workflow steps.'}
          </p>
        </div>
        <strong className="monitor-percent">
          {p.percent === null ? '—' : p.percent}
          <small>{p.percent === null ? '' : '%'}</small>
        </strong>
      </div>
      <progress
        className="sr-only"
        max={100}
        value={p.percent ?? undefined}
        aria-label={p.mode + ' progress'}
        aria-valuetext={
          p.percent === null
            ? 'Waiting for saved progress'
            : `${p.percent}% · ${p.stage}`
        }
      />
      <div className="monitor-track" aria-hidden="true">
        <span
          style={{ '--run-progress': `${p.percent ?? 0}%` } as CSSProperties}
        />
      </div>
      <ol className="monitor-phases">
        {phases.map((phase, i) => (
          <li
            key={phase}
            className={i === index ? 'current' : i < index ? 'done' : ''}
          >
            {i < index ? <Check /> : <span>{i + 1}</span>}
            {phase}
          </li>
        ))}
      </ol>
      <div className="monitor-status">
        <span>
          <Clock3 /> Last checked: {age(p.checkedAt, now)}
        </span>
        <span>Stage progress · not a time estimate</span>
      </div>
      {(stale || quiet) && (
        <p className="monitor-warning">
          {stale
            ? 'Progress updates are delayed. Refresh to check the run; the workflow may still be running.'
            : 'No new step has been recorded for ' +
              age(p.lastEventAt, now).replace(' ago', '') +
              '. The workflow may be waiting on a service. You can check its details or stop this run.'}
        </p>
      )}
      <details className="run-details">
        <summary>Run details & recent steps</summary>
        <dl>
          <div>
            <dt>Execution</dt>
            <dd>
              {id || 'Not recorded'}{' '}
              {/^\d+$/.test(id || '') && (
                <a
                  href={`https://amoldhumal.app.n8n.cloud/workflow/lgmlHuddIQ8SUkCo/executions/${id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open n8n <ExternalLink />
                </a>
              )}
            </dd>
          </div>
          <div>
            <dt>Requested by</dt>
            <dd>{run.requestedBy || 'Manual run'}</dd>
          </div>
          <div>
            <dt>Started · Phoenix</dt>
            <dd>{stamp(run.startedAt || run.createdAt)}</dd>
          </div>
          <div>
            <dt>Finished · Phoenix</dt>
            <dd>{stamp(run.finishedAt)}</dd>
          </div>
          <div>
            <dt>Last completed step</dt>
            <dd>{p.lastCompletedStep || 'Not reported yet'}</dd>
          </div>
          <div>
            <dt>Last step recorded</dt>
            <dd>{p.lastEventAt ? stamp(p.lastEventAt) : 'Not reported yet'}</dd>
          </div>
        </dl>
        {!!p.timeline?.length && (
          <ol className="monitor-timeline">
            {p.timeline.map((event, i) => (
              <li key={i}>
                <Check />
                <span>{event.step}</span>
                <time>{stamp(event.at)}</time>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}
