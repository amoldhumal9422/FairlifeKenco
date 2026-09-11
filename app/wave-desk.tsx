'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  FileSpreadsheet,
  ArrowRight,
  Layers,
  ShieldCheck,
  Activity,
  Play,
  RefreshCw,
  Download,
  Check,
  X,
  Upload,
  AlertTriangle,
  Clock3,
  ChevronRight,
  LoaderCircle,
  LayoutDashboard,
  History,
  MapPin,
  Truck,
  Square,
  Trash2,
} from 'lucide-react';
import { canStopRun, canDiscardRun } from '@/lib/run-controls';
import WaveAnalytics from './wave-analytics';
import {
  appointmentConflicts,
  repairUnavailable,
} from '@/lib/appointment-conflicts';

type Row = Record<string, string | number | boolean>;
type Summary = {
  processed?: number;
  completed?: number;
  failed?: number;
  skipped?: number;
  wavesCreated?: number;
  inboundAppointments?: number;
  results?: Row[];
  skippedRows?: Row[];
  error?: string;
  appointmentRepairs?: Row[];
  repairActive?: Row | null;
};
export type Run = {
  runId: string;
  status: string;
  planDate: string;
  fileName: string;
  replacementFileName: string;
  sheetName: string;
  source: string;
  requestedBy: string;
  decisionBy: string;
  decisionAt: string;
  rejectedBy: string;
  rejectedAt: string;
  rejectReason: string;
  executionId: string;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
  updatedAt: string;
  preview?: Row[];
  metadata: Record<string, unknown>;
  summary: Summary;
  fileBase64?: string;
  downloadName?: string;
};
export type ApiResponse = {
  error?: string;
  runs: Run[];
  run: Run;
  runId?: string;
  status?: string;
  message?: string;
};
export type ApiClient = (body: Record<string, unknown>) => Promise<ApiResponse>;
const statuses: Record<string, string> = {
  generating: 'Preparing file',
  pending: 'Awaiting review',
  rejected: 'Replacement needed',
  running: 'Running in Blue Yonder',
  completed: 'Completed',
  completed_with_issues: 'Completed with issues',
  failed: 'Failed',
  stopped: 'Stopped',
  discarded: 'Removed from queue',
  repairing: 'Repairing appointment',
  repair_attention: 'Repair needs review',
};
const previewColumns = [
  'Date',
  'Appt Time',
  'IB-OB',
  'BY Order Number',
  'BY Load/Delivery Number',
  'Carrier Name',
  'SCAC',
  'Destination',
  'Load Type',
  'Wave Name',
  'Notes',
];
const number = (v: unknown) => (typeof v === 'number' ? v : 0);
const date = (v: string) =>
  v
    ? new Date(v.length === 10 ? v + 'T12:00:00-07:00' : v).toLocaleDateString(
        'en-US',
        {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'America/Phoenix',
        },
      )
    : '—';
const time = (v: string) =>
  v
    ? new Date(v).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Phoenix',
      })
    : '—';
