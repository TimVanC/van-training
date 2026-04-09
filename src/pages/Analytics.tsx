import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getSession } from '../utils/auth';

interface SessionAnalyticsRow {
  sessionId: string;
  date: string;
  topSetWeight: number;
  topSetReps: number;
  topSetRir: number;
  totalVolume: number;
}

interface RepPrEntry {
  weight: number;
  maxReps: number;
}

interface ExerciseAnalyticsResponse {
  exercises: string[];
  sessions: SessionAnalyticsRow[];
  repPrs: RepPrEntry[];
}

type DateRangeKey = '30D' | '90D' | '6M' | '1Y' | 'ALL';

interface TopSetSummary {
  current: SessionAnalyticsRow | null;
  previous: SessionAnalyticsRow | null;
  changeText: string;
}

interface TopSetChartRow extends SessionAnalyticsRow {
  shortDate: string;
  topSetStrength: number;
  isPr: boolean;
}

interface DotRendererProps {
  cx?: number;
  cy?: number;
  payload?: TopSetChartRow;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: TopSetChartRow }>;
}

const tableCellStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  textAlign: 'left',
};

const numberFormatter = new Intl.NumberFormat('en-US');
const dateRangeOptions: Array<{ value: DateRangeKey; label: string }> = [
  { value: '30D', label: '30D' },
  { value: '90D', label: '90D' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'ALL', label: 'All' },
];
const tooltipPanelStyle: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #1f2937',
  borderRadius: 8,
  padding: '0.75rem',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
  lineHeight: 1.5,
};
const tooltipTitleStyle: React.CSSProperties = {
  margin: 0,
  color: '#ffffff',
  fontWeight: 600,
};
const tooltipBodyStyle: React.CSSProperties = {
  margin: '0.5rem 0 0',
  color: '#d1d5db',
  lineHeight: 1.5,
};
const tooltipLabelStyle: React.CSSProperties = {
  color: '#9ca3af',
};
const chartContainerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 1080,
  height: 'clamp(220px, 42vw, 300px)',
};
const chartLineMargin = { top: 8, right: 4, left: 4, bottom: 18 };

function formatDateLabel(dateValue: string): string {
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatRir(rir: number): string {
  return Number.isInteger(rir) ? String(rir) : rir.toFixed(1);
}

function getRepDotRadius(reps: number): number {
  const safeReps = Number.isFinite(reps) ? reps : 0;
  return Math.max(4, Math.min(10, 3 + safeReps * 0.4));
}

function getTopSetStrength(weight: number, reps: number, rir: number): number {
  const safeWeight = Number.isFinite(weight) ? weight : 0;
  const safeReps = Number.isFinite(reps) ? reps : 0;
  const safeRir = Number.isFinite(rir) ? rir : 0;
  const effectiveReps = safeReps + safeRir;
  return safeWeight * (1 + effectiveReps / 30);
}

function getAxisUpperBound(maxValue: number): number {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 10;
  const target = maxValue + 10;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(target)) - 1);
  const step = Math.max(5, magnitude);
  return Math.ceil(target / step) * step;
}

function getRangeWeeks(range: DateRangeKey, sessions: SessionAnalyticsRow[]): number {
  if (range === '30D') return 30 / 7;
  if (range === '90D') return 90 / 7;
  if (range === '6M') return 26;
  if (range === '1Y') return 52;
  if (sessions.length < 2) return 1;
  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const first = new Date(ordered[0]?.date ?? '');
  const last = new Date(ordered[ordered.length - 1]?.date ?? '');
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return 1;
  const diffDays = Math.max(1, Math.ceil((last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24)));
  return Math.max(1, diffDays / 7);
}

function getTopSetSummary(sessions: SessionAnalyticsRow[]): TopSetSummary {
  if (sessions.length === 0) {
    return {
      current: null,
      previous: null,
      changeText: '-',
    };
  }
  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const current = ordered[ordered.length - 1] ?? null;
  const previous = ordered.length > 1 ? (ordered[ordered.length - 2] ?? null) : null;
  if (!current || !previous) {
    return {
      current,
      previous,
      changeText: 'No previous top set in range',
    };
  }

  const weightDelta = current.topSetWeight - previous.topSetWeight;
  const repsDelta = current.topSetReps - previous.topSetReps;
  if (weightDelta !== 0) {
    const sign = weightDelta > 0 ? '+' : '';
    return {
      current,
      previous,
      changeText: `${sign}${weightDelta} lbs`,
    };
  }
  if (repsDelta !== 0) {
    const sign = repsDelta > 0 ? '+' : '';
    return {
      current,
      previous,
      changeText: `${sign}${repsDelta} reps`,
    };
  }
  return {
    current,
    previous,
    changeText: 'No change',
  };
}

