import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';

interface WorkoutRow {
  id: string;
  name: string;
}

interface LastTrainedByWorkoutRow {
  workout_id: string;
  last_trained: string;
}

interface DaySelectionProps {
  onDaySelect: (splitName: string, dayName: string) => void;
}

function DaySelection({ onDaySelect }: DaySelectionProps): React.JSX.Element {
  const { splitName } = useParams<{ splitName: string }>();
  const [days, setDays] = useState<WorkoutRow[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [dayToLastTrained, setDayToLastTrained] = useState<Record<string, string>>({});

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

  function formatLastTrained(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    const now = new Date();
    const includeYear = parsed.getFullYear() !== now.getFullYear();
    return parsed.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(includeYear ? { year: 'numeric' } : {}),
    });
  }

  if (notFound) {
    return (
      <div className="page">
        <h1>Split not found</h1>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>{splitName}</h1>
      {days === null ? (
        <p>Loading…</p>
      ) : (
        <div className="button-list">
          {days.map((day) => (
            <div key={day.id} className="workout-choice">
              <button
                className="nav-button"
                onClick={() => onDaySelect(splitName ?? '', day.name)}
              >
                {day.name}
              </button>
              <p className="workout-choice-last-trained">
                {dayToLastTrained[day.name]
                  ? `Last trained: ${formatLastTrained(dayToLastTrained[day.name])}`
                  : 'Not trained yet'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DaySelection;
