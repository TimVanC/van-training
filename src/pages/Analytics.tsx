import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getSession } from '../utils/auth';
import BottomNav from '../components/BottomNav';
import { MUSCLE_GROUPS, classifyExercise } from '../lib/muscles.js';

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

interface TopSetChartRow extends SessionAnalyticsRow {
  shortDate: string;
  topSetStrength: number;
  isPr: boolean;
}

interface DotRendererProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: TopSetChartRow;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: TopSetChartRow }>;
}

const numberFormatter = new Intl.NumberFormat('en-US');
const RANGE_OPTIONS: Array<{ value: DateRangeKey; label: string }> = [
  { value: '30D', label: '30D' },
  { value: '90D', label: '90D' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'ALL', label: 'All' },
];
const RECENT_KEY = 'analyticsRecentExercises';
const chartContainerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '100%',
  height: 'clamp(210px, 40vw, 280px)',
};
const chartMargin = { top: 8, right: 4, left: 4, bottom: 8 };

function formatDateLabel(dateValue: string): string {
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatRir(rir: number): string {
  return Number.isInteger(rir) ? String(rir) : rir.toFixed(1);
}

function formatCompact(value: number): string {
  if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
  return numberFormatter.format(Math.round(value));
}

function getRepDotRadius(reps: number): number {
  const safeReps = Number.isFinite(reps) ? reps : 0;
  return Math.max(4, Math.min(9, 3 + safeReps * 0.35));
}

function getTopSetStrength(weight: number, reps: number, rir: number): number {
  const safeWeight = Number.isFinite(weight) ? weight : 0;
  const safeReps = Number.isFinite(reps) ? reps : 0;
  const safeRir = Number.isFinite(rir) ? rir : 0;
  return safeWeight * (1 + (safeReps + safeRir) / 30);
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

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(exercise: string): string[] {
  const next = [exercise, ...loadRecent().filter((e) => e !== exercise)].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable (private mode) — recents just don't persist.
  }
  return next;
}

/** Exercise names bucketed by primary muscle group, in MUSCLE_GROUPS order. */
function groupExercises(names: string[]): Array<{ group: string; exercises: string[] }> {
  const buckets = new Map<string, string[]>();
  for (const name of names) {
    const group = classifyExercise(name)?.primary ?? 'Other';
    const list = buckets.get(group);
    if (list) list.push(name);
    else buckets.set(group, [name]);
  }
  const ordered: Array<{ group: string; exercises: string[] }> = [];
  for (const group of [...MUSCLE_GROUPS, 'Other']) {
    const list = buckets.get(group);
    if (list && list.length > 0) ordered.push({ group, exercises: list.sort() });
  }
  return ordered;
}

function ChartTooltipPanel({ children, title }: { children: React.ReactNode; title: string }): React.JSX.Element {
  return (
    <div className="analytics-tooltip-panel">
      <p className="analytics-tooltip-title">{title}</p>
      {children}
    </div>
  );
}

function Analytics(): React.JSX.Element {
  const [allExercises, setAllExercises] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [selectedExercise, setSelectedExercise] = useState('');
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const [sessions, setSessions] = useState<SessionAnalyticsRow[] | null>(null);
  const [repPrs, setRepPrs] = useState<RepPrEntry[]>([]);
  const [loadingExercises, setLoadingExercises] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [showStrengthInfo, setShowStrengthInfo] = useState(false);
  const [showVolumeInfo, setShowVolumeInfo] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeKey>('90D');

  const groupedExercises = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    const filtered = needle
      ? allExercises.filter((e) => e.toLowerCase().includes(needle))
      : allExercises;
    return groupExercises(filtered);
  }, [allExercises, searchText]);

  const recentAvailable = useMemo(
    () => recent.filter((e) => allExercises.includes(e)),
    [recent, allExercises],
  );

  const chartRows = useMemo(() => {
    const ordered = [...(sessions ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    let bestSoFar = Number.NEGATIVE_INFINITY;
    return ordered.map((session) => {
      const topSetStrength = getTopSetStrength(session.topSetWeight, session.topSetReps, session.topSetRir);
      const isPr = topSetStrength > bestSoFar;
      if (isPr) bestSoFar = topSetStrength;
      return { ...session, shortDate: formatDateLabel(session.date), topSetStrength, isPr };
    });
  }, [sessions]);

  const historyRows = useMemo(() => [...chartRows].reverse(), [chartRows]);

  const summary = useMemo(() => {
    if (chartRows.length === 0) return null;
    const current = chartRows[chartRows.length - 1];
    const previous = chartRows.length > 1 ? chartRows[chartRows.length - 2] : null;
    let delta: { text: string; direction: 'up' | 'down' | 'flat' } = { text: 'First session in range', direction: 'flat' };
    if (previous) {
      const weightDelta = current.topSetWeight - previous.topSetWeight;
      const repsDelta = current.topSetReps - previous.topSetReps;
      if (weightDelta !== 0) {
        delta = {
          text: `${weightDelta > 0 ? '+' : ''}${numberFormatter.format(weightDelta)} lbs vs last`,
          direction: weightDelta > 0 ? 'up' : 'down',
        };
      } else if (repsDelta !== 0) {
        delta = {
          text: `${repsDelta > 0 ? '+' : ''}${repsDelta} reps vs last`,
          direction: repsDelta > 0 ? 'up' : 'down',
        };
      } else {
        delta = { text: 'Matched last session', direction: 'flat' };
      }
    }
    return { current, previous, delta };
  }, [chartRows]);

  const frequencyPerWeek = useMemo(() => {
    const count = sessions?.length ?? 0;
    if (count === 0) return 0;
    return count / getRangeWeeks(dateRange, sessions ?? []);
  }, [dateRange, sessions]);

  const filteredRepPrs = useMemo(
    () =>
      [...repPrs]
        .filter((entry) => entry.weight > 0 && entry.maxReps > 0)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 9),
    [repPrs],
  );

  const topSetAxisUpper = useMemo(
    () => getAxisUpperBound(chartRows.length ? Math.max(...chartRows.map((r) => r.topSetStrength)) : 0),
    [chartRows],
  );
  const volumeAxisUpper = useMemo(
    () => getAxisUpperBound(chartRows.length ? Math.max(...chartRows.map((r) => r.totalVolume)) : 0),
    [chartRows],
  );

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
          { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} },
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
    setRecent(pushRecent(exercise));
    setShowStrengthInfo(false);
    setShowVolumeInfo(false);
    window.scrollTo({ top: 0 });
  }

  function handleBackToBrowse(): void {
    setSelectedExercise('');
    setSessions(null);
    setRepPrs([]);
  }

  // ---------------------------------------------------------------- browse
  function renderBrowse(): React.JSX.Element {
    return (
      <>
        <div className="analytics-search-wrap dash-animate">
          <input
            className="input-field analytics-search"
            type="text"
            placeholder={loadingExercises ? 'Loading your exercises...' : 'Search exercises'}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            disabled={loadingExercises}
            autoComplete="off"
            aria-label="Search exercises"
          />
          {searchText && (
            <button type="button" className="analytics-search-clear" aria-label="Clear search" onClick={() => setSearchText('')}>
              ×
            </button>
          )}
        </div>

        {loadingExercises && (
          <div className="exercise-chip-grid" aria-hidden>
            {[90, 130, 70, 110, 80, 120, 100, 60].map((w, i) => (
              <div key={i} className="skel skel-pill" style={{ width: w, height: '2.1rem' }} />
            ))}
          </div>
        )}

        {!loadingExercises && recentAvailable.length > 0 && !searchText && (
          <section className="analytics-browse-section dash-animate">
            <h2 className="dash-section-title">Recent</h2>
            <div className="exercise-chip-grid">
              {recentAvailable.map((exercise) => (
                <button key={exercise} type="button" className="exercise-chip exercise-chip--recent" onClick={() => handleSelectExercise(exercise)}>
                  {exercise}
                </button>
              ))}
            </div>
          </section>
        )}

        {!loadingExercises &&
          groupedExercises.map(({ group, exercises }, i) => (
            <section key={group} className="analytics-browse-section dash-animate" style={{ animationDelay: `${i * 40}ms` }}>
              <h2 className="dash-section-title">{group}</h2>
              <div className="exercise-chip-grid">
                {exercises.map((exercise) => (
                  <button key={exercise} type="button" className="exercise-chip" onClick={() => handleSelectExercise(exercise)}>
                    {exercise}
                  </button>
                ))}
              </div>
            </section>
          ))}

        {!loadingExercises && groupedExercises.length === 0 && (
          <p className="analytics-empty-state">
            {allExercises.length === 0 ? 'Log a few workouts and your exercises will show up here.' : 'No exercises match that search.'}
          </p>
        )}
      </>
    );
  }

  // -------------------------------------------------------------- detail
  function renderDetail(): React.JSX.Element {
    return (
      <>
        <div className="analytics-detail-head dash-animate">
          <button type="button" className="analytics-back" onClick={handleBackToBrowse} aria-label="Back to all exercises">
            ←
          </button>
          <h2 className="analytics-exercise-name">{selectedExercise}</h2>
        </div>

        <div className="analytics-range-pills dash-animate">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`range-pill ${dateRange === option.value ? 'range-pill--active' : ''}`}
              onClick={() => setDateRange(option.value)}
              disabled={loadingAnalytics}
            >
              {option.label}
            </button>
          ))}
        </div>

        {loadingAnalytics && (
          <>
            <div className="dash-card skel-card" aria-hidden>
              <div className="skel skel-line" style={{ width: '40%', height: '0.75rem' }} />
              <div className="skel skel-line" style={{ width: '55%', height: '2rem', margin: '0.5rem 0' }} />
              <div className="skel skel-line" style={{ width: '70%', height: '0.8rem' }} />
            </div>
            {[0, 1].map((i) => (
              <div key={i} className="dash-card skel-card" aria-hidden>
                <div className="skel skel-line" style={{ width: '35%', height: '0.9rem', marginBottom: '0.7rem' }} />
                <div className="skel skel-block" style={{ height: '200px' }} />
              </div>
            ))}
          </>
        )}

        {!loadingAnalytics && sessions !== null && sessions.length === 0 && (
          <p className="analytics-empty-state">No sessions for {selectedExercise} in this range — try a longer one.</p>
        )}

        {!loadingAnalytics && sessions !== null && sessions.length > 0 && summary && (
          <>
            {/* --- Hero: current top set --------------------------------- */}
            <section className="dash-card analytics-hero dash-animate">
              <p className="dash-hero-kicker">Current top set</p>
              <div className="analytics-hero-main">
                <span className="analytics-hero-set">
                  {numberFormatter.format(summary.current.topSetWeight)}
                  <span className="analytics-hero-x"> × </span>
                  {summary.current.topSetReps}
                </span>
                <span className={`delta-chip delta-chip--${summary.delta.direction}`}>
                  {summary.delta.direction === 'up' ? '▲ ' : summary.delta.direction === 'down' ? '▼ ' : ''}
                  {summary.delta.text}
                </span>
              </div>
              <div className="analytics-hero-stats">
                <div className="analytics-hero-stat">
                  <span className="analytics-hero-stat-value">{formatCompact(summary.current.topSetStrength)}</span>
                  <span className="analytics-hero-stat-label">strength score</span>
                </div>
                <div className="analytics-hero-stat">
                  <span className="analytics-hero-stat-value">{frequencyPerWeek.toFixed(1)}×</span>
                  <span className="analytics-hero-stat-label">per week</span>
                </div>
                <div className="analytics-hero-stat">
                  <span className="analytics-hero-stat-value">{sessions.length}</span>
                  <span className="analytics-hero-stat-label">sessions in range</span>
                </div>
              </div>
            </section>

            {/* --- Strength chart ---------------------------------------- */}
            <section className="dash-card dash-animate" style={{ animationDelay: '60ms' }}>
              <div className="analytics-chart-header">
                <h2 className="analytics-section-title">Strength</h2>
                <button
                  type="button"
                  className="dash-info-button"
                  aria-label="What is the strength score?"
                  aria-expanded={showStrengthInfo}
                  onClick={() => setShowStrengthInfo((v) => !v)}
                >
                  i
                </button>
              </div>
              {showStrengthInfo && (
                <div className="dash-info-panel analytics-info-panel">
                  <p className="analytics-tooltip-body">
                    Your best set each session, converted to one comparable number — more reps (or reps
                    left in the tank) at the same weight scores higher. 90 × 10 beats 90 × 8.
                  </p>
                  <p className="analytics-tooltip-body">Green rings mark all-time bests. Bigger dots = more reps.</p>
                </div>
              )}
              <div style={chartContainerStyle}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartRows} margin={chartMargin}>
                    <defs>
                      <linearGradient id="strengthFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="shortDate"
                      interval="preserveStartEnd"
                      minTickGap={28}
                      tickMargin={8}
                      height={30}
                      tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                      stroke="var(--border)"
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, topSetAxisUpper]}
                      width={42}
                      tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                      stroke="transparent"
                      tickLine={false}
                      tickFormatter={(v: number) => formatCompact(v)}
                    />
                    <Tooltip
                      cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                      content={({ active, payload }: ChartTooltipProps) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const row = payload[0]?.payload;
                        if (!row) return null;
                        return (
                          <ChartTooltipPanel title={formatDateLabel(row.date)}>
                            <p className="analytics-tooltip-body">
                              <span className="analytics-tooltip-label">Top set:</span>{' '}
                              {numberFormatter.format(row.topSetWeight)} × {row.topSetReps}{' '}
                              <span className="analytics-tooltip-label">@ RIR</span> {formatRir(row.topSetRir)}
                            </p>
                            <p className="analytics-tooltip-body">
                              <span className="analytics-tooltip-label">Score:</span>{' '}
                              {numberFormatter.format(Number(row.topSetStrength.toFixed(1)))}
                            </p>
                            {row.isPr && <p className="analytics-tooltip-body analytics-tooltip-pr">★ New personal best</p>}
                          </ChartTooltipPanel>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="topSetStrength"
                      name="Strength"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      fill="url(#strengthFill)"
                      dot={(props: DotRendererProps) => {
                        if (props.cx == null || props.cy == null || !props.payload) return <g key={`dot-${props.index ?? 'x'}`} />;
                        const isPr = props.payload.isPr;
                        return (
                          <circle
                            key={props.payload.sessionId}
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
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* --- Rep PRs ------------------------------------------------ */}
            {filteredRepPrs.length > 0 && (
              <section className="dash-card dash-animate" style={{ animationDelay: '90ms' }}>
                <h2 className="analytics-section-title">Rep PRs by Weight</h2>
                <div className="rep-pr-grid">
                  {filteredRepPrs.map((entry) => (
                    <div key={`${entry.weight}-${entry.maxReps}`} className="rep-pr-tile">
                      <span className="rep-pr-weight">{numberFormatter.format(entry.weight)}</span>
                      <span className="rep-pr-label">lbs</span>
                      <span className="rep-pr-reps">× {entry.maxReps}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* --- Volume chart ------------------------------------------- */}
            <section className="dash-card dash-animate" style={{ animationDelay: '120ms' }}>
              <div className="analytics-chart-header">
                <h2 className="analytics-section-title">Volume</h2>
                <button
                  type="button"
                  className="dash-info-button"
                  aria-label="What is volume?"
                  aria-expanded={showVolumeInfo}
                  onClick={() => setShowVolumeInfo((v) => !v)}
                >
                  i
                </button>
              </div>
              {showVolumeInfo && (
                <div className="dash-info-panel analytics-info-panel">
                  <p className="analytics-tooltip-body">
                    Total workload per session for this exercise: weight × reps summed across every set.
                  </p>
                </div>
              )}
              <div style={chartContainerStyle}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartRows} margin={chartMargin}>
                    <defs>
                      <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="shortDate"
                      interval="preserveStartEnd"
                      minTickGap={28}
                      tickMargin={8}
                      height={30}
                      tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                      stroke="var(--border)"
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, volumeAxisUpper]}
                      width={42}
                      tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                      stroke="transparent"
                      tickLine={false}
                      tickFormatter={(v: number) => formatCompact(v)}
                    />
                    <Tooltip
                      cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                      content={({ active, payload }: ChartTooltipProps) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const row = payload[0]?.payload;
                        if (!row) return null;
                        return (
                          <ChartTooltipPanel title={formatDateLabel(row.date)}>
                            <p className="analytics-tooltip-body">
                              <span className="analytics-tooltip-label">Volume:</span>{' '}
                              {numberFormatter.format(Math.round(row.totalVolume))} lbs
                            </p>
                          </ChartTooltipPanel>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="totalVolume"
                      name="Volume"
                      stroke="var(--accent-blue)"
                      strokeWidth={2}
                      fill="url(#volumeFill)"
                      dot={{ r: 3, fill: 'var(--accent-blue)', stroke: 'var(--bg-primary)', strokeWidth: 1.5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* --- Session history ---------------------------------------- */}
            <section className="dash-card dash-animate" style={{ animationDelay: '150ms' }}>
              <h2 className="analytics-section-title">Sessions</h2>
              <div className="session-history-list">
                {historyRows.map((row) => (
                  <div key={row.sessionId} className="session-history-row">
                    <div className="session-history-date">
                      {formatDateLabel(row.date)}
                      {row.isPr && <span className="session-history-pr" title="Personal best">★</span>}
                    </div>
                    <div className="session-history-set">
                      {numberFormatter.format(row.topSetWeight)} × {row.topSetReps}
                      <span className="session-history-rir"> @ RIR {formatRir(row.topSetRir)}</span>
                    </div>
                    <div className="session-history-volume">{formatCompact(row.totalVolume)} lbs</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </>
    );
  }

  return (
    <div className="page page--with-nav dash-page">
      <div className="dash-header">
        <h1>Analytics</h1>
        <p className="dash-date">
          {selectedExercise ? 'Exercise progression' : 'Pick an exercise to see its story'}
        </p>
      </div>
      {selectedExercise ? renderDetail() : renderBrowse()}
      <BottomNav />
    </div>
  );
}

export default Analytics;
