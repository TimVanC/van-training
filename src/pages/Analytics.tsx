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

const numberFormatter = new Intl.NumberFormat('en-US');
const dateRangeOptions: Array<{ value: DateRangeKey; label: string }> = [
  { value: '30D', label: '30D' },
  { value: '90D', label: '90D' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'ALL', label: 'All' },
];
const chartContainerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '100%',
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

      <div ref={containerRef} className="analytics-field-group">
        <label htmlFor="exercise-selector">Exercise</label>
        <input
          id="exercise-selector"
          className="input-field"
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
          <div className="analytics-dropdown">
            {filteredExercises.length === 0 ? (
              <div className="analytics-dropdown-empty">No matching exercises</div>
            ) : (
              filteredExercises.map((exercise) => (
                <button
                  key={exercise}
                  type="button"
                  className={`analytics-dropdown-item ${selectedExercise === exercise ? 'analytics-dropdown-item--selected' : ''}`}
                  onClick={() => handleSelectExercise(exercise)}
                >
                  {exercise}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="analytics-field-group">
        <label htmlFor="analytics-date-range">Date range</label>
        <select
          id="analytics-date-range"
          className="input-field"
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

      {!selectedExercise && <p className="analytics-empty-state">Select an exercise to view progression.</p>}
      {loadingAnalytics && <p className="analytics-empty-state">Loading...</p>}
      {!loadingAnalytics && selectedExercise && sessions !== null && sessions.length === 0 && (
        <p className="analytics-empty-state">No data found</p>
      )}
      {!loadingAnalytics && sessions !== null && sessions.length > 0 && (
        <>
          <div className="analytics-card">
            <h2 className="analytics-section-title">Top Set Summary</h2>
            <div className="analytics-summary-row">
              <span>Current top set</span>
              <strong>
                {topSetSummary.current
                  ? `${numberFormatter.format(topSetSummary.current.topSetWeight)} x ${topSetSummary.current.topSetReps}`
                  : '-'}
              </strong>
            </div>
            <div className="analytics-summary-row">
              <span>Previous top set</span>
              <strong>
                {topSetSummary.previous
                  ? `${numberFormatter.format(topSetSummary.previous.topSetWeight)} x ${topSetSummary.previous.topSetReps}`
                  : '-'}
              </strong>
            </div>
            <div className="analytics-summary-row">
              <span>Change</span>
              <strong>{topSetSummary.changeText}</strong>
            </div>
          </div>

          <div className="analytics-card">
            <div className="analytics-chart-header">
              <h2 className="analytics-section-title">Top Set Strength</h2>
              <button
                type="button"
                className="analytics-info-button"
                aria-label="What is Top Set Strength?"
                onMouseEnter={() => setShowStrengthInfo(true)}
                onMouseLeave={() => setShowStrengthInfo(false)}
                onFocus={() => setShowStrengthInfo(true)}
                onBlur={() => setShowStrengthInfo(false)}
                onClick={() => setShowStrengthInfo((prev) => !prev)}
              >
                i
              </button>
              {showStrengthInfo && (
                <div
                  role="tooltip"
                  className="analytics-tooltip-panel"
                  style={{ position: 'absolute', top: '110%', left: 0, zIndex: 20, width: 300, maxWidth: '90vw' }}
                >
                  <p className="analytics-tooltip-title">What is this?</p>
                  <p className="analytics-tooltip-body">
                    We estimate your strength from your best set.
                  </p>
                  <p className="analytics-tooltip-body">
                    More reps at the same weight = stronger.
                  </p>
                  <p className="analytics-tooltip-body">
                    Example: 90 x 10 is stronger than 90 x 8.
                  </p>
                  <p className="analytics-tooltip-body">
                    We convert that into one number so your progress is easy to see.
                  </p>
                </div>
              )}
            </div>
            <div style={chartContainerStyle}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={chartLineMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="shortDate" interval="preserveStartEnd" minTickGap={28} tickMargin={10} height={36} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} stroke="var(--border)" />
                  <YAxis domain={[0, topSetAxisUpper]} width={50} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} stroke="var(--border)" />
                  <Tooltip
                    cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                    content={({ active, payload }: ChartTooltipProps) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const row = payload[0]?.payload;
                      if (!row) return null;
                      return (
                        <div className="analytics-tooltip-panel">
                          <p className="analytics-tooltip-title">{row.date}</p>
                          <p className="analytics-tooltip-body">
                            <span className="analytics-tooltip-label">Top Set:</span> {numberFormatter.format(row.topSetWeight)} x {row.topSetReps}{' '}
                            <span className="analytics-tooltip-label">@ RIR</span> {formatRir(row.topSetRir)}
                          </p>
                          <p className="analytics-tooltip-body">
                            <span className="analytics-tooltip-label">Strength:</span>{' '}
                            {numberFormatter.format(Number(row.topSetStrength.toFixed(1)))}
                          </p>
                          {row.isPr && <p className="analytics-tooltip-body">PR ✔</p>}
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="topSetStrength"
                    name="Top Set Strength"
                    stroke="var(--accent)"
                    dot={(props: DotRendererProps) => {
                      if (props.cx == null || props.cy == null || !props.payload) return null;
                      const isPr = props.payload.isPr;
                      return (
                        <circle
                          cx={props.cx}
                          cy={props.cy}
                          r={getRepDotRadius(props.payload.topSetReps) + (isPr ? 1.5 : 0)}
                          fill={isPr ? '#22c55e' : 'var(--accent)'}
                          stroke={isPr ? '#86efac' : 'var(--bg-primary)'}
                          strokeWidth={isPr ? 2 : 1.5}
                          style={isPr ? { filter: 'drop-shadow(0 0 6px rgba(34, 197, 94, 0.55))' } : undefined}
                        />
                      );
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="analytics-card">
            <h2 className="analytics-section-title">Rep PR by Weight</h2>
            <ul className="analytics-rep-pr-list">
              {filteredRepPrs.map((entry) => (
                <li key={`${entry.weight}-${entry.maxReps}`}>
                  {numberFormatter.format(entry.weight)} lbs {'->'} {entry.maxReps} reps
                </li>
              ))}
            </ul>
          </div>

          <div className="analytics-card">
            <div className="analytics-chart-header">
              <h2 className="analytics-section-title">Volume Trend</h2>
              <button
                type="button"
                className="analytics-info-button"
                aria-label="What is volume?"
                onMouseEnter={() => setShowVolumeInfo(true)}
                onMouseLeave={() => setShowVolumeInfo(false)}
                onFocus={() => setShowVolumeInfo(true)}
                onBlur={() => setShowVolumeInfo(false)}
                onClick={() => setShowVolumeInfo((prev) => !prev)}
              >
                i
              </button>
              {showVolumeInfo && (
                <div
                  role="tooltip"
                  className="analytics-tooltip-panel"
                  style={{ position: 'absolute', top: '110%', left: 0, zIndex: 20, width: 300, maxWidth: '90vw' }}
                >
                  <p className="analytics-tooltip-title">What is volume?</p>
                  <p className="analytics-tooltip-body">
                    Volume is the total work you did in a workout.
                  </p>
                  <p className="analytics-tooltip-body">
                    We calculate it as: weight x reps for every set.
                  </p>
                  <p className="analytics-tooltip-body">
                    Higher volume means more total workload.
                  </p>
                </div>
              )}
            </div>
            <div style={chartContainerStyle}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={chartLineMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="shortDate" interval="preserveStartEnd" minTickGap={28} tickMargin={10} height={36} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} stroke="var(--border)" />
                  <YAxis domain={[0, volumeAxisUpper]} width={50} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} stroke="var(--border)" />
                  <Tooltip
                    cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                    content={({ active, payload }: ChartTooltipProps) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const row = payload[0]?.payload;
                      if (!row) return null;
                      return (
                        <div className="analytics-tooltip-panel">
                          <p className="analytics-tooltip-title">{row.date}</p>
                          <p className="analytics-tooltip-body">
                            <span className="analytics-tooltip-label">Total Volume:</span>{' '}
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
                    stroke="var(--accent-blue)"
                    dot
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="analytics-frequency-note">
              Frequency: {frequencyPerWeek.toFixed(1)}x per week
            </p>
          </div>

          <div className="analytics-card">
            <h2 className="analytics-section-title">Recent Sessions</h2>
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Top Set</th>
                  <th>Total Volume</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={row.sessionId}>
                    <td>{row.date}</td>
                    <td>
                      {numberFormatter.format(row.topSetWeight)} x {row.topSetReps} @ RIR{' '}
                      {formatRir(row.topSetRir)}
                    </td>
                    <td>{numberFormatter.format(Math.round(row.totalVolume))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default Analytics;
