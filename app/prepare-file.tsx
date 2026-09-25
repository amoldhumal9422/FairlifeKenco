import { useState } from 'react';
import { CalendarDays, LoaderCircle, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { arizonaToday, preparationDate } from '@/workflow/preparation-date.js';
import './prepare-file.css';

export default function PrepareFile({
  disabled,
  busy,
  onPrepare,
}: {
  disabled: boolean;
  busy: boolean;
  onPrepare: (planDate: string) => void;
}) {
  const [planDate, setPlanDate] = useState(() => preparationDate(undefined));
  const [error, setError] = useState('');
  let dateError = '';
  try {
    preparationDate(planDate);
  } catch (e) {
    dateError = (e as Error).message;
  }
  const label = dateError
    ? 'Choose today or a future date.'
    : new Date(planDate + 'T12:00:00-07:00').toLocaleDateString('en-US', {
        timeZone: 'America/Phoenix',
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

  return (
    <form
      className="preparation-controls"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || busy) return;
        try {
          const selectedDate = preparationDate(planDate);
          setError('');
          onPrepare(selectedDate);
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <div className="preparation-date">
        <label htmlFor="preparation-date">
          <CalendarDays /> OpenDock appointment date
        </label>
        <Input
          id="preparation-date"
          type="date"
          required
          min={arizonaToday()}
          max="9999-12-31"
          value={planDate}
          disabled={disabled || busy}
          aria-describedby="preparation-date-help"
          aria-invalid={!!dateError}
          onChange={(event) => {
            setPlanDate(event.target.value);
            setError('');
          }}
        />
      </div>
      <div className="preparation-help" id="preparation-date-help">
        <strong>{label}</strong>
        <span>Arizona time · The file will wait for your approval.</span>
        {(error || dateError) && <span role="alert">{error || dateError}</span>}
      </div>
      <Button
        type="submit"
        className="primary-action"
        disabled={disabled || busy || !!dateError}
      >
        {busy ? <LoaderCircle className="spin" /> : <Play />}
        {busy ? 'Preparing file…' : 'Prepare file'}
      </Button>
    </form>
  );
}
