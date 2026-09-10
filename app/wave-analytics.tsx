'use client';

import { useMemo, type CSSProperties } from 'react';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis } from 'recharts';
import { BarChart3, CalendarDays, Truck, PieChart } from 'lucide-react';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { analyzeWorkbook, type WorkbookRow } from '@/lib/wave-metrics';

const colors = {
  outbound: '#62dfc5',
  inbound: '#91aafa',
  cancelled: '#e7b66c',
  other: '#9aa4b0',
};
const chartConfig = {
  outbound: { label: 'Outbound', color: colors.outbound },
  inbound: { label: 'Inbound', color: colors.inbound },
  other: { label: 'Other', color: colors.other },
};

export default function WaveAnalytics({
  rows,
  planDate,
  loading,
}: {
  rows: WorkbookRow[];
  planDate: string;
  loading: boolean;
}) {
  const data = useMemo(() => analyzeWorkbook(rows), [rows]);
  const date = planDate
    ? new Date(`${planDate}T12:00:00-07:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/Phoenix',
      })
    : '';
  const mix = [
    { label: 'Outbound', count: data.mix.outbound, color: colors.outbound },
    { label: 'Inbound', count: data.mix.inbound, color: colors.inbound },
    { label: 'Cancelled', count: data.mix.cancelled, color: colors.cancelled },
    ...(data.mix.other
      ? [{ label: 'Other', count: data.mix.other, color: colors.other }]
      : []),
  ];
  let offset = 0;
  const maxCarrier = data.carriers[0]?.count || 1;
  const empty = loading
    ? 'Loading workbook…'
    : 'Select a workbook to view data.';

  return (
    <section className="analytics-section" aria-labelledby="analytics-title">
      <div className="analytics-heading">
        <h2 id="analytics-title">Workbook breakdown</h2>
        <span>
          <CalendarDays />
          {date || 'No workbook selected'}
        </span>
      </div>
      <div className="analytics-grid">
        <section className="panel chart-panel">
          <div className="chart-heading">
            <h3>Appointment schedule</h3>
            <span>2-hour intervals</span>
          </div>
          {!data.total ? (
            <div className="chart-empty">
              <BarChart3 />
              {empty}
            </div>
          ) : (
            <>
              <div className="chart-legend">
                {Object.entries(chartConfig)
                  .filter(([key]) => key !== 'other' || data.mix.other)
                  .map(([key, value]) => (
                    <span key={key}>
                      <i
                        style={
                          { '--legend-color': value.color } as CSSProperties
                        }
                      />
                      {value.label}
                    </span>
                  ))}
              </div>
              <ChartContainer
                config={chartConfig}
                className="schedule-chart"
                aria-label={`Appointment schedule: ${data.active - data.untimed} active rows with valid times, in two-hour intervals.`}
              >
                <BarChart
                  accessibilityLayer
                  data={data.schedule}
                  margin={{ top: 4, right: 0, bottom: 0, left: -22 }}
                  barGap={2}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="#30383e"
                    strokeDasharray="3 4"
                  />
                  <XAxis
                    dataKey="hour"
                    axisLine={false}
                    tickLine={false}
                    minTickGap={14}
                    tickMargin={10}
                    fontSize={12}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                    tickMargin={7}
                    fontSize={12}
                    width={40}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent />}
                    cursor={{ fill: '#ffffff05' }}
                  />
                  <Bar
                    dataKey="outbound"
                    fill={colors.outbound}
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="inbound"
                    fill={colors.inbound}
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                  />
                  {data.mix.other > 0 && (
                    <Bar
                      dataKey="other"
                      fill={colors.other}
                      radius={[2, 2, 0, 0]}
                      isAnimationActive={false}
                    />
                  )}
                </BarChart>
              </ChartContainer>
              <div className="chart-foot">
                <span>
                  <strong>{data.active}</strong> active appointments
                  {data.untimed > 0 && ` · ${data.untimed} without time`}
                </span>
                <span>Phoenix time</span>
              </div>
            </>
          )}
        </section>
        <section className="panel chart-panel">
          <div className="chart-heading">
            <h3>Appointment mix</h3>
            <span>File rows</span>
          </div>
          {!data.total ? (
            <div className="chart-empty">
              <PieChart />
              {empty}
            </div>
          ) : (
            <>
              <div className="mix-body">
                <div className="donut">
                  <svg viewBox="0 0 140 140" aria-hidden="true">
                    <circle cx="70" cy="70" r="58" stroke="#2d353b" />
                    {mix
                      .filter((item) => item.count)
                      .map((item) => {
                        const start = offset;
                        const length = (item.count / data.total) * 100;
                        offset += length;
                        return (
                          <circle
                            key={item.label}
                            cx="70"
                            cy="70"
                            r="58"
                            pathLength="100"
                            stroke={item.color}
                            strokeDasharray={`${Math.max(0.1, length - 1.5)} ${100 - Math.max(0.1, length - 1.5)}`}
                            strokeDashoffset={-start}
                          >
                            <title>
                              {item.label}: {item.count}
                            </title>
                          </circle>
                        );
                      })}
                  </svg>
                  <div className="donut-total">
                    <strong>{data.total}</strong>
                    <span>total rows</span>
                  </div>
                </div>
                <div className="mix-key">
                  {mix.map((item) => (
                    <div key={item.label}>
                      <i
                        style={
                          { '--legend-color': item.color } as CSSProperties
                        }
                      />
                      <span>{item.label}</span>
                      <strong>{item.count}</strong>
                    </div>
                  ))}
                </div>
              </div>
              <div className="chart-foot">
                <span>Active share</span>
                <strong>{Math.round((data.active / data.total) * 100)}%</strong>
              </div>
            </>
          )}
        </section>
        <section className="panel chart-panel">
          <div className="chart-heading">
            <h3>Top carriers</h3>
            <span>Active rows</span>
          </div>
          {!data.total ? (
            <div className="chart-empty">
              <Truck />
              {empty}
            </div>
          ) : (
            <>
              <div className="carrier-chart">
                {data.carriers.slice(0, 5).map((carrier, index) => (
                  <div key={carrier.name}>
                    <div className="carrier-line">
                      <span title={carrier.name}>{carrier.name}</span>
                      <strong>{carrier.count}</strong>
                    </div>
                    <div className="carrier-track" aria-hidden="true">
                      <div
                        style={
                          {
                            width: `${(carrier.count / maxCarrier) * 100}%`,
                            '--bar-color': [
                              '#62dfc5',
                              '#54c5b1',
                              '#46a999',
                              '#398b80',
                              '#32766e',
                            ][index],
                          } as CSSProperties
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="chart-foot">
                <span>Carriers in this workbook</span>
                <strong>{data.carriers.length}</strong>
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
