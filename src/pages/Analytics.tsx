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
    () =>
      (sessions ?? []).map((session) => ({
        ...session,
        shortDate: formatDateLabel(session.date),
        topSetStrength: session.topSetWeight * (1 + session.topSetReps / 30),
      })),
    [sessions],
  );

  const tableRows = useMemo(() => [...(sessions ?? [])].reverse(), [sessions]);
  const topSetSummary = useMemo(() => getTopSetSummary(sessions ?? []), [sessions]);

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
          <div style={{ width: '100%', maxWidth: 560, height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="shortDate" />
                <YAxis />
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
                    return (
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={getRepDotRadius(props.payload.topSetReps)}
                        fill="#8884d8"
                        stroke="#ffffff"
                        strokeWidth={1.5}
                      />
                    );
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <h2>Rep PR Tracking</h2>
          <ul style={{ marginTop: 0, paddingLeft: '1.25rem' }}>
            {repPrs.map((entry) => (
              <li key={`${entry.weight}-${entry.maxReps}`}>
                {numberFormatter.format(entry.weight)} lbs: {entry.maxReps} reps
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
          <div style={{ width: '100%', maxWidth: 560, height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="shortDate" />
                <YAxis />
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
