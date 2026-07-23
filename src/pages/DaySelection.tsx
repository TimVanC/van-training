import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import { computeNextDayName } from '../lib/rotation.js';

function dayKind(dayName: string): string {
  const n = dayName.toLowerCase();
  if (n.includes('push')) return 'push';
  if (n.includes('pull')) return 'pull';
  if (n.includes('leg')) return 'legs';
  if (n.includes('core')) return 'core';
  return 'other';
}

/** Whole calendar days between two dates, compared at LOCAL midnight so an
 *  evening workout logged yesterday reads as "yesterday", not "today". */
function calendarDaysAgo(then: Date, now: Date): number {
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function relativeLastTrained(value?: string): string {
  if (!value) return 'Not trained yet';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return 'Not trained yet';
  const days = calendarDaysAgo(then, new Date());
  if (days <= 0) return 'Trained today';
  if (days === 1) return 'Trained yesterday';
  if (days < 7) return `Trained ${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return weeks === 1 ? 'Trained 1 week ago' : `Trained ${weeks} weeks ago`;
  return `Last trained ${then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

interface WorkoutRow {
  id: string;
  name: string;
}

interface LastTrainedByWorkoutRow {
  workout_id: string;
  last_trained: string;
}

/** Outcome of attempting to start a day, so the UI can give feedback instead
 *  of silently doing nothing when a day can't be opened. */
export type DaySelectResult = 'ok' | 'empty' | 'error';

interface DaySelectionProps {
  onDaySelect: (splitName: string, dayName: string) => Promise<DaySelectResult>;
}

function DaySelection({ onDaySelect }: DaySelectionProps): React.JSX.Element {
  const navigate = useNavigate();
  const { splitName } = useParams<{ splitName: string }>();
  const [days, setDays] = useState<WorkoutRow[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [dayToLastTrained, setDayToLastTrained] = useState<Record<string, string>>({});
  const [busyDay, setBusyDay] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleDayClick(dayName: string): Promise<void> {
    if (busyDay) return;
    setActionError(null);
    setBusyDay(dayName);
    const result = await onDaySelect(splitName ?? '', dayName);
    // On 'ok' we navigate away and this component unmounts, so only update
    // state for the failure cases.
    if (result === 'empty') {
      setActionError(`"${dayName}" doesn't have any exercises set up yet.`);
      setBusyDay(null);
    } else if (result === 'error') {
      setActionError(`Couldn't open "${dayName}". Please try again.`);
      setBusyDay(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setDays(null);
    setNotFound(false);
    setDayToLastTrained({});

    (async () => {
      const userResult = await supabase.auth.getUser();
      const userId = userResult.data.user?.id;
      if (!userId) {
        if (!cancelled) setNotFound(true);
        return;
      }

      const splitResult = await supabase
        .from('splits')
        .select('id')
        .eq('user_id', userId)
        .eq('name', splitName ?? '')
        .maybeSingle();
      const splitId = splitResult.data?.id;
      if (!splitId) {
        if (!cancelled) setNotFound(true);
        return;
      }

      const workoutsResult = await supabase
        .from('workouts')
        .select('id, name')
        .eq('split_id', splitId)
        .order('order_index', { ascending: true });
      const orderedWorkouts = (workoutsResult.data ?? []) as WorkoutRow[];
      if (cancelled) return;
      setDays(orderedWorkouts);
      if (orderedWorkouts.length === 0) return;

      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const response = await fetch('/api/getLastTrainedByWorkout', {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) return;
      const payload = (await response.json()) as LastTrainedByWorkoutRow[];
      const lastTrainedByWorkout = new Map<string, string>();
      for (const row of payload) {
        if (!row || typeof row.workout_id !== 'string' || typeof row.last_trained !== 'string') continue;
        lastTrainedByWorkout.set(row.workout_id, row.last_trained);
      }

      const next: Record<string, string> = {};
      for (const workout of orderedWorkouts) {
        const lastTrained = lastTrainedByWorkout.get(workout.id);
        if (lastTrained) next[workout.name] = lastTrained;
      }
      if (!cancelled) setDayToLastTrained(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [splitName]);

  // Which day is up next in the rotation: the one after the most recently
  // trained day, in the split's configured order.
  const nextDayName = useMemo(
    () =>
      computeNextDayName(
        (days ?? []).map((day) => ({ name: day.name, lastTrained: dayToLastTrained[day.name] })),
      ),
    [days, dayToLastTrained],
  );

  if (notFound) {
    return (
      <div className="page selection-page">
        <div className="selection-header">
          <button type="button" className="selection-back" onClick={() => navigate('/lift')} aria-label="Back">
            <IconChevronLeft />
          </button>
          <div className="selection-heading">
            <h1 className="selection-title">Split not found</h1>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page selection-page">
      <div className="selection-header">
        <button type="button" className="selection-back" onClick={() => navigate('/lift')} aria-label="Back to splits">
          <IconChevronLeft />
        </button>
        <div className="selection-heading">
          <p className="selection-kicker">Start a workout</p>
          <h1 className="selection-title">{splitName}</h1>
        </div>
      </div>

      {days === null ? (
        <div className="selection-list">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="day-card day-card--skeleton" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      ) : (
        <div className="selection-list">
          {actionError && <div className="submit-error" role="alert">{actionError}</div>}
          {days.map((day, i) => {
            const isNext = day.name === nextDayName;
            const kind = dayKind(day.name);
            const busy = busyDay === day.name;
            return (
              <button
                key={day.id}
                type="button"
                className={`day-card day-card--${kind} ${isNext ? 'day-card--next' : ''} dash-animate`}
                style={{ animationDelay: `${i * 55}ms` }}
                onClick={() => handleDayClick(day.name)}
                disabled={busyDay !== null}
              >
                <span className={`day-card-bar day-card-bar--${kind}`} aria-hidden />
                <span className="day-card-body">
                  <span className="day-card-top">
                    <span className="day-card-name">{day.name}</span>
                    {isNext && <span className="day-card-badge">Up next</span>}
                  </span>
                  <span className="day-card-sub">{relativeLastTrained(dayToLastTrained[day.name])}</span>
                </span>
                <span className="day-card-go" aria-hidden>{busy ? '…' : <IconChevronRight />}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IconChevronLeft(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconChevronRight(): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default DaySelection;
