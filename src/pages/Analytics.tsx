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

const tableCellStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  textAlign: 'left',
};

const numberFormatter = new Intl.NumberFormat('en-US');

function formatDateLabel(dateValue: string): string {
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatRir(rir: number): string {
  return Number.isInteger(rir) ? String(rir) : rir.toFixed(1);
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
      })),
    [sessions],
  );

  const tableRows = useMemo(() => [...(sessions ?? [])].reverse(), [sessions]);

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
          `/api/getExerciseHistory?exercise_name=${encodeURIComponent(selectedExercise)}`,
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
  }, [selectedExercise]);

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

      {!selectedExercise && <p>Select an exercise to view progression.</p>}
      {loadingAnalytics && <p>Loading...</p>}
      {!loadingAnalytics && selectedExercise && sessions !== null && sessions.length === 0 && (
        <p>No data found</p>
      )}
      {!loadingAnalytics && sessions !== null && sessions.length > 0 && (
        <>
          <h2>Top Set Progression</h2>
          <div style={{ width: '100%', maxWidth: 560, height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="shortDate" />
                <YAxis />
                <Tooltip
                  formatter={(value) => [`${numberFormatter.format(Number(value))} lbs`, 'Weight']}
                  labelFormatter={(_label, payload) => {
                    const row = payload?.[0]?.payload as SessionAnalyticsRow | undefined;
                    if (!row) return '';
                    return `${row.date} | ${row.topSetReps} reps @ RIR ${formatRir(row.topSetRir)}`;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="topSetWeight"
                  name="Top Set Weight"
                  stroke="#8884d8"
                  dot
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

          <h2>Volume Trend</h2>
          <div style={{ width: '100%', maxWidth: 560, height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="shortDate" />
                <YAxis />
                <Tooltip
                  formatter={(value) => [numberFormatter.format(Number(value)), 'Total Volume']}
                  labelFormatter={(_label, payload) =>
                    String((payload?.[0]?.payload as SessionAnalyticsRow | undefined)?.date ?? '')
                  }
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
