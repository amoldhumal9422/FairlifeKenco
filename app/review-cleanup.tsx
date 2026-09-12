import { useMemo, useState } from 'react';
import { Trash2, LoaderCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { oldReviewFiles } from '@/lib/run-progress';
import type { Run } from './wave-desk';

export default function ReviewCleanup({
  runs,
  busy,
  onClose,
  onRemove,
}: {
  runs: Run[];
  busy: boolean;
  onClose: () => void;
  onRemove: (runs: Run[]) => void;
}) {
  const [through, setThrough] = useState(() =>
    new Date(Date.now() - 7 * 86400000 - 7 * 3600000)
      .toISOString()
      .slice(0, 10),
  );
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const available = useMemo(
    () => oldReviewFiles(runs, through),
    [runs, through],
  );
  const chosen = available.filter((r) => checked.has(r.runId));
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="cleanup-dialog" showCloseButton={!busy}>
        <DialogTitle>Clear old review files</DialogTitle>
        <DialogDescription>
          Select unused files to remove from the review queue. Workbooks and run
          history remain available. Active runs, completed production, and
          repairs needing review are excluded.
        </DialogDescription>
        <label className="cleanup-date" htmlFor="cleanup-through">
          Created on or before · Phoenix
          <Input
            id="cleanup-through"
            type="date"
            value={through}
            onChange={(e) => {
              setThrough(e.target.value);
              setChecked(new Set());
            }}
            disabled={busy}
          />
        </label>
        <div className="cleanup-selection">
          <span>
            {chosen.length} of {available.length} selected
          </span>
          <Button
            variant="ghost"
            disabled={busy || !available.length}
            onClick={() =>
              setChecked(
                chosen.length === available.length
                  ? new Set()
                  : new Set(available.map((r) => r.runId)),
              )
            }
          >
            {chosen.length && chosen.length === available.length
              ? 'Deselect all'
              : 'Select all shown'}
          </Button>
        </div>
        <div className="cleanup-files">
          {available.map((run) => (
            <label key={run.runId} aria-label={`Remove run ${run.runId}`}>
              <input
                type="checkbox"
                checked={checked.has(run.runId)}
                disabled={busy}
                onChange={(e) =>
                  setChecked((previous) => {
                    const next = new Set(previous);
                    if (e.target.checked) next.add(run.runId);
                    else next.delete(run.runId);
                    return next;
                  })
                }
              />
              <span>
                <strong>{run.fileName || 'No workbook created'}</strong>
                <small>
                  Run {run.runId} · {run.status} ·{' '}
                  {run.planDate || 'No appointment date'}
                </small>
              </span>
            </label>
          ))}
          {!available.length && (
            <p>
              No eligible files for this date. Choose a later date to see more.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy || !chosen.length}
            onClick={() => onRemove(chosen)}
          >
            {busy ? <LoaderCircle className="spin" /> : <Trash2 />}Remove{' '}
            {chosen.length} selected {chosen.length === 1 ? 'file' : 'files'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
