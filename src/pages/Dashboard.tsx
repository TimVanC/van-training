import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useDashboardData } from '../hooks/useDashboardData';
import type {
  DashboardMuscleGroup,
  DashboardResponse,
  DashboardSession,
} from '../types/dashboard';
import type { TrendVerdict } from '../lib/analysis';

const numberFormatter = new Intl.NumberFormat('en-US');

const VERDICT_META: Record<TrendVerdict, { label: string; className: string }> = {
  progressing: { label: 'Progressing', className: 'verdict--progressing' },
  steady: { label: 'Steady', className: 'verdict--steady' },
  plateaued: { label: 'Plateaued', className: 'verdict--plateaued' },
  regressing: { label: 'Regressing', className: 'verdict--regressing' },
  insufficient: { label: 'Needs data', className: 'verdict--insufficient' },
};

function formatVolume(volume: number): string {
  if (volume >= 10000) return `${(volume / 1000).toFixed(1)}k`;
  return numberFormatter.format(volume);
}

function daysAgoLabel(iso: string | undefined): string {
  if (!iso) return 'Not trained yet';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Not trained yet';
  const days = Math.floor((Date.now() - then.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

/** Animated SVG line for a series of values; draws itself in on mount. */
function Sparkline({ values, className }: { values: number[]; className?: string }): React.JSX.Element | null {
  if (values.length < 2) return null;
  const w = 120;
  const h = 34;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      className={`sparkline ${className ?? ''}`}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-hidden
    >
      <polyline className="sparkline-path" points={points.join(' ')} fill="none" />
    </svg>
  );
}

/** Weekly working-set bars that grow in on mount. */
function WeeklySetBars({ weeks }: { weeks: Array<{ weekStart: string; sets: number }> }): React.JSX.Element {
  const max = Math.max(1, ...weeks.map((w) => w.sets));
  return (
    <div className="week-bars" aria-hidden>
      {weeks.map((w, i) => (
        <div
          key={w.weekStart}
          className="week-bar"
          style={{
            height: `${Math.max(6, (w.sets / max) * 100)}%`,
            animationDelay: `${i * 45}ms`,
          }}
          title={`${w.weekStart}: ${w.sets} sets`}
        />
      ))}
    </div>
  );
}

function TrendArrow({ pct }: { pct: number }): React.JSX.Element {
  const symbol = pct > 0.15 ? '▲' : pct < -0.15 ? '▼' : '—';
  const cls = pct > 0.15 ? 'trend-up' : pct < -0.15 ? 'trend-down' : 'trend-flat';
  return <span className={`trend-arrow ${cls}`}>{symbol}</span>;
}

function MuscleGroupCard({
  group,
  delayMs,
}: {
  group: DashboardMuscleGroup;
  delayMs: number;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const meta = VERDICT_META[group.verdict];
  const recentSets = group.weeklySets.slice(-1)[0]?.sets ?? 0;

  return (
    <div
      className={`muscle-card dash-animate ${expanded ? 'muscle-card--expanded' : ''}`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <button type="button" className="muscle-card-head" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <div className="muscle-card-title-row">
          <span className="muscle-card-name">{group.name}</span>
          <span className={`verdict-badge ${meta.className}`}>{meta.label}</span>
        </div>
        <div className="muscle-card-body-row">
          <div className="muscle-card-stats">
            <span className="muscle-card-slope">
              <TrendArrow pct={group.slopePctPerWeek} />
              {group.verdict === 'insufficient' ? '' : ` ${Math.abs(group.slopePctPerWeek).toFixed(1)}%/wk`}
            </span>
            <span className="muscle-card-sets">{recentSets} sets this week</span>
          </div>
          <WeeklySetBars weeks={group.weeklySets} />
        </div>
      </button>
      {expanded && (
        <div className="muscle-card-detail">
          {group.exercises.length === 0 ? (
            <p className="muscle-card-empty">No lifts logged recently for this group.</p>
          ) : (
            group.exercises.map((exercise) => (
              <div key={exercise.name} className="muscle-exercise-row">
                <div className="muscle-exercise-info">
                  <span className="muscle-exercise-name">{exercise.name}</span>
                  <span className="muscle-exercise-top">
                    Last: {numberFormatter.format(exercise.lastTop.weight)} x {exercise.lastTop.reps}
                    {' · '}
                    <TrendArrow pct={exercise.slopePctPerWeek} /> {Math.abs(exercise.slopePctPerWeek).toFixed(1)}%/wk
                  </span>
                </div>
                <Sparkline values={exercise.series.map((p) => p.e1rm)} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Last-4-weeks activity strip for a quick calendar feel on the homepage. */
function RecentActivityStrip({ sessions }: { sessions: DashboardSession[] }): React.JSX.Element {
  const cells = useMemo(() => {
    const byDate = new Map<string, DashboardSession[]>();
    for (const s of sessions) {
      const d = s.date.slice(0, 10);
      const list = byDate.get(d);
      if (list) list.push(s);
      else byDate.set(d, [s]);
    }
    const out: Array<{ date: string; trained: boolean; label: string }> = [];
    const today = new Date();
    for (let i = 27; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      const daySessions = byDate.get(key) ?? [];
      out.push({
        date: key,
        trained: daySessions.length > 0,
        label: daySessions.map((s) => s.dayName).join(', '),
      });
    }
    return out;
  }, [sessions]);

  return (
    <div className="activity-strip" aria-label="Last 4 weeks of training">
      {cells.map((cell, i) => (
        <span
          key={cell.date}
          className={`activity-cell ${cell.trained ? 'activity-cell--trained' : ''}`}
          style={{ animationDelay: `${i * 12}ms` }}
          title={cell.trained ? `${cell.date}: ${cell.label}` : cell.date}
        />
      ))}
    </div>
  );
}

function Dashboard(): React.JSX.Element {
  const navigate = useNavigate();
  const { data, loading, error } = useDashboardData();

  const nextDay = data?.rotation?.nextDayName ?? null;
  const nextDayLastTrained = useMemo(() => {
    if (!data?.rotation || !nextDay) return undefined;
    return data.rotation.days.find((d) => d.name === nextDay)?.lastTrained;
  }, [data, nextDay]);

  const orderedMuscles = useMemo(() => {
    if (!data) return [];
    // Most-trained groups first so the important cards are on top.
    return [...data.muscleGroups].sort((a, b) => {
      const setsA = a.weeklySets.reduce((s, w) => s + w.sets, 0);
      const setsB = b.weeklySets.reduce((s, w) => s + w.sets, 0);
      return setsB - setsA;
    });
  }, [data]);

  function renderBody(d: DashboardResponse): React.JSX.Element {
    const { weekStats, checkinSummary } = d;
    const volumeDeltaPct =
      weekStats.volumeLastWeek > 0
        ? Math.round(((weekStats.volumeThisWeek - weekStats.volumeLastWeek) / weekStats.volumeLastWeek) * 100)
        : null;

    return (
      <>
        {/* --- Next workout hero ------------------------------------------ */}
        {d.rotation && nextDay && (
          <section className="dash-card dash-hero dash-animate">
            <p className="dash-hero-kicker">Up next in {d.rotation.splitName}</p>
            <h2 className="dash-hero-day">{nextDay}</h2>
            <p className="dash-hero-sub">Last trained: {daysAgoLabel(nextDayLastTrained)}</p>
            <button
              type="button"
              className="nav-button nav-button--finish-ready dash-hero-start"
              onClick={() => navigate(`/lift/${encodeURIComponent(d.rotation!.splitName)}`)}
            >
              Start Workout
            </button>
          </section>
        )}

        {/* --- Week stats -------------------------------------------------- */}
        <section className="dash-stat-grid dash-animate" style={{ animationDelay: '60ms' }}>
          <div className="dash-stat">
            <span className="dash-stat-value">{weekStats.sessionsThisWeek}</span>
            <span className="dash-stat-label">workouts this week</span>
            <span className="dash-stat-sub">{weekStats.sessionsLastWeek} last week</span>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-value">{formatVolume(weekStats.volumeThisWeek)}</span>
            <span className="dash-stat-label">lbs moved this week</span>
            <span className="dash-stat-sub">
              {volumeDeltaPct == null ? ' ' : `${volumeDeltaPct >= 0 ? '+' : ''}${volumeDeltaPct}% vs last week`}
            </span>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-value">{weekStats.weekStreak}</span>
            <span className="dash-stat-label">week streak</span>
            <span className="dash-stat-sub">{weekStats.totalSessions} total workouts</span>
          </div>
        </section>

        {/* --- Muscle group report ---------------------------------------- */}
        <section className="dash-section">
          <h2 className="dash-section-title dash-animate" style={{ animationDelay: '100ms' }}>
            Muscle Groups
          </h2>
          <div className="muscle-grid">
            {orderedMuscles.map((group, i) => (
              <MuscleGroupCard key={group.name} group={group} delayMs={120 + i * 55} />
            ))}
          </div>
        </section>

        {/* --- Insights ---------------------------------------------------- */}
        {(d.insights.length > 0 || checkinSummary.count30d > 0) && (
          <section className="dash-section">
            <h2 className="dash-section-title dash-animate">Insights</h2>
            {d.insights.map((insight, i) => (
              <div key={insight.kind} className="dash-card insight-card dash-animate" style={{ animationDelay: `${i * 70}ms` }}>
                <p className="insight-title">{insight.title}</p>
                <p className="insight-detail">{insight.detail}</p>
              </div>
            ))}
            {checkinSummary.count30d > 0 && (
              <div className="dash-card dash-animate" style={{ animationDelay: `${d.insights.length * 70}ms` }}>
                <p className="insight-title">Last 30 days check-ins ({checkinSummary.count30d})</p>
                <div className="wellness-grid">
                  {checkinSummary.avgFeel != null && (
                    <div className="wellness-tile"><span>{checkinSummary.avgFeel}</span><label>feel</label></div>
                  )}
                  {checkinSummary.avgEffort != null && (
                    <div className="wellness-tile"><span>{checkinSummary.avgEffort}</span><label>effort</label></div>
                  )}
                  {checkinSummary.avgSleep != null && (
                    <div className="wellness-tile"><span>{checkinSummary.avgSleep}</span><label>sleep</label></div>
                  )}
                  {checkinSummary.avgSoreness != null && (
                    <div className="wellness-tile"><span>{checkinSummary.avgSoreness}</span><label>soreness</label></div>
                  )}
                  {checkinSummary.avgDiet != null && (
                    <div className="wellness-tile"><span>{checkinSummary.avgDiet}</span><label>diet</label></div>
                  )}
                  {checkinSummary.preworkoutRate != null && (
                    <div className="wellness-tile"><span>{checkinSummary.preworkoutRate}%</span><label>pre-wo</label></div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* --- Recent PRs -------------------------------------------------- */}
        {d.prs.length > 0 && (
          <section className="dash-section">
            <h2 className="dash-section-title dash-animate">Recent PRs</h2>
            <div className="dash-card dash-animate">
              {d.prs.map((pr) => (
                <div key={`${pr.exerciseName}-${pr.date}`} className="pr-row">
                  <span className="pr-trophy" aria-hidden>🏆</span>
                  <div className="pr-info">
                    <span className="pr-name">{pr.exerciseName}</span>
                    <span className="pr-detail">
                      {numberFormatter.format(pr.weight)} x {pr.reps} · {pr.date}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* --- 4-week strip ------------------------------------------------ */}
        <section className="dash-section">
          <button type="button" className="dash-card dash-strip-card dash-animate" onClick={() => navigate('/calendar')}>
            <div className="dash-strip-head">
              <h2 className="dash-section-title">Last 4 weeks</h2>
              <span className="dash-strip-link">Full calendar →</span>
            </div>
            <RecentActivityStrip sessions={d.sessions} />
          </button>
        </section>
      </>
    );
  }

  return (
    <div className="page page--with-nav dash-page">
      <div className="dash-header">
        <h1>Van Training</h1>
        <p className="dash-date">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>
      {loading && <p className="analytics-empty-state">Loading your training data...</p>}
      {!loading && error && <p className="analytics-empty-state">Couldn't load dashboard. Pull to refresh or try again later.</p>}
      {!loading && data && renderBody(data)}
      <BottomNav />
    </div>
  );
}

export default Dashboard;