function Analytics(): React.JSX.Element {
  const [allExercises, setAllExercises] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [selectedExercise, setSelectedExercise] = useState('');
  const [sessions, setSessions] = useState<SessionAnalyticsRow[] | null>(null);
  const [repPrs, setRepPrs] = useState<RepPrEntry[]>([]);
  const [loadingExercises, setLoadingExercises] = useState(false);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showStrengthInfo, setShowStrengthInfo] = useState(false);
  const [showVolumeInfo, setShowVolumeInfo] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeKey>('30D');
  const containerRef = useRef<HTMLDivElement | null>(null);

  const filteredExercises = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    if (!needle) return allExercises;
    return allExercises.filter((exercise) => exercise.toLowerCase().includes(needle));
  }, [allExercises, searchText]);

  const chartRows = useMemo(
    () => {
      const ordered = [...(sessions ?? [])].sort((a, b) => a.date.localeCompare(b.date));
      let bestSoFar = Number.NEGATIVE_INFINITY;
      return ordered.map((session) => {
        const topSetStrength = getTopSetStrength(
          session.topSetWeight,
          session.topSetReps,
          session.topSetRir,
        );
        const isPr = topSetStrength > bestSoFar;
        if (isPr) bestSoFar = topSetStrength;
        return {
          ...session,
          shortDate: formatDateLabel(session.date),
          topSetStrength,
          isPr,
        };
      });
    },
    [sessions],
  );

  const tableRows = useMemo(() => [...(sessions ?? [])].reverse(), [sessions]);
  const topSetSummary = useMemo(() => getTopSetSummary(sessions ?? []), [sessions]);
  const filteredRepPrs = useMemo(
    () =>
      [...repPrs]
        .filter((entry) => entry.weight > 0 && entry.maxReps > 0)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 8),
    [repPrs],
  );
  const frequencyPerWeek = useMemo(() => {
    const sessionCount = sessions?.length ?? 0;
    if (sessionCount === 0) return 0;
    const weeks = getRangeWeeks(dateRange, sessions ?? []);
    return sessionCount / weeks;
  }, [dateRange, sessions]);
  const topSetAxisUpper = useMemo(() => {
    if (chartRows.length === 0) return 10;
    const maxStrength = Math.max(...chartRows.map((row) => row.topSetStrength));
    return getAxisUpperBound(maxStrength);
  }, [chartRows]);
  const volumeAxisUpper = useMemo(() => {
    if (chartRows.length === 0) return 10;
    const maxVolume = Math.max(...chartRows.map((row) => row.totalVolume));
    return getAxisUpperBound(maxVolume);
  }, [chartRows]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent): void {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    void (async () => {
      setLoadingExercises(true);
      try {
        const session = await getSession();
        const token = session?.access_token;
        const res = await fetch('/api/getExerciseHistory', {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          setAllExercises([]);
          return;
        }
        const data = (await res.json()) as ExerciseAnalyticsResponse;
        setAllExercises(Array.isArray(data.exercises) ? data.exercises : []);
      } catch {
        setAllExercises([]);
      } finally {
        setLoadingExercises(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedExercise) {
      setSessions(null);
      setRepPrs([]);
      return;
    }
    void (async () => {
      setLoadingAnalytics(true);
      try {
        const session = await getSession();
        const token = session?.access_token;
        const res = await fetch(
          `/api/getExerciseHistory?exercise_name=${encodeURIComponent(selectedExercise)}&range=${dateRange}`,
          {
            cache: 'no-store',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (!res.ok) {
          setSessions([]);
          setRepPrs([]);
          return;
        }
        const data = (await res.json()) as ExerciseAnalyticsResponse;
        setSessions(Array.isArray(data.sessions) ? data.sessions : []);
        setRepPrs(Array.isArray(data.repPrs) ? data.repPrs : []);
      } catch {
        setSessions([]);
        setRepPrs([]);
      } finally {
        setLoadingAnalytics(false);
      }
    })();
  }, [selectedExercise, dateRange]);

  function handleSelectExercise(exercise: string): void {
    setSelectedExercise(exercise);
    setSearchText(exercise);
    setDropdownOpen(false);
  }

  function handleSearchChange(value: string): void {
    setSearchText(value);
    if (selectedExercise && value.trim().toLowerCase() !== selectedExercise.toLowerCase()) {
      setSelectedExercise('');
      setSessions(null);
      setRepPrs([]);
    }
  }

  return (
    <div className="page">
      <h1>Analytics</h1>

      <div ref={containerRef} style={{ width: '100%', maxWidth: 560, position: 'relative' }}>
        <label htmlFor="exercise-selector">Exercise</label>
        <input
          id="exercise-selector"
          type="text"
          placeholder={loadingExercises ? 'Loading exercises...' : 'Search exercises'}
          value={searchText}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => setDropdownOpen(true)}
          onClick={() => setDropdownOpen(true)}
          disabled={loadingExercises}
          autoComplete="off"
        />
        {dropdownOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 8,
              marginTop: 4,
              maxHeight: 240,
              overflowY: 'auto',
              zIndex: 10,
            }}
          >
            {filteredExercises.length === 0 ? (
              <div style={{ padding: '0.5rem 0.75rem' }}>No matching exercises</div>
            ) : (
              filteredExercises.map((exercise) => (
                <button
                  key={exercise}
                  type="button"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.5rem 0.75rem',
                    border: 'none',
                    background: selectedExercise === exercise ? '#f1f5ff' : 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => handleSelectExercise(exercise)}
                >
                  {exercise}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div style={{ width: '100%', maxWidth: 560 }}>
        <label htmlFor="analytics-date-range">Date range</label>
        <select
          id="analytics-date-range"
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
          disabled={loadingAnalytics}
        >
          {dateRangeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {!selectedExercise && <p>Select an exercise to view progression.</p>}
      {loadingAnalytics && <p>Loading...</p>}
      {!loadingAnalytics && selectedExercise && sessions !== null && sessions.length === 0 && (
        <p>No data found</p>
      )}
      {!loadingAnalytics && sessions !== null && sessions.length > 0 && (
        <>
          <h2>Top Set Summary</h2>
          <div style={{ width: '100%', maxWidth: 720 }}>
            <p style={{ margin: '0.25rem 0' }}>
              Current top set:{' '}
              {topSetSummary.current
                ? `${numberFormatter.format(topSetSummary.current.topSetWeight)} x ${topSetSummary.current.topSetReps}`
                : '-'}
            </p>
            <p style={{ margin: '0.25rem 0' }}>
              Previous top set:{' '}
              {topSetSummary.previous
                ? `${numberFormatter.format(topSetSummary.previous.topSetWeight)} x ${topSetSummary.previous.topSetReps}`
                : '-'}
            </p>
            <p style={{ margin: '0.25rem 0' }}>Change: {topSetSummary.changeText}</p>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              position: 'relative',
              width: 'fit-content',
            }}
          >
            <h2 style={{ margin: 0 }}>Top Set Strength</h2>
            <button
              type="button"
              aria-label="What is Top Set Strength?"
              onMouseEnter={() => setShowStrengthInfo(true)}
              onMouseLeave={() => setShowStrengthInfo(false)}
              onFocus={() => setShowStrengthInfo(true)}
              onBlur={() => setShowStrengthInfo(false)}
              onClick={() => setShowStrengthInfo((prev) => !prev)}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: '#334155',
                fontSize: '0.85rem',
                lineHeight: 1,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              i
            </button>
            {showStrengthInfo && (
              <div
                role="tooltip"
                style={{
                  position: 'absolute',
                  top: '110%',
                  left: 0,
                  zIndex: 20,
                  width: 300,
                  maxWidth: '90vw',
                  ...tooltipPanelStyle,
                }}
              >
                <p style={tooltipTitleStyle}>What is this?</p>
                <p style={tooltipBodyStyle}>
                  We estimate your strength from your best set.
                </p>
                <p style={tooltipBodyStyle}>
                  More reps at the same weight = stronger.
                </p>
                <p style={tooltipBodyStyle}>
                  Example: 90 x 10 is stronger than 90 x 8.
                </p>
                <p style={tooltipBodyStyle}>
                  We convert that into one number so your progress is easy to see.
                </p>
              </div>
            )}
          </div>
          <div style={chartContainerStyle}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={chartLineMargin}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="shortDate" interval="preserveStartEnd" minTickGap={28} tickMargin={10} height={36} />
                <YAxis domain={[0, topSetAxisUpper]} width={50} />
                <Tooltip
                  cursor={{ stroke: '#374151', strokeWidth: 1 }}
                  content={({ active, payload }: ChartTooltipProps) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const row = payload[0]?.payload;
                    if (!row) return null;
                    return (
                      <div style={tooltipPanelStyle}>
                        <p style={tooltipTitleStyle}>{row.date}</p>
                        <p style={tooltipBodyStyle}>
                          <span style={tooltipLabelStyle}>Top Set:</span> {numberFormatter.format(row.topSetWeight)} x {row.topSetReps}{' '}
                          <span style={tooltipLabelStyle}>@ RIR</span> {formatRir(row.topSetRir)}
                        </p>
                        <p style={tooltipBodyStyle}>
                          <span style={tooltipLabelStyle}>Strength:</span>{' '}
                          {numberFormatter.format(Number(row.topSetStrength.toFixed(1)))}
                        </p>
                        {row.isPr && <p style={tooltipBodyStyle}>PR ✔</p>}
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="topSetStrength"
                  name="Top Set Strength"
                  stroke="#8884d8"
                  dot={(props: DotRendererProps) => {
                    if (props.cx == null || props.cy == null || !props.payload) return null;
                    const isPr = props.payload.isPr;
                    return (
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={getRepDotRadius(props.payload.topSetReps) + (isPr ? 1.5 : 0)}
                        fill={isPr ? '#22c55e' : '#8884d8'}
                        stroke={isPr ? '#86efac' : '#ffffff'}
                        strokeWidth={isPr ? 2 : 1.5}
                        style={isPr ? { filter: 'drop-shadow(0 0 6px rgba(34, 197, 94, 0.55))' } : undefined}
                      />
                    );
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <h2>Rep PR by Weight</h2>
          <ul style={{ marginTop: 0, paddingLeft: '1.25rem' }}>
            {filteredRepPrs.map((entry) => (
              <li key={`${entry.weight}-${entry.maxReps}`}>
                {numberFormatter.format(entry.weight)} lbs {'->'} {entry.maxReps} reps
              </li>
            ))}
          </ul>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              position: 'relative',
              width: 'fit-content',
            }}
          >
            <h2 style={{ margin: 0 }}>Volume Trend</h2>
            <button
              type="button"
              aria-label="What is volume?"
              onMouseEnter={() => setShowVolumeInfo(true)}
              onMouseLeave={() => setShowVolumeInfo(false)}
              onFocus={() => setShowVolumeInfo(true)}
              onBlur={() => setShowVolumeInfo(false)}
              onClick={() => setShowVolumeInfo((prev) => !prev)}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: '#334155',
                fontSize: '0.85rem',
                lineHeight: 1,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              i
            </button>
            {showVolumeInfo && (
              <div
                role="tooltip"
                style={{
                  position: 'absolute',
                  top: '110%',
                  left: 0,
                  zIndex: 20,
                  width: 300,
                  maxWidth: '90vw',
                  ...tooltipPanelStyle,
                }}
              >
                <p style={tooltipTitleStyle}>What is volume?</p>
                <p style={tooltipBodyStyle}>
                  Volume is the total work you did in a workout.
                </p>
                <p style={tooltipBodyStyle}>
                  We calculate it as: weight x reps for every set.
                </p>
                <p style={tooltipBodyStyle}>
                  Higher volume means more total workload.
                </p>
              </div>
            )}
          </div>
          <div style={chartContainerStyle}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={chartLineMargin}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="shortDate" interval="preserveStartEnd" minTickGap={28} tickMargin={10} height={36} />
                <YAxis domain={[0, volumeAxisUpper]} width={50} />
                <Tooltip
                  cursor={{ stroke: '#374151', strokeWidth: 1 }}
                  content={({ active, payload }: ChartTooltipProps) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const row = payload[0]?.payload;
                    if (!row) return null;
                    return (
                      <div style={tooltipPanelStyle}>
                        <p style={tooltipTitleStyle}>{row.date}</p>
                        <p style={tooltipBodyStyle}>
                          <span style={tooltipLabelStyle}>Total Volume:</span>{' '}
                          {numberFormatter.format(Math.round(row.totalVolume))}
                        </p>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="totalVolume"
                  name="Total Volume"
                  stroke="#82ca9d"
                  dot
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <p style={{ margin: '0.5rem 0 1rem', color: '#475569' }}>
            Frequency: {frequencyPerWeek.toFixed(1)}x per week
          </p>

          <h2>Recent Sessions</h2>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', maxWidth: 720 }}>
            <thead>
              <tr>
                <th style={tableCellStyle}>Date</th>
                <th style={tableCellStyle}>Top Set</th>
                <th style={tableCellStyle}>Total Volume</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.sessionId}>
                  <td style={tableCellStyle}>{row.date}</td>
                  <td style={tableCellStyle}>
                    {numberFormatter.format(row.topSetWeight)} x {row.topSetReps} @ RIR{' '}
                    {formatRir(row.topSetRir)}
                  </td>
                  <td style={tableCellStyle}>{numberFormatter.format(Math.round(row.totalVolume))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default Analytics;
