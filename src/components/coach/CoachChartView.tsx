import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CoachChart } from '../../lib/coachChart.js';

/** Accent first, then colors that stay distinct on the dark surface. */
const SERIES_COLORS = ['#f58426', '#4aa8e8', '#22c55e', '#c084fc'];

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const precise = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** A chart Coach Van attached to an answer. */
function CoachChartView({ chart }: { chart: CoachChart }): React.JSX.Element {
  const data = chart.labels.map((label, i) => {
    const row: Record<string, string | number | null> = { label };
    chart.series.forEach((s, j) => {
      row[`s${j}`] = s.values[i];
    });
    return row;
  });

  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
      <XAxis
        dataKey="label"
        interval="preserveStartEnd"
        minTickGap={24}
        tickMargin={8}
        height={30}
        tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
        stroke="var(--border)"
        tickLine={false}
      />
      <YAxis
        width={42}
        tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
        stroke="transparent"
        tickLine={false}
        tickFormatter={(v: number) => compact.format(v)}
        domain={chart.type === 'line' ? ['auto', 'auto'] : [0, 'auto']}
      />
      <Tooltip
        cursor={chart.type === 'line' ? { stroke: 'var(--border)', strokeWidth: 1 } : { fill: 'rgba(255, 255, 255, 0.04)' }}
        contentStyle={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 12,
        }}
        labelStyle={{ color: 'var(--text-secondary)' }}
        formatter={(value, name) => [
          `${precise.format(Number(value))}${chart.yLabel ? ` ${chart.yLabel}` : ''}`,
          name,
        ]}
      />
      {chart.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }} iconSize={8} />}
    </>
  );

  return (
    <figure className="coach-chart">
      <figcaption className="coach-chart-title">
        {chart.title}
        {chart.yLabel && <span className="coach-chart-unit">{chart.yLabel}</span>}
      </figcaption>
      <div className="coach-chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === 'line' ? (
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              {axes}
              {chart.series.map((s, j) => (
                <Line
                  key={j}
                  type="monotone"
                  dataKey={`s${j}`}
                  name={s.name}
                  stroke={SERIES_COLORS[j % SERIES_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              {axes}
              {chart.series.map((s, j) => (
                <Bar
                  key={j}
                  dataKey={`s${j}`}
                  name={s.name}
                  fill={SERIES_COLORS[j % SERIES_COLORS.length]}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export default CoachChartView;
