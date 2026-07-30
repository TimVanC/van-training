import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useDashboardData } from '../hooks/useDashboardData';
import type {
  DashboardMuscleGroup,
  DashboardResponse,
  DashboardSession,
} from '../types/dashboard';
import { verdictExplanation, type TrendVerdict } from '../lib/analysis.js';
import { funComparisonLabel } from '../data/weightComparisons';

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
  // Compare calendar days at LOCAL midnight, not elapsed 24h windows, so an
  // evening workout logged yesterday doesn't read as "Today".
  const now = new Date();
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
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
          <p className={`muscle-card-blurb ${VERDICT_META[group.verdict].className}`}>
            {verdictExplanation(group)}
          </p>
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

const MINI_WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayKind(dayName: string): string {
  const n = dayName.toLowerCase();
  if (n.includes('push')) return 'push';
  if (n.includes('pull')) return 'pull';
  if (n.includes('leg')) return 'legs';
  if (n.includes('core')) return 'core';
  return 'other';
}

interface MiniCalCell {
  key: string;
  day: number;
  trained: boolean;
  kind: string;
  isToday: boolean;
  isFuture: boolean;
  label: string;
}

/** Compact month-style calendar (last 5 weeks) for the homepage. */
function MiniCalendar({ sessions }: { sessions: DashboardSession[] }): React.JSX.Element {
  const { weeks, rangeLabel } = useMemo(() => {
    const byDate = new Map<string, DashboardSession[]>();
    for (const s of sessions) {
      // Bucket by LOCAL calendar date to match the grid cells (which are keyed
      // by local date); slicing the ISO string would use UTC and misplace
      // evening workouts by a day.
      const d = localDateKey(new Date(s.date));
      const list = byDate.get(d);
      if (list) list.push(s);
      else byDate.set(d, [s]);
    }

    const today = new Date();
    const todayKey = localDateKey(today);
    // Sunday of the current week, then back 4 weeks -> 5 aligned week rows.
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() - 7 * 4);

    const rows: MiniCalCell[][] = [];
    const cursor = new Date(start);
    for (let w = 0; w < 5; w++) {
      const row: MiniCalCell[] = [];
      for (let d = 0; d < 7; d++) {
        const key = localDateKey(cursor);
        const daySessions = byDate.get(key) ?? [];
        row.push({
          key,
          day: cursor.getDate(),
          trained: daySessions.length > 0,
          kind: daySessions[0] ? dayKind(daySessions[0].dayName) : 'other',
          isToday: key === todayKey,
          isFuture: cursor > today && key !== todayKey,
          label: daySessions.map((s) => s.dayName).join(', '),
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      rows.push(row);
    }

    const end = new Date(today);
    const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
    const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
    const label =
      startMonth === endMonth
        ? `${endMonth} ${end.getFullYear()}`
        : `${startMonth} – ${endMonth} ${end.getFullYear()}`;

    return { weeks: rows, rangeLabel: label };
  }, [sessions]);

  return (
    <div className="mini-cal" aria-label="Recent training calendar">
      <div className="mini-cal-head">
        <span className="mini-cal-range">{rangeLabel}</span>
      </div>
      <div className="mini-cal-grid">
        {MINI_WEEKDAYS.map((label, i) => (
          <span key={`wd-${i}`} className="mini-cal-weekday">{label}</span>
        ))}
      </div>
      <div className="mini-cal-grid">
        {weeks.flat().map((cell, i) => (
          <div
            key={cell.key}
            className={[
              'mini-cal-day',
              cell.trained ? `mini-cal-day--trained mini-cal-day--${cell.kind}` : '',
              cell.isToday ? 'mini-cal-day--today' : '',
              cell.isFuture ? 'mini-cal-day--future' : '',
            ].join(' ')}
            style={{ animationDelay: `${i * 9}ms` }}
            title={cell.trained ? `${cell.key}: ${cell.label}` : cell.key}
          >
            {cell.day}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Placeholder layout shown while dashboard data loads; mirrors the real page structure. */
function DashboardSkeleton(): React.JSX.Element {
  return (
    <>
      <section className="dash-card dash-hero skel-card" aria-hidden>
        <div className="skel skel-line" style={{ width: '38%', height: '0.75rem' }} />
        <div className="skel skel-line" style={{ width: '55%', height: '1.9rem', margin: '0.35rem 0' }} />
        <div className="skel skel-line" style={{ width: '45%', height: '0.8rem', marginBottom: '0.85rem' }} />
        <div className="skel skel-block" style={{ height: '48px' }} />
      </section>

      <section className="dash-stat-grid" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="dash-stat">
            <div className="skel skel-line" style={{ width: '2.2rem', height: '1.5rem' }} />
            <div className="skel skel-line" style={{ width: '80%', height: '0.6rem', marginTop: '0.3rem' }} />
            <div className="skel skel-line" style={{ width: '60%', height: '0.55rem', marginTop: '0.2rem' }} />
          </div>
        ))}
      </section>

      <section className="dash-section" aria-hidden>
        <div className="skel skel-line" style={{ width: '9rem', height: '0.95rem', margin: '0 0 0.6rem' }} />
        <div className="muscle-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="muscle-card skel-card" style={{ padding: '0.8rem 1rem' }}>
              <div className="muscle-card-title-row">
                <div className="skel skel-line" style={{ width: '30%', height: '1.05rem' }} />
                <div className="skel skel-pill" style={{ width: '5.5rem', height: '1.2rem' }} />
              </div>
              <div className="muscle-card-body-row">
                <div className="muscle-card-stats">
                  <div className="skel skel-line" style={{ width: '4.5rem', height: '0.85rem' }} />
                  <div className="skel skel-line" style={{ width: '6rem', height: '0.7rem', marginTop: '0.2rem' }} />
                </div>
                <div className="skel skel-block" style={{ width: '96px', height: '30px' }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="dash-section" aria-hidden>
        <div className="skel skel-line" style={{ width: '6rem', height: '0.95rem', margin: '0 0 0.6rem' }} />
        <div className="dash-card skel-card">
          <div className="skel skel-block" style={{ height: '180px' }} />
        </div>
      </section>
    </>
  );
}

function Dashboard(): React.JSX.Element {
  const navigate = useNavigate();
  const { data, loading, error, retry } = useDashboardData();
  const [showMuscleInfo, setShowMuscleInfo] = useState(false);

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
    // Compare against the same elapsed portion of last week (Mon → this
    // weekday), not the full week — a Thursday shouldn't lose to a Sunday.
    // Fall back to the full week for API responses that predate the field.
    const lastWeekBaseline = weekStats.volumeLastWeekToDate ?? weekStats.volumeLastWeek;
    const volumeDeltaPct =
      lastWeekBaseline > 0
        ? Math.round(((weekStats.volumeThisWeek - lastWeekBaseline) / lastWeekBaseline) * 100)
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
            {(d.otherRotations ?? []).map((other) => (
              <button
                key={other.splitName}
                type="button"
                className="dash-hero-alt-link"
                onClick={() => navigate(`/lift/${encodeURIComponent(other.splitName)}`)}
              >
                Train {other.splitName} instead
                {other.nextDayName ? ` · ${other.nextDayName} is up` : ''} →
              </button>
            ))}
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
              {volumeDeltaPct == null ? ' ' : `${volumeDeltaPct >= 0 ? '+' : ''}${volumeDeltaPct}% vs same point last wk`}
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
          <div className="dash-section-head dash-animate" style={{ animationDelay: '100ms' }}>
            <h2 className="dash-section-title">Muscle Groups</h2>
            <button
              type="button"
              className="dash-info-button"
              aria-label="What do the muscle group cards show?"
              aria-expanded={showMuscleInfo}
              onClick={() => setShowMuscleInfo((v) => !v)}
            >
              i
            </button>
            <button type="button" className="dash-section-link" onClick={() => navigate('/muscles')}>
              Muscle Lab →
            </button>
          </div>
          {showMuscleInfo && (
            <div className="dash-card dash-info-panel dash-animate">
              <p className="dash-info-lead">
                Each card scores one muscle group by how your strength on its exercises is trending,
                using your best estimated one-rep max per session.
              </p>
              <ul className="dash-info-list">
                <li><strong>Verdict</strong> — Progressing (gaining), Steady (holding), Plateaued
                  (flat for 3+ weeks), Regressing (losing), or Needs data (fewer than 3 sessions).</li>
                <li><strong>%/wk</strong> — average weekly change in estimated strength across the
                  group's exercises. The arrow shows direction.</li>
                <li><strong>Sets this week</strong> and the bars — your working sets per week for the
                  last 8 weeks, so you can see if volume is climbing or dropping.</li>
                <li><strong>Tap a card</strong> to expand each exercise's last top set and a trend
                  line of its estimated strength over time.</li>
              </ul>
            </div>
          )}
          <div className="muscle-grid">
            {orderedMuscles.map((group, i) => (
              <MuscleGroupCard key={group.name} group={group} delayMs={120 + i * 55} />
            ))}
          </div>
        </section>

        {/* --- Weight moved comparisons ----------------------------------- */}
        {(() => {
          const now = new Date();
          // Local Monday of the week containing the given date.
          const weekStartOf = (dt: Date): Date => {
            const day = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
            day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
            return day;
          };
          const volumeByMonth = new Map<string, { volume: number; start: Date }>();
          const volumeByWeek = new Map<string, { volume: number; start: Date }>();
          let monthVolume = 0;
          let allTimeVolume = 0;
          for (const s of d.sessions) {
            const dt = new Date(s.date);
            if (Number.isNaN(dt.getTime())) continue;
            allTimeVolume += s.totalVolume;
            if (dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth()) {
              monthVolume += s.totalVolume;
            }
            const monthStart = new Date(dt.getFullYear(), dt.getMonth(), 1);
            const monthKey = monthStart.toISOString();
            const m = volumeByMonth.get(monthKey);
            if (m) m.volume += s.totalVolume;
            else volumeByMonth.set(monthKey, { volume: s.totalVolume, start: monthStart });
            const weekStart = weekStartOf(dt);
            const weekKey = weekStart.toISOString();
            const w = volumeByWeek.get(weekKey);
            if (w) w.volume += s.totalVolume;
            else volumeByWeek.set(weekKey, { volume: s.totalVolume, start: weekStart });
          }
          const best = (buckets: Map<string, { volume: number; start: Date }>) =>
            [...buckets.values()].reduce<{ volume: number; start: Date } | null>(
              (top, b) => (top === null || b.volume > top.volume ? b : top),
              null,
            );
          const bestWeek = best(volumeByWeek);
          const bestMonth = best(volumeByMonth);
          const rows = [
            { label: 'This week', when: '', volume: weekStats.volumeThisWeek },
            bestWeek && {
              label: 'Best week',
              when: `wk of ${bestWeek.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
              volume: bestWeek.volume,
            },
            { label: 'This month', when: '', volume: monthVolume },
            bestMonth && {
              label: 'Best month',
              when: bestMonth.start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
              volume: bestMonth.volume,
            },
            { label: 'All time', when: '', volume: allTimeVolume },
          ]
            .filter((r): r is { label: string; when: string; volume: number } => Boolean(r))
            .map((r) => ({ ...r, fun: funComparisonLabel(r.volume) }))
            .filter((r) => r.volume > 0 && r.fun);
          if (rows.length === 0) return null;
          return (
            <section className="dash-section">
              <h2 className="dash-section-title dash-animate">Weight Moved</h2>
              <div className="dash-card weight-moved-card dash-animate">
                {rows.map((r) => (
                  <div key={r.label} className="weight-moved-row">
                    <span className="weight-moved-label">
                      {r.label}
                      {r.when && <span className="weight-moved-when"> · {r.when}</span>}
                    </span>
                    <span className="weight-moved-lbs">{numberFormatter.format(Math.round(r.volume))} lbs</span>
                    <span className="weight-moved-fun">{r.fun}</span>
                  </div>
                ))}
              </div>
            </section>
          );
        })()}

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

        {/* --- Calendar snapshot ------------------------------------------ */}
        <section className="dash-section">
          <div className="dash-section-head dash-animate">
            <h2 className="dash-section-title">Calendar</h2>
          </div>
          <button type="button" className="dash-card dash-strip-card dash-animate" onClick={() => navigate('/calendar')}>
            <MiniCalendar sessions={d.sessions} />
            <div className="mini-cal-footer">
              <div className="mini-cal-legend">
                <span className="mini-cal-legend-item"><i className="legend-dot legend-dot--push" /> Push</span>
                <span className="mini-cal-legend-item"><i className="legend-dot legend-dot--pull" /> Pull</span>
                <span className="mini-cal-legend-item"><i className="legend-dot legend-dot--legs" /> Legs</span>
                <span className="mini-cal-legend-item"><i className="legend-dot legend-dot--core" /> Core</span>
              </div>
              <span className="dash-strip-link">Open full calendar →</span>
            </div>
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
      {loading && <DashboardSkeleton />}
      {!loading && error && !data && (
        <section className="dash-card dash-error-card dash-animate">
          <span className="dash-error-icon" aria-hidden>!</span>
          <p className="dash-error-title">Couldn't load your dashboard</p>
          <p className="dash-error-detail">Check your connection, then give it another shot.</p>
          <button type="button" className="nav-button dash-error-retry" onClick={retry}>
            Try Again
          </button>
        </section>
      )}
      {!loading && data && renderBody(data)}
      <BottomNav />
    </div>
  );
}

export default Dashboard;
