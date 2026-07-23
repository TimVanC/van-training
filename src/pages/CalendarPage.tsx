import { useMemo, useState } from 'react';
import BottomNav from '../components/BottomNav';
import { useDashboardData } from '../hooks/useDashboardData';
import type { DashboardSession } from '../types/dashboard';

const numberFormatter = new Intl.NumberFormat('en-US');
const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

type DayKind = 'push' | 'pull' | 'legs' | 'core' | 'other';

function dayKind(dayName: string): DayKind {
  const n = dayName.toLowerCase();
  if (n.includes('push')) return 'push';
  if (n.includes('pull')) return 'pull';
  if (n.includes('leg')) return 'legs';
  if (n.includes('core')) return 'core';
  return 'other';
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface CalendarCell {
  key: string;
  dayOfMonth: number | null;
  isToday: boolean;
  sessions: DashboardSession[];
}

function buildMonthCells(year: number, month: number, sessionsByDate: Map<string, DashboardSession[]>): CalendarCell[] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first offset (getDay: 0=Sun).
  const leadingBlanks = (first.getDay() + 6) % 7;
  const todayKey = localDateKey(new Date().toISOString());

  const cells: CalendarCell[] = [];
  for (let i = 0; i < leadingBlanks; i++) {
    cells.push({ key: `blank-${i}`, dayOfMonth: null, isToday: false, sessions: [] });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({
      key,
      dayOfMonth: day,
      isToday: key === todayKey,
      sessions: sessionsByDate.get(key) ?? [],
    });
  }
  return cells;
}

function CalendarPage(): React.JSX.Element {
  const { data, loading, error } = useDashboardData();
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const sessionsByDate = useMemo(() => {
    const map = new Map<string, DashboardSession[]>();
    for (const session of data?.sessions ?? []) {
      const key = localDateKey(session.date);
      const list = map.get(key);
      if (list) list.push(session);
      else map.set(key, [session]);
    }
    return map;
  }, [data]);

  const cells = useMemo(
    () => buildMonthCells(viewYear, viewMonth, sessionsByDate),
    [viewYear, viewMonth, sessionsByDate],
  );

  const monthStats = useMemo(() => {
    const prefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
    let workouts = 0;
    let volume = 0;
    const trainedDays = new Set<string>();
    for (const [date, sessions] of sessionsByDate) {
      if (!date.startsWith(prefix)) continue;
      workouts += sessions.length;
      trainedDays.add(date);
      for (const s of sessions) volume += s.totalVolume;
    }
    return { workouts, volume, trainedDays: trainedDays.size };
  }, [sessionsByDate, viewYear, viewMonth]);

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();

  function shiftMonth(delta: number): void {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  return (
    <div className="page page--with-nav">
      <h1>Calendar</h1>
      {loading && <p className="analytics-empty-state">Loading...</p>}
      {!loading && error && <p className="analytics-empty-state">Couldn't load training history.</p>}
      {!loading && data && (
        <>
          {data.weekStats.weekStreak > 1 && (
            <div className="calendar-streak-banner dash-animate">
              🔥 {data.weekStats.weekStreak}-week training streak — keep it rolling
            </div>
          )}

          <div className="calendar-card dash-animate">
            <div className="calendar-nav">
              <button type="button" className="calendar-nav-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                ‹
              </button>
              <span className="calendar-month-label">{monthLabel}</span>
              <button
                type="button"
                className="calendar-nav-btn"
                onClick={() => shiftMonth(1)}
                disabled={isCurrentMonth}
                aria-label="Next month"
              >
                ›
              </button>
            </div>

            <div className="calendar-grid calendar-grid--head">
              {WEEKDAY_LABELS.map((label, i) => (
                <span key={`${label}-${i}`} className="calendar-weekday">{label}</span>
              ))}
            </div>
            <div className="calendar-grid">
              {cells.map((cell, i) =>
                cell.dayOfMonth === null ? (
                  <span key={cell.key} />
                ) : (
                  <div
                    key={cell.key}
                    className={`calendar-day ${cell.isToday ? 'calendar-day--today' : ''} ${cell.sessions.length > 0 ? `calendar-day--trained calendar-day--${dayKind(cell.sessions[0].dayName)}` : ''}`}
                    style={{ animationDelay: `${i * 8}ms` }}
                    title={
                      cell.sessions.length > 0
                        ? cell.sessions.map((s) => `${s.dayName} — ${numberFormatter.format(s.totalVolume)} lbs`).join('\n')
                        : undefined
                    }
                  >
                    <span className="calendar-day-num">{cell.dayOfMonth}</span>
                    {cell.sessions.length > 0 && (
                      <span className="calendar-day-label">{cell.sessions[0].dayName.split(' ')[0]}</span>
                    )}
                  </div>
                ),
              )}
            </div>

            <div className="calendar-legend">
              <span className="calendar-legend-item"><i className="legend-dot legend-dot--push" /> Push</span>
              <span className="calendar-legend-item"><i className="legend-dot legend-dot--pull" /> Pull</span>
              <span className="calendar-legend-item"><i className="legend-dot legend-dot--legs" /> Legs</span>
              <span className="calendar-legend-item"><i className="legend-dot legend-dot--core" /> Core</span>
            </div>
          </div>

          <div className="dash-stat-grid dash-animate" style={{ animationDelay: '120ms' }}>
            <div className="dash-stat">
              <span className="dash-stat-value">{monthStats.workouts}</span>
              <span className="dash-stat-label">workouts</span>
            </div>
            <div className="dash-stat">
              <span className="dash-stat-value">{monthStats.trainedDays}</span>
              <span className="dash-stat-label">days trained</span>
            </div>
            <div className="dash-stat">
              <span className="dash-stat-value">
                {monthStats.volume >= 10000 ? `${(monthStats.volume / 1000).toFixed(0)}k` : numberFormatter.format(monthStats.volume)}
              </span>
              <span className="dash-stat-label">lbs moved</span>
            </div>
          </div>
        </>
      )}
      <BottomNav />
    </div>
  );
}

export default CalendarPage;
