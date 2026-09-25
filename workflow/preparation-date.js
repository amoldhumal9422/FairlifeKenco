export function arizonaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** @param {unknown} value */
export function preparationDate(value, now = new Date()) {
  const today = arizonaToday(now);
  if (value === undefined) {
    const tomorrow = new Date(today + 'T00:00:00Z');
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('Choose a valid appointment date (YYYY-MM-DD).');
  const parsed = new Date(value + 'T00:00:00Z');
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new Error('Choose a valid appointment date (YYYY-MM-DD).');
  if (value < today)
    throw new Error('Choose today or a future date in Arizona.');
  return value;
}
