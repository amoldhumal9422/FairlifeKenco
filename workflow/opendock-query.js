export function buildAppointmentQuery(cfg, items, DateTime) {
  const warehouses = items.flatMap((i) =>
    Array.isArray(i.json)
      ? i.json
      : Array.isArray(i.json.data)
        ? i.json.data
        : i.json.id
          ? [i.json]
          : [],
  );
  if (!warehouses.length) {
    throw new Error(
      `No OpenDock warehouse name contains "${cfg.warehouseNameContains}"`,
    );
  }
  if (warehouses.length !== 1)
    throw new Error(
      'Multiple OpenDock warehouses matched. Narrow the warehouse name before generating a wave file.',
    );
  const wh = warehouses[0];
  const tz = wh.timezone || 'America/Phoenix';

  if (
    cfg.planDate !== undefined &&
    (typeof cfg.planDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(cfg.planDate))
  )
    throw new Error('The selected appointment date is invalid.');
  const dayStart =
    cfg.planDate === undefined
      ? DateTime.now().setZone(tz).plus({ days: cfg.daysAhead }).startOf('day')
      : DateTime.fromISO(cfg.planDate, { zone: tz }).startOf('day');
  if (
    !dayStart.isValid ||
    (cfg.planDate !== undefined && dayStart.toISODate() !== cfg.planDate)
  )
    throw new Error('The selected appointment date is invalid.');
  const dayEnd = dayStart.plus({ days: 1 });

  const s = {
    $and: [
      { start: { $gte: dayStart.toUTC().toISO() } },
      { start: { $lt: dayEnd.toUTC().toISO() } },
      { 'dock.warehouseId': { $eq: wh.id } },
    ],
  };
  const joins = ['user', 'user.company', 'dock', 'loadType'];
  const qs = [
    `s=${encodeURIComponent(JSON.stringify(s))}`,
    ...joins.map((j) => `join=${encodeURIComponent(j)}`),
    `sort=${encodeURIComponent('start,ASC')}`,
    'limit=1000',
    `warehouseId=${encodeURIComponent(wh.id)}`,
  ].join('&');

  const safeName = String(wh.name || 'warehouse')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return [
    {
      json: {
        warehouseId: wh.id,
        warehouseName: wh.name,
        timezone: tz,
        uploadSheetName: DateTime.now()
          .setZone('America/Phoenix')
          .toFormat('M.d'),
        dateLabel: dayStart.toISODate(),
        windowStartUtc: dayStart.toUTC().toISO(),
        windowEndUtc: dayEnd.toUTC().toISO(),
        appointmentsUrl: `${cfg.apiUrl}/appointment?${qs}`,
        fileName: `OpenDock_Appointments_${safeName}_${dayStart.toISODate()}.xlsx`,
      },
    },
  ];
}
