export type WorkbookRow = Record<string, string | number | boolean>;

export function analyzeWorkbook(rows: WorkbookRow[]) {
  const schedule = Array.from({ length: 12 }, (_, index) => ({
    hour: `${String(index * 2).padStart(2, '0')}:00`,
    outbound: 0,
    inbound: 0,
    other: 0,
  }));
  const carriers = new Map<string, { name: string; count: number }>();
  const mix = { outbound: 0, inbound: 0, cancelled: 0, other: 0 };
  let untimed = 0;

  for (const row of rows) {
    const direction = String(row['IB-OB'] ?? '')
      .trim()
      .toUpperCase();
    if (direction.includes('CANCEL')) {
      mix.cancelled++;
      continue;
    }
    const kind = ['OB', 'OUTBOUND'].includes(direction)
      ? 'outbound'
      : ['IB', 'INBOUND'].includes(direction)
        ? 'inbound'
        : 'other';
    mix[kind]++;
    const carrier = String(
      row['Carrier Name'] || row.SCAC || 'Not specified',
    ).trim();
    const key = carrier.toUpperCase();
    const entry = carriers.get(key) || { name: carrier, count: 0 };
    entry.count++;
    carriers.set(key, entry);

    const value = row['Appt Time'];
    let minutes: number | null = null;
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value < 1
    ) {
      minutes = Math.min(1439, Math.round(value * 1440));
    } else if (typeof value === 'string') {
      const match = value
        .trim()
        .match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
      if (match) {
        let hour = Number(match[1]);
        const minute = Number(match[2]);
        const period = match[3]?.toUpperCase();
        if (period && hour >= 1 && hour <= 12)
          hour = (hour % 12) + (period === 'PM' ? 12 : 0);
        else if (period) hour = -1;
        if (hour >= 0 && hour <= 23 && minute <= 59)
          minutes = hour * 60 + minute;
      }
    }
    if (minutes === null) untimed++;
    else schedule[Math.floor(minutes / 120)][kind]++;
  }

  return {
    schedule,
    mix,
    total: rows.length,
    active: rows.length - mix.cancelled,
    untimed,
    carriers: [...carriers.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    ),
  };
}