function cell(v: string | number | boolean | null | undefined, key: string) {
  if (key === 'Date' && typeof v === 'number')
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
      .toISOString()
      .slice(0, 10);
  if (key === 'Appt Time' && typeof v === 'number') {
    const t = Math.round(v * 1440);
    return (
      String(Math.floor(t / 60)).padStart(2, '0') +
      ':' +
      String(t % 60).padStart(2, '0')
    );
  }
  return v === undefined || v === null || v === '' ? '—' : String(v);
}
async function defaultApi(body: Record<string, unknown>) {
  const response = await fetch('/api/desk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiResponse;
  if (!response.ok)
    throw new Error(payload.error || 'Request could not be completed.');
  return payload;
}
function State({ status }: { status: string }) {
  return (
    <span className={'state state-' + status}>
      {['generating', 'running', 'repairing'].includes(status) && (
        <span className="pulse-dot" />
      )}
      {statuses[status] || status}
    </span>
  );
}
function downloadBytes(base64: string, name: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csv(rows: Row[], filename: string) {
  if (!rows.length) return;
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const quote = (v: string | number | boolean | null | undefined) => {
    let s = String(v ?? '');
    if (/^[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const content = [
    keys.map(quote).join(','),
    ...rows.map((r) => keys.map((k) => quote(r[k])).join(',')),
  ].join('\r\n');
  const url = URL.createObjectURL(
    new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Step({ value, error }: { value: unknown; error?: unknown }) {
  const n = Number(value);
  if (!n) return <span className="muted">—</span>;
  const ok = n >= 200 && n < 300 && !error;
  return (
    <span className={ok ? 'step-ok' : 'step-fail'}>
      {ok ? <Check /> : <X />}
      {ok ? 'Done' : error ? 'Failed' : `HTTP ${n}`}
    </span>
  );
}

export default function WaveBot({
  viewer,
  request = defaultApi,
  signInUrl = '',
  connectionMessage = '',
  readOnly = true,
  allowPreparation = false,
  onDisconnect,
}: {
  viewer: string;
  request?: ApiClient;
  signInUrl?: string;
  connectionMessage?: string;
  readOnly?: boolean;
  allowPreparation?: boolean;
  onDisconnect?: () => void;
}) {
  const api = request;
  const [runs, setRuns] = useState<Run[]>([]),
    [selected, setSelected] = useState<Run | null>(null),
    [loading, setLoading] = useState(Boolean(viewer)),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [query, setQuery] = useState('');
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null),
    [reason, setReason] = useState(''),
    [replacement, setReplacement] = useState<File | null>(null),
    [sheetName, setSheetName] = useState('');
  const [repair, setRepair] = useState<{
    runId: string;
    row: Row;
    rowIndex: number;
    updatedAt: string;
    repairId: string;
  } | null>(null);
  const actionInFlight = useRef(false);
  const refreshInFlight = useRef(false);
  const [control, setControl] = useState<{
    action: 'stop' | 'discard';
    run: Run;
  } | null>(null);
  const selectedId = useRef(''),
    requestVersion = useRef(0),
    fileInput = useRef<HTMLInputElement>(null);
  const detail = useCallback(
    async (id: string) => {
      const version = ++requestVersion.current;
      const { run } = await api({ action: 'detail', runId: id });
      if (version === requestVersion.current) {
        selectedId.current = id;
        setSelected(run);
        setSheetName(run.sheetName);
        setReplacement(null);
        if (fileInput.current) fileInput.current.value = '';
      }
    },
    [api],
  );
  const refresh = useCallback(async () => {
    if (!viewer || refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      let result = await api({ action: 'list' });
      let statusError = '';
      const activeRuns = result.runs.filter((r) => canStopRun(r.status));
      if (activeRuns.length) {
        const checks = await Promise.allSettled(
          activeRuns.map((r) => api({ action: 'sync', runId: r.runId })),
        );
        const unavailable = checks.find((r) => r.status === 'rejected');
        if (unavailable?.status === 'rejected')
          statusError =
            unavailable.reason instanceof Error
              ? unavailable.reason.message
              : 'Execution status could not be verified.';
        result = await api({ action: 'list' });
      }
      const latest = result.runs || [];
      setRuns(latest);
      const current = latest.find((r: Run) => r.runId === selectedId.current);
      if (current) {
        const version = requestVersion.current;
        const { run } = await api({ action: 'detail', runId: current.runId });
        if (
          selectedId.current === run.runId &&
          version === requestVersion.current
        )
          setSelected(run);
      } else if (!selectedId.current && latest.length) {
        await detail(
          (latest.find((r) => r.status === 'pending') || latest[0]).runId,
        );
      }
      setError(statusError);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      refreshInFlight.current = false;
      setLoading(false);
    }
  }, [viewer, api, detail]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);
  const active = runs.some((r) =>
    ['generating', 'running', 'repairing'].includes(r.status),
  );
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (document.visibilityState === 'visible' && !busy) void refresh();
      },
      active ? 15000 : 300000,
    );
    const focus = () => {
      if (document.visibilityState === 'visible' && !busy) void refresh();
    };
    document.addEventListener('visibilitychange', focus);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [active, busy, refresh]);
  async function perform(action: string, extras: Record<string, unknown> = {}) {
    if (
      busy ||
      actionInFlight.current ||
      !viewer ||
      (readOnly && !(action === 'generate' && allowPreparation))
    )
      return;
    actionInFlight.current = true;
    setBusy(action);
    setError('');
    setNotice('');
    try {
      const result = await api({ action, runId: selected?.runId, ...extras });
      setDecision(null);
      setRepair(null);
      setControl(null);
      setReason('');
      setNotice(
        result.message ||
          (action === 'stop'
            ? 'Run status checked. Review the final status below.'
            : action === 'discard'
              ? 'File removed from the review queue. Its history is retained.'
              : action === 'generate'
                ? 'Preparing the wave file. It will wait here for approval.'
                : action === 'reject'
                  ? 'File rejected. Choose a replacement workbook below.'
                  : action === 'repair'
                    ? 'Appointment repair accepted. Its checks and recorded actions will appear below.'
                    : 'Run accepted. Blue Yonder processing has started.'),
      );
      await refresh();
      if (result.runId) await detail(result.runId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionInFlight.current = false;
      setBusy('');
    }
  }
  async function download(run: Run, original = false) {
    setBusy('download');
    try {
      const result = await api({
        action: 'detail',
        runId: run.runId,
        download: true,
        original,
      });
      if (!result.run.fileBase64)
        throw new Error('The file is not available yet.');
      downloadBytes(
        result.run.fileBase64,
        result.run.downloadName || run.fileName,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function upload() {
    if (readOnly || !viewer || !replacement || !selected) return;
    if (
      replacement.size > 2 * 1024 * 1024 ||
      !replacement.name.toLowerCase().endsWith('.xlsx')
    ) {
      setError('Choose an .xlsx workbook under 2 MB.');
      return;
    }
    setBusy('reading');
    setError('');
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string')
            resolve(reader.result.split(',')[1]);
          else reject(new Error('The selected file could not be read.'));
        };
        reader.onerror = reject;
        reader.readAsDataURL(replacement);
      });
      setBusy('');
      await perform('upload', {
        fileName: replacement.name,
        fileBase64: b64,
        sheetName,
      });
    } catch {
      setError('The selected file could not be read.');
      setBusy('');
    }
  }
  const queue = runs.filter((r) =>
    [
      'pending',
      'rejected',
      'generating',
      'running',
      'repairing',
      'repair_attention',
    ].includes(r.status),
  );
  const pending = runs.filter((r) => r.status === 'pending').length;
  const waves = runs.reduce((s, r) => s + number(r.summary.wavesCreated), 0),
    inbound = runs.reduce(
      (s, r) => s + number(r.summary.inboundAppointments),
      0,
    ),
    attention = runs.reduce(
      (s, r) => s + number(r.summary.failed) + number(r.summary.skipped),
      0,
    );
  const visibleRows = (selected?.preview || []).filter(
    (r) =>
      !query ||
      Object.values(r).some((v) =>
        String(v).toLowerCase().includes(query.toLowerCase()),
      ),
  );
  const resultRows = selected?.summary.results || [];
  const conflictRows = appointmentConflicts(resultRows);
  const reviewedCount = number(selected?.metadata.readyRows),
    totalCount = number(selected?.metadata.rowCount);
  const reviewRows = Array.isArray(selected?.metadata.reviewRows)
    ? selected.metadata.reviewRows
    : [];
  const generation = (selected?.metadata.summary || {}) as Record<
    string,
    unknown
  >;
  const missingScacs = Array.isArray(generation.scacUnmapped)
    ? generation.scacUnmapped
    : [];
  const inboundChecks = Array.isArray(generation.itrnToCheck)
    ? generation.itrnToCheck
    : [];
  return (
    <main className="desk">
      <a href="#overview" className="skip-link">
        Skip to dashboard
      </a>
      <aside className="sidebar">
        <a className="brand" href="#overview">
          <span className="brand-mark">
            <Layers />
          </span>
          <span>
            Wave Bot<span className="brand-sub">fairlife · Arizona</span>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Workspace">
          <a href="#overview" className="nav-item nav-current">
            <LayoutDashboard /> Overview
          </a>
          <a href="#review" className="nav-item">
            <FileSpreadsheet /> File review
            {pending > 0 && <span className="nav-count">{pending}</span>}
          </a>
          <a href="#history" className="nav-item">
            <History /> Run history
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="warehouse-info">
            <MapPin />
            <div>
              <strong>Arizona · AZ02</strong>
              <span>America / Phoenix</span>
            </div>
          </div>
          <div className="viewer">
            <span className="avatar">
              {viewer ? viewer.slice(0, 2).toUpperCase() : <ShieldCheck />}
            </span>
            <div>
              <strong>{viewer || 'Guest'}</strong>
              <span>{viewer ? 'Workspace access' : 'Sign in to review'}</span>
            </div>
          </div>
        </div>
      </aside>
      <section className="workspace" id="overview">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight />
            <span>Overview</span>
          </div>
          <div className="topbar-meta">
            <span className="facility-chip">
              <MapPin /> Arizona · AZ02
            </span>
            <span className="environment-label">
              {readOnly
                ? allowPreparation
                  ? 'File preparation'
                  : 'View only'
                : 'Production'}
            </span>
            {viewer && onDisconnect && (
              <Button variant="ghost" onClick={onDisconnect}>
                Disconnect
              </Button>
            )}
          </div>
        </header>
        <div className="page-heading">
          <div>
            <h1>
              Wave overview<span className="heading-period">.</span>
            </h1>
            <p className="muted">
              Prepare wave files, approve or replace them, and track Blue Yonder
              results.
            </p>
          </div>
          <div className="heading-actions">
            <Button
              variant="outline"
              className="refresh"
              onClick={() => void refresh()}
              disabled={!!busy || !viewer}
              aria-label="Refresh runs"
            >
              <RefreshCw className={loading ? 'spin' : ''} />
            </Button>
            {active && (
              <Button
                variant="destructive"
                aria-label="Stop active workflow"
                disabled={readOnly || !!busy || !viewer}
                onClick={() => {
                  const run =
                    selected && canStopRun(selected.status)
                      ? selected
                      : runs.find((r) => canStopRun(r.status));
                  if (run) setControl({ action: 'stop', run });
                }}
              >
                <Square /> Stop workflow
              </Button>
            )}
            <Button
              className="primary-action"
              onClick={() => void perform('generate')}
              disabled={
                (readOnly && !allowPreparation) ||
                !!busy ||
                !viewer ||
                runs.some((r) => r.status === 'generating')
              }
            >
              {busy === 'generate' ? (
                <LoaderCircle className="spin" />
              ) : (
                <Play />
              )}{' '}
              Prepare file
            </Button>
          </div>
        </div>
        {readOnly && viewer && (
          <output className="notice setup">
            <ShieldCheck />
            <span>
              {allowPreparation
                ? 'Prepare a workbook, review its data, and download the Excel file. Approval and Blue Yonder processing are paused.'
                : 'View-only mode. You can inspect and download files. Preparing files, approving runs, and uploading replacements are paused on this website.'}
            </span>
          </output>
        )}
        {!viewer && (
          <div className={'notice ' + (connectionMessage ? 'setup' : '')}>
            <ShieldCheck />
            <span>
              {connectionMessage || 'Sign in to view files and approve runs.'}
            </span>
            {signInUrl && (
              <a href={signInUrl} target="_top">
                Sign in
              </a>
            )}
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            <AlertTriangle />
            <span>{error}</span>
            <Button
              variant="ghost"
              onClick={() => setError('')}
              aria-label="Dismiss error"
            >
              <X />
            </Button>
          </div>
        )}
        {notice && (
          <output className="notice">
            <Check />
            <span>{notice}</span>
            <Button
              variant="ghost"
              onClick={() => setNotice('')}
              aria-label="Dismiss message"
            >
              <X />
            </Button>
          </output>
        )}
        <div className="metrics" aria-label="Totals across the latest 100 runs">
          {[
            {
              label: 'Awaiting review',
              value: pending,
              caption: 'Files ready for a decision',
              Icon: FileSpreadsheet,
            },
            {
              label: 'Waves created',
              value: waves,
              caption: 'Across the latest 100 runs',
              Icon: Layers,
            },
            {
              label: 'Inbound appointments',
              value: inbound,
              caption: 'Created in Blue Yonder',
              Icon: Truck,
            },
            {
              label: 'Rows needing attention',
              value: attention,
              caption: 'Failed or skipped rows',
              Icon: AlertTriangle,
            },
          ].map(({ label, value, caption, Icon }) => (
            <div className="metric" key={label}>
              <div className="metric-head">
                <span>{label}</span>
                <Icon />
              </div>
              <div className="metric-value">
                <strong>
                  {loading || !viewer ? '—' : value.toLocaleString()}
                </strong>
              </div>
              <div className="metric-foot">
                <i className="metric-dot" />
                {caption}
              </div>
            </div>
          ))}
        </div>
        <WaveAnalytics
          rows={selected?.preview || []}
          planDate={selected?.planDate || ''}
          loading={loading}
        />
        <div className="section-title">
          <FileSpreadsheet />
          <h2>File review</h2>
          <span>{pending} awaiting approval</span>
        </div>
        <div className="review-layout" id="review">
          <section className="panel queue-panel">
            <div className="panel-heading">
              <h2>
                <FileSpreadsheet /> Review queue
              </h2>
              <span className="count">{queue.length}</span>
            </div>
            {loading ? (
              <div className="queue-empty">
                <LoaderCircle className="spin" /> Loading files…
              </div>
            ) : !queue.length ? (
              <div className="queue-empty">
                <ShieldCheck />
                <h3>No files waiting</h3>
                <p>
                  Prepare a wave file to pull the latest SharePoint and OpenDock
                  data for tomorrow.
                </p>
              </div>
            ) : (
              queue.map((run) => (
                <button
                  className={
                    'queue-item ' +
                    (selected?.runId === run.runId ? 'selected' : '')
                  }
                  key={run.runId}
                  onClick={() => {
                    setQuery('');
                    void detail(run.runId).catch((e) => setError(e.message));
                  }}
                >
                  <div className="queue-item-top">
                    <span className="file-icon">
                      <FileSpreadsheet />
                    </span>
                    <ChevronRight />
                  </div>
                  <strong>
                    {run.planDate ? date(run.planDate) : 'Preparing next wave'}
                  </strong>
                  <span className="file-label">
                    {run.replacementFileName ||
                      run.fileName ||
                      'Gathering appointments and orders'}
                  </span>
                  <div className="queue-meta">
                    <State status={run.status} />
                    {number(run.metadata.rowCount) > 0 && (
                      <span>{number(run.metadata.rowCount)} rows</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </section>
          <section className="panel detail-panel">
            {!selected ? (
              <div className="empty-state">
                <FileSpreadsheet />
                <h3>Select a workbook</h3>
                <p>
                  Review its appointments, download the Excel file, or open its
                  results.
                </p>
              </div>
            ) : (
              <>
                <div className="detail-heading">
                  <div>
                    <p className="eyebrow">
                      {selected.source === 'replacement'
                        ? 'REPLACEMENT WORKBOOK'
                        : 'WAVE WORKBOOK'}{' '}
                      · RUN {selected.runId}
                    </p>
                    <h2>
                      {selected.planDate
                        ? date(selected.planDate)
                        : date(selected.createdAt)}
                    </h2>
                    <p className="muted">
                      {selected.replacementFileName ||
                        selected.fileName ||
                        (canStopRun(selected.status)
                          ? 'Preparing your workbook…'
                          : 'No workbook created')}
                    </p>
                  </div>
                  <State status={selected.status} />
                </div>
                {(canStopRun(selected.status) ||
                  canDiscardRun(selected.status)) && (
                  <div className="run-control-bar">
                    <span className="muted">
                      {canStopRun(selected.status)
                        ? 'You can stop this run at any time.'
                        : 'Finished with this file? Remove it from the queue.'}
                    </span>
                    <Button
                      variant={
                        canStopRun(selected.status) ? 'destructive' : 'outline'
                      }
                      disabled={readOnly || !!busy}
                      onClick={() =>
                        setControl({
                          action: canStopRun(selected.status)
                            ? 'stop'
                            : 'discard',
                          run: selected,
                        })
                      }
                    >
                      {canStopRun(selected.status) ? <Square /> : <Trash2 />}
                      {canStopRun(selected.status)
                        ? 'Stop workflow'
                        : 'Remove from queue'}
                    </Button>
                  </div>
                )}
                <div className="file-facts">
                  <span>
                    <strong>
                      {totalCount || selected.preview?.length || '—'}
                    </strong>{' '}
                    file rows
                  </span>
                  <span>
                    <strong>{reviewedCount || '—'}</strong> active rows
                  </span>
                  <span>
                    Worksheet <strong>{selected.sheetName || '—'}</strong>
                  </span>
                  <span>Phoenix time</span>
                </div>
                {selected.status === 'generating' && (
                  <div className="run-notice">
                    <LoaderCircle className="spin" />
                    <div>
                      <strong>Gathering appointments and orders</strong>
                      <p>
                        The workbook will appear here when preparation finishes.
                        No warehouse changes have started.
                      </p>
                    </div>
                  </div>
                )}
                {selected.status === 'running' && (
                  <div className="run-notice">
                    <Activity />
                    <div>
                      <strong>Processing accepted workbook</strong>
                      <p>
                        Results update here after the run finishes. Approved by{' '}
                        {selected.decisionBy || selected.requestedBy} at{' '}
                        {time(selected.decisionAt || selected.startedAt)}.
                      </p>
                    </div>
                  </div>
                )}
                {selected.summary.error && (
                  <div className="inline-error">
                    <AlertTriangle />
                    {selected.summary.error}
                  </div>
                )}
                {reviewRows.length > 0 && (
                  <div className="inline-warning">
                    <AlertTriangle />
                    <span>
                      {reviewRows.length} row(s) have missing fields. Review the
                      workbook notes before approving.
                    </span>
                  </div>
                )}
                {missingScacs.length > 0 && (
                  <div className="inline-warning">
                    <AlertTriangle />
                    <span>
                      Carrier codes need review: {missingScacs.join(', ')}.
                    </span>
                  </div>
                )}
                {inboundChecks.length > 0 && (
                  <div className="inline-warning">
                    <AlertTriangle />
                    <span>
                      Inbound trucks to verify: {inboundChecks.join(', ')}.
                    </span>
                  </div>
                )}
                {['pending', 'rejected'].includes(selected.status) && (
                  <div className="review-action-bar">
                    <div>
                      <ShieldCheck />
                      <span>
                        {selected.status === 'pending'
                          ? 'Review the date, carriers, and wave names before continuing.'
                          : 'The generated file was rejected.'}
                      </span>
                    </div>
                    <div className="action-buttons">
                      <Button
                        variant="outline"
                        onClick={() => void download(selected)}
                        disabled={!!busy}
                      >
                        <Download /> Download Excel
                      </Button>
                      {selected.status === 'pending' && (
                        <>
                          <Button
                            variant="outline"
                            onClick={() => setDecision('reject')}
                            disabled={readOnly || !!busy}
                          >
                            <X /> Reject
                          </Button>
                          <Button
                            onClick={() => setDecision('approve')}
                            disabled={readOnly || !!busy}
                          >
                            <Check /> Approve & run
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {selected.status === 'rejected' && (
                  <section className="replacement-panel">
                    <h3>
                      <Upload /> Upload your replacement
                    </h3>
                    <p>
                      Rejected by {selected.rejectedBy} ·{' '}
                      {time(selected.rejectedAt)}
                    </p>
                    <blockquote>{selected.rejectReason}</blockquote>
                    <p>
                      Use the same columns and appointment date (
                      {selected.planDate}). Uploading and running this file
                      accepts it for production.
                    </p>
                    <div className="upload-controls">
                      <label htmlFor="replacement-workbook">
                        Excel workbook
                        <Input
                          id="replacement-workbook"
                          ref={fileInput}
                          type="file"
                          accept=".xlsx"
                          onChange={(e) =>
                            setReplacement(e.target.files?.[0] || null)
                          }
                          disabled={readOnly || !!busy}
                        />
                      </label>
                      <label htmlFor="replacement-worksheet">
                        Worksheet name
                        <Input
                          id="replacement-worksheet"
                          value={sheetName}
                          onChange={(e) => setSheetName(e.target.value)}
                          maxLength={31}
                          disabled={readOnly || !!busy}
                        />
                      </label>
                    </div>
                    <div className="upload-footer">
                      <span className="muted">
                        .xlsx · up to 2 MB · up to 1,000 rows
                      </span>
                      <Button
                        onClick={() => void upload()}
                        disabled={
                          readOnly ||
                          !!busy ||
                          !replacement ||
                          !sheetName.trim()
                        }
                      >
                        {busy === 'upload' || busy === 'reading' ? (
                          <LoaderCircle className="spin" />
                        ) : (
                          <Upload />
                        )}{' '}
                        Upload & run replacement
                      </Button>
                    </div>
                  </section>
                )}
                <Tabs
                  defaultValue="file"
                  className="detail-tabs"
                  key={selected.runId}
                >
                  <TabsList variant="line">
                    <TabsTrigger value="file">File preview</TabsTrigger>
                    <TabsTrigger value="results">
                      Run results
                      {resultRows.length > 0 && ` · ${resultRows.length}`}
                    </TabsTrigger>
                    <TabsTrigger value="conflicts">
                      Appointments to verify
                      {conflictRows.length > 0 && ` · ${conflictRows.length}`}
                    </TabsTrigger>
                    <TabsTrigger value="activity">Decision history</TabsTrigger>
                  </TabsList>
                  <TabsContent value="file">
                    <div className="table-toolbar">
                      <Input
                        aria-label="Search workbook rows"
                        placeholder="Search order, load, carrier…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <span>{visibleRows.length} rows</span>
                      {selected.fileName && (
                        <Button
                          variant="ghost"
                          onClick={() => void download(selected)}
                          disabled={!!busy}
                          aria-label="Download workbook"
                        >
                          <Download />
                        </Button>
                      )}
                    </div>
                    <div className="scroll-table">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {previewColumns.map((k) => (
                              <TableHead key={k}>{k}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visibleRows.map((row, i) => (
                            <TableRow key={i}>
                              {previewColumns.map((k) => (
                                <TableCell key={k}>{cell(row[k], k)}</TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {!visibleRows.length && (
                      <p className="table-empty">
                        {selected.status === 'generating'
                          ? 'The workbook is being prepared.'
                          : selected.preview?.length
                            ? 'No rows match your search.'
                            : 'No stored preview is available for this file.'}
                      </p>
                    )}
                    <p className="table-footnote">
                      File checks verify structure and required fields. Carrier
                      and order checks run against Blue Yonder after acceptance.
                    </p>
                  </TabsContent>
                  <TabsContent value="conflicts">
                    <div className="table-toolbar conflict-toolbar">
                      <h3>Loads requiring an appointment check</h3>
                      <Button
                        variant="outline"
                        disabled={!conflictRows.length}
                        onClick={() =>
                          csv(
                            conflictRows,
                            `wave-run-${selected.runId}-appointment-checks.csv`,
                          )
                        }
                      >
                        <Download /> Export appointment checks
                      </Button>
                    </div>
                    <p className="table-footnote">
                      Repair one outbound load at a time. Each repair rechecks
                      Blue Yonder before making changes. Verify every repaired
                      load manually. Recorded details describe the run, not the
                      current live state.
                    </p>
                    {conflictRows.length > 0 ? (
                      <div className="scroll-table">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {[
                                'Load / order',
                                'Requested time (Arizona)',
                                'Allocation',
                                'Previous wave / appointment',
                                'Recovery outcome',
                                'Actions recorded',
                              ].map((heading) => (
                                <TableHead key={heading}>{heading}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {conflictRows.map((row, index) => (
                              <TableRow key={index} className="row-issue">
                                <TableCell>
                                  <strong>{row.load || '—'}</strong>
                                  <br />
                                  {row.order || '—'}
                                  <div className="repair-control">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={
                                        readOnly ||
                                        !!busy ||
                                        runs.some(
                                          (r) => r.status === 'repairing',
                                        ) ||
                                        !!repairUnavailable(
                                          resultRows[Number(row.rowIndex)],
                                          selected.status,
                                        )
                                      }
                                      onClick={() => {
                                        setError('');
                                        setRepair({
                                          runId: selected.runId,
                                          row: resultRows[Number(row.rowIndex)],
                                          rowIndex: Number(row.rowIndex),
                                          updatedAt: selected.updatedAt,
                                          repairId: crypto.randomUUID(),
                                        });
                                      }}
                                    >
                                      Repair appointment
                                    </Button>
                                    <p className="muted">
                                      {repairUnavailable(
                                        resultRows[Number(row.rowIndex)],
                                        selected.status,
                                      )}
                                    </p>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {time(String(row.requestedStart))}
                                  <br />
                                  to {time(String(row.requestedEnd))}
                                </TableCell>
                                <TableCell>{row.allocation}</TableCell>
                                <TableCell>
                                  Saved wave: {row.intendedWave}
                                  <br />
                                  Shipment: {row.shipment}
                                  <br />
                                  Previous: {row.previousWave}
                                  <br />
                                  {row.previousAppointment}
                                  {!!row.previousAppointmentStart && (
                                    <>
                                      <br />
                                      {time(
                                        String(row.previousAppointmentStart),
                                      )}
                                    </>
                                  )}
                                </TableCell>
                                <TableCell className="result-notes">
                                  <strong>{row.outcome}</strong>
                                  <br />
                                  {row.details}
                                </TableCell>
                                <TableCell className="result-notes">
                                  Wave created: {row.waveCreated}
                                  <br />
                                  Wave reused: {row.waveReused}
                                  <br />
                                  Wave linked: {row.waveLinked}
                                  <br />
                                  Appointment moved: {row.appointmentMoved}
                                  <br />
                                  Wave deleted: {row.waveDeleted}
                                  <br />
                                  Appointment deleted: {row.appointmentDeleted}
                                  <br />
                                  Appointment recreated:{' '}
                                  {row.appointmentRecreated}
                                  {!!row.newAppointment && (
                                    <>
                                      <br />
                                      Appointment ID: {row.newAppointment}
                                    </>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className="table-empty">
                        {selected.summary.processed !== undefined
                          ? 'No existing-appointment conflicts were recorded for this run.'
                          : 'Appointment checks will appear here after production finishes.'}
                      </p>
                    )}
                    {!!selected.summary.appointmentRepairs?.length && (
                      <details className="repair-history">
                        <summary>
                          Repair history (
                          {selected.summary.appointmentRepairs.length})
                        </summary>
                        {selected.summary.appointmentRepairs.map(
                          (attempt, index) => (
                            <div key={index} className="repair-history-item">
                              <strong>
                                {attempt.load} · {attempt.recoveryStatus}
                              </strong>
                              <p>
                                {time(String(attempt.repairStartedAt || ''))} ·{' '}
                                {attempt.repairBy}
                              </p>
                              <p>{attempt.recoveryNote}</p>
                              {!!attempt.intendedWave && (
                                <p>
                                  Saved wave: {attempt.intendedWave} · Shipment:{' '}
                                  {attempt.shipmentId}
                                  <br />
                                  Wave created:{' '}
                                  {attempt.waveCreated === true
                                    ? 'Yes'
                                    : 'Not confirmed'}{' '}
                                  · Wave linked:{' '}
                                  {attempt.waveLinked === true
                                    ? 'Yes'
                                    : 'Not confirmed'}{' '}
                                  · Appointment moved:{' '}
                                  {attempt.appointmentMoved === true
                                    ? 'Yes'
                                    : 'Not confirmed'}
                                </p>
                              )}
                            </div>
                          ),
                        )}
                      </details>
                    )}
                  </TabsContent>
                  <TabsContent value="results">
                    {selected.summary.processed !== undefined ? (
                      <>
                        <div className="result-totals">
                          {[
                            ['Processed', selected.summary.processed],
                            ['Completed', selected.summary.completed],
                            ['Failed', selected.summary.failed],
                            ['Skipped', selected.summary.skipped],
                          ].map(([label, val]) => (
                            <div key={String(label)}>
                              <strong>{val || 0}</strong>
                              <span>{label}</span>
                            </div>
                          ))}
                        </div>
                        <div className="table-toolbar">
                          <h3>Load outcomes</h3>
                          <Button
                            variant="outline"
                            disabled={!resultRows.length}
                            onClick={() =>
                              csv(
                                resultRows,
                                `wave-run-${selected.runId}-results.csv`,
                              )
                            }
                          >
                            <Download /> Export results
                          </Button>
                        </div>
                        <div className="scroll-table">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {[
                                  'Type',
                                  'Order / truck',
                                  'Load',
                                  'Wave',
                                  'Shipment',
                                  'Load',
                                  'Assignment',
                                  'Appointment',
                                  'Wave / link',
                                  'Notes',
                                ].map((k, i) => (
                                  <TableHead key={i}>{k}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {resultRows.map((r, i) => (
                                <TableRow
                                  key={i}
                                  className={r.ok ? '' : 'row-issue'}
                                >
                                  <TableCell>{r.direction}</TableCell>
                                  <TableCell>{r.ordnum}</TableCell>
                                  <TableCell>{r.carMoveId || '—'}</TableCell>
                                  <TableCell>{r.schbat || '—'}</TableCell>
                                  <TableCell>
                                    <Step value={r.stepCreateShipment} />
                                  </TableCell>
                                  <TableCell>
                                    <Step value={r.stepLoad} />
                                  </TableCell>
                                  <TableCell>
                                    <Step value={r.stepAssign} />
                                  </TableCell>
                                  <TableCell>
                                    <Step value={r.stepAppointment} />
                                  </TableCell>
                                  <TableCell>
                                    <Step
                                      value={
                                        r.direction === 'IB'
                                          ? r.stepLink
                                          : r.stepWave
                                      }
                                      error={r.waveError || r.linkError}
                                    />
                                  </TableCell>
                                  <TableCell className="result-notes">
                                    {[
                                      r.reason,
                                      r.apptWarning
                                        ? `Appointment warning: ${r.apptWarning}`
                                        : '',
                                      r.waveError,
                                      r.linkError,
                                      r.carrierNote,
                                      r.shipmentId
                                        ? `Shipment ${r.shipmentId}`
                                        : '',
                                      r.appointmentId
                                        ? `Appointment ${r.appointmentId}`
                                        : '',
                                    ]
                                      .filter(Boolean)
                                      .join(' · ') || '—'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        {!!selected.summary.skippedRows?.length && (
                          <div className="skipped-results">
                            <h3>Skipped before processing</h3>
                            {selected.summary.skippedRows.map((r, i) => (
                              <div key={i}>
                                <strong>
                                  {r.ordnum || 'Unidentified row'}
                                </strong>
                                <span>{r.reason}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="tab-empty">
                        <Activity />
                        <h3>
                          {selected.status === 'running'
                            ? 'Production is in progress'
                            : 'Results will appear after production'}
                        </h3>
                        <p>
                          Shipment, load, appointment, and wave outcomes are
                          recorded for each processed row.
                        </p>
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="activity">
                    <ol className="audit-list">
                      <li>
                        <Clock3 />
                        <div>
                          <strong>Run requested</strong>
                          <span>
                            {selected.requestedBy || 'Manual run'} ·{' '}
                            {time(selected.createdAt)}
                          </span>
                        </div>
                      </li>
                      {selected.fileName && (
                        <li>
                          <FileSpreadsheet />
                          <div>
                            <strong>Generated workbook stored</strong>
                            <span>{selected.fileName}</span>
                            <button
                              onClick={() => void download(selected, true)}
                            >
                              Download original
                            </button>
                          </div>
                        </li>
                      )}
                      {selected.rejectedAt && (
                        <li>
                          <X />
                          <div>
                            <strong>Generated file rejected</strong>
                            <span>
                              {selected.rejectedBy} ·{' '}
                              {time(selected.rejectedAt)}
                            </span>
                            <p>{selected.rejectReason}</p>
                          </div>
                        </li>
                      )}
                      {selected.decisionAt && (
                        <li>
                          <Check />
                          <div>
                            <strong>
                              {selected.source === 'replacement'
                                ? 'Replacement accepted'
                                : 'Production accepted'}
                            </strong>
                            <span>
                              {selected.decisionBy} ·{' '}
                              {time(selected.decisionAt)}
                            </span>
                            {selected.replacementFileName && (
                              <p>{selected.replacementFileName}</p>
                            )}
                          </div>
                        </li>
                      )}
                      {selected.finishedAt && (
                        <li>
                          <Activity />
                          <div>
                            <strong>{statuses[selected.status]}</strong>
                            <span>{time(selected.finishedAt)}</span>
                          </div>
                        </li>
                      )}
                    </ol>
                    <p className="table-footnote">
                      All times shown in Phoenix time.
                    </p>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </section>
        </div>
        <div className="section-title" id="history">
          <History />
          <h2>Run history</h2>
          <span>Latest 100 runs</span>
        </div>
        <section className="panel history">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Appointment date</TableHead>
                <TableHead>Workbook</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Accepted by</TableHead>
                <TableHead>Waves</TableHead>
                <TableHead>Inbound appts</TableHead>
                <TableHead>Issues / skipped</TableHead>
                <TableHead>Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.runId}>
                  <TableCell>{date(r.planDate)}</TableCell>
                  <TableCell>
                    {r.replacementFileName ||
                      r.fileName ||
                      (r.status === 'generating'
                        ? 'Preparing…'
                        : 'No workbook created')}
                  </TableCell>
                  <TableCell>
                    <State status={r.status} />
                  </TableCell>
                  <TableCell>{r.decisionBy || '—'}</TableCell>
                  <TableCell>{r.summary.wavesCreated ?? '—'}</TableCell>
                  <TableCell>{r.summary.inboundAppointments ?? '—'}</TableCell>
                  <TableCell>
                    {r.summary.failed !== undefined
                      ? `${r.summary.failed} / ${r.summary.skipped || 0}`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        void detail(r.runId).catch((e) => setError(e.message));
                        document
                          .querySelector('.review-layout')
                          ?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start',
                          });
                      }}
                    >
                      Open <ArrowRight />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!runs.length && (
            <p className="table-empty">
              {loading
                ? 'Loading run history…'
                : 'Run history will fill in as files are prepared and processed.'}
            </p>
          )}
        </section>
        <footer className="desk-footer">
          <span>
            Wave Bot <span className="footer-divider">/</span> fairlife Arizona
          </span>
          <span>
            {active
              ? 'Updates every 15 seconds'
              : 'All appointment times in Phoenix time'}
          </span>
        </footer>
      </section>
      <Dialog
        open={control !== null}
        onOpenChange={(open) => !open && !busy && setControl(null)}
      >
        <DialogContent>
          <DialogTitle>
            {control?.action === 'stop'
              ? 'Stop this workflow?'
              : 'Remove this file from the queue?'}
          </DialogTitle>
          <DialogDescription>
            {control?.action === 'stop'
              ? 'Stop the current execution in n8n. A request already sent to Blue Yonder may finish. Existing appointments and waves stay as they are; check the execution before starting another run.'
              : 'This file will no longer wait for approval or a replacement. Its workbook and history remain available. No Blue Yonder records will be changed.'}
          </DialogDescription>
          <p>
            Run {control?.run.runId} ·{' '}
            {control?.run.fileName || 'File preparation'}
          </p>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => setControl(null)}
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={readOnly || !!busy || !control}
              onClick={() =>
                control &&
                void perform(control.action, {
                  runId: control.run.runId,
                  expectedUpdatedAt: control.run.updatedAt,
                  confirm: true,
                })
              }
            >
              {busy && <LoaderCircle className="spin" />}
              {control?.action === 'stop'
                ? 'Stop workflow'
                : 'Remove from queue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={repair !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRepair(null);
        }}
      >
        <DialogContent className="decision-dialog" showCloseButton={!busy}>
          <DialogTitle>Repair this appointment in Blue Yonder?</DialogTitle>
          <DialogDescription>
            This changes production records after checking allocation and
            ownership. The saved wave is created if missing, or reused if it
            already belongs to this load and shipment. An old unallocated wave
            with a different name is replaced. Allocated waves stay unchanged.
          </DialogDescription>
          <div className="decision-file">
            <Truck />
            <div>
              <strong>
                Load {repair?.row.carMoveId} · Order {repair?.row.ordnum}
              </strong>
              <span>
                Wave: {repair?.row.schbat} · Shipment: {repair?.row.shipmentId}
              </span>
              <span>
                {time(String(repair?.row.startIso || ''))} to{' '}
                {time(String(repair?.row.endIso || ''))} · Arizona
              </span>
            </div>
          </div>
          <p>
            Once the wave and shipment link are verified, the existing
            appointment moves to the saved date, time and slot. Its appointment
            ID is kept. If the time already matches, no appointment update is
            sent.
          </p>
          <p>
            If a change cannot be confirmed, the repair stops for manual review.
            Check the recorded result before taking any further action.
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => setRepair(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={readOnly || !!busy || !repair}
              onClick={() =>
                repair &&
                void perform('repair', {
                  runId: repair.runId,
                  rowIndex: repair.rowIndex,
                  load: repair.row.carMoveId,
                  expectedUpdatedAt: repair.updatedAt,
                  repairId: repair.repairId,
                  confirm: true,
                })
              }
            >
              {busy && <LoaderCircle className="spin" />} Confirm repair in Blue
              Yonder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDecision(null);
        }}
      >
        <DialogContent className="decision-dialog" showCloseButton={!busy}>
          <DialogTitle>
            {decision === 'approve'
              ? 'Approve this workbook for production?'
              : 'Reject the generated workbook'}
          </DialogTitle>
          <DialogDescription>
            {decision === 'approve'
              ? `This starts the existing Blue Yonder production steps for ${date(selected?.planDate || '')}. Review the file before continuing.`
              : 'The generated workbook will not run. Record a reason, then upload your replacement Excel file.'}
          </DialogDescription>
          <div className="decision-file">
            <FileSpreadsheet />
            <div>
              <strong>{selected?.fileName}</strong>
              <span>
                {totalCount} file rows · {reviewedCount} active rows ·{' '}
                {selected?.planDate}
              </span>
            </div>
          </div>
          {decision === 'reject' && (
            <label className="reason-field" htmlFor="rejection-reason">
              Reason for rejection
              <Textarea
                id="rejection-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                placeholder="What needs to change in the replacement file?"
                disabled={!!busy}
              />
            </label>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDecision(null)}
              disabled={!!busy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void perform(decision || 'approve', { reason })}
              disabled={
                readOnly || !!busy || (decision === 'reject' && !reason.trim())
              }
            >
              {busy ? (
                <LoaderCircle className="spin" />
              ) : decision === 'approve' ? (
                <Check />
              ) : (
                <X />
              )}
              {decision === 'approve'
                ? 'Approve & start production'
                : 'Reject & choose replacement'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
