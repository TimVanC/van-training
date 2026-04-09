import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import splits from '../data/splits';
import { supabase } from '../utils/supabaseClient';

interface WorkoutRow {
  id: string;
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
  const [dayToLastTrained, setDayToLastTrained] = useState<Record<string, string>>({});

  const split = splits.find((s) => s.split === splitName);

  if (!split) {
    return (
      <div className="page">
        <h1>Split not found</h1>
      </div>
    );
  }

  const currentSplit = split.split;
  const dayNames = Object.keys(split.days);
  const dayNamesKey = useMemo(() => dayNames.join('|'), [dayNames]);

  useEffect(() => {
    let cancelled = false;
    setDayToLastTrained({});

    (async () => {
      const userResult = await supabase.auth.getUser();
      const userId = userResult.data.user?.id;
      if (!userId) return;

      const splitResult = await supabase
        .from('splits')
        .select('id')
        .eq('user_id', userId)
        .eq('name', currentSplit)
        .maybeSingle();
      const splitId = splitResult.data?.id;
      if (!splitId) return;

      const workoutsResult = await supabase
        .from('workouts')
        .select('id')
        .eq('split_id', splitId)
        .order('order_index', { ascending: true });
      const orderedWorkouts = (workoutsResult.data ?? []) as WorkoutRow[];
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
      dayNames.forEach((day, index) => {
        const workoutId = orderedWorkouts[index]?.id;
        if (!workoutId) return;
        const lastTrained = lastTrainedByWorkout.get(workoutId);
        if (!lastTrained) return;
        next[day] = lastTrained;
      });
      if (!cancelled) setDayToLastTrained(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentSplit, dayNamesKey]);

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

  return (
    <div className="page">
      <h1>{split.split}</h1>
      <div className="button-list">
        {dayNames.map((day) => (
          <div key={day} className="workout-choice">
            <button
              className="nav-button"
              onClick={() => onDaySelect(currentSplit, day)}
            >
              {day}
            </button>
            <p className="workout-choice-last-trained">
              {dayToLastTrained[day]
                ? `Last trained: ${formatLastTrained(dayToLastTrained[day])}`
                : 'Not trained yet'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default DaySelection;
