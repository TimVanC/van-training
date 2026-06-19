import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';

const ADMIN_EMAIL = 'timvancau@gmail.com';

type InputMode = 'weight' | 'plates';

interface ExerciseRecord {
  name: string;
  input_mode: InputMode | null;
  supports_assisted: boolean | null;
  is_archived: boolean | null;
}

interface WorkoutExerciseRecord {
  id: string;
  sets: number;
  rep_range: string;
  order_index: number;
  input_mode: InputMode | null;
  exercises: ExerciseRecord | ExerciseRecord[] | null;
}

interface WorkoutRecord {
  id: string;
  name: string;
  order_index: number;
  workout_exercises: WorkoutExerciseRecord[] | null;
}

interface SplitRecord {
  id: string;
  name: string;
  created_at: string;
  workouts: WorkoutRecord[] | null;
}

interface ExerciseView {
  id: string;
  name: string;
  sets: number;
  repRange: string;
  inputMode: InputMode;
  supportsAssisted: boolean;
  isArchived: boolean;
}

interface DayView {
  id: string;
  name: string;
  exercises: ExerciseView[];
}

interface SplitView {
  id: string;
  name: string;
  days: DayView[];
}

const IconArrowLeft = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    style={{ transition: 'transform 0.15s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

function firstRecord<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function buildSplitViews(records: SplitRecord[]): SplitView[] {
  return records.map((split) => {
    const workouts = [...(split.workouts ?? [])].sort((a, b) => a.order_index - b.order_index);
    const days: DayView[] = workouts.map((workout) => {
      const workoutExercises = [...(workout.workout_exercises ?? [])].sort(
        (a, b) => a.order_index - b.order_index,
      );
      const exercises: ExerciseView[] = [];
      for (const we of workoutExercises) {
        const exerciseRecord = firstRecord(we.exercises);
        if (!exerciseRecord) continue;
        // Per-prescription override wins; otherwise inherit the exercise's input mode.
        const inputMode: InputMode = we.input_mode ?? exerciseRecord.input_mode ?? 'weight';
        exercises.push({
          id: we.id,
          name: exerciseRecord.name,
          sets: we.sets,
          repRange: we.rep_range,
          inputMode,
          supportsAssisted: exerciseRecord.supports_assisted ?? false,
          isArchived: exerciseRecord.is_archived ?? false,
        });
      }
      return { id: workout.id, name: workout.name, exercises };
    });
    return { id: split.id, name: split.name, days };
  });
}

function toggleId(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

const headerButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  width: '100%',
  background: 'transparent',
  border: 'none',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  textAlign: 'left',
  padding: 0,
};

const subHeaderButtonStyle: React.CSSProperties = {
  ...headerButtonStyle,
  padding: '0.55rem 0',
  borderTop: '1px solid var(--border)',
};

const countStyle: React.CSSProperties = {
  marginLeft: 'auto',
  color: 'var(--text-secondary)',
  fontSize: '0.8rem',
  fontWeight: 500,
};

function AdminPortal(): React.JSX.Element | null {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [splits, setSplits] = useState<SplitView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [expandedSplits, setExpandedSplits] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const sessionResult = await supabase.auth.getSession();
      const email = sessionResult.data.session?.user?.email ?? null;
      const userId = sessionResult.data.session?.user?.id ?? null;
      if (cancelled) return;
      if (email !== ADMIN_EMAIL || !userId) {
        navigate('/', { replace: true });
        return;
      }
      setAuthorized(true);

      const { data, error } = await supabase
        .from('splits')
        .select(
          'id, name, created_at, workouts ( id, name, order_index, workout_exercises ( id, sets, rep_range, order_index, input_mode, exercises ( name, input_mode, supports_assisted, is_archived ) ) )',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (cancelled) return;
      if (error) {
        setLoadError(true);
        setSplits([]);
        return;
      }
      setSplits(buildSplitViews((data ?? []) as SplitRecord[]));
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (!authorized) return null;

  return (
    <div className="page">
      <div className="page-header-row">
        <button
          type="button"
          className="hamburger-button"
          onClick={() => navigate('/')}
          aria-label="Back to home"
        >
          <IconArrowLeft />
        </button>
        <h1>Admin</h1>
      </div>

      {splits === null ? (
        <p className="analytics-empty-state">Loading…</p>
      ) : loadError ? (
        <p className="analytics-empty-state">Could not load program structure.</p>
      ) : splits.length === 0 ? (
        <p className="analytics-empty-state">No splits found.</p>
      ) : (
        splits.map((split) => {
          const splitOpen = expandedSplits.has(split.id);
          return (
            <section key={split.id} className="analytics-card">
              <button
                type="button"
                style={headerButtonStyle}
                onClick={() => setExpandedSplits((prev) => toggleId(prev, split.id))}
                aria-expanded={splitOpen}
              >
                <IconChevron open={splitOpen} />
                <span className="analytics-section-title" style={{ margin: 0 }}>
                  {split.name}
                </span>
                <span style={countStyle}>
                  {split.days.length} {split.days.length === 1 ? 'day' : 'days'}
                </span>
              </button>

              {splitOpen &&
                split.days.map((day) => {
                  const dayKey = `${split.id}:${day.id}`;
                  const dayOpen = expandedDays.has(dayKey);
                  return (
                    <div key={day.id}>
                      <button
                        type="button"
                        style={subHeaderButtonStyle}
                        onClick={() => setExpandedDays((prev) => toggleId(prev, dayKey))}
                        aria-expanded={dayOpen}
                      >
                        <IconChevron open={dayOpen} />
                        <span style={{ fontWeight: 600 }}>{day.name}</span>
                        <span style={countStyle}>
                          {day.exercises.length}{' '}
                          {day.exercises.length === 1 ? 'exercise' : 'exercises'}
                        </span>
                      </button>

                      {dayOpen &&
                        (day.exercises.length === 0 ? (
                          <p className="analytics-empty-state" style={{ marginTop: 0 }}>
                            No exercises.
                          </p>
                        ) : (
                          <table className="analytics-table">
                            <thead>
                              <tr>
                                <th>Exercise</th>
                                <th>Sets</th>
                                <th>Reps</th>
                                <th>Input</th>
                                <th>Assisted</th>
                                <th>Archived</th>
                              </tr>
                            </thead>
                            <tbody>
                              {day.exercises.map((exercise) => (
                                <tr
                                  key={exercise.id}
                                  style={exercise.isArchived ? { color: 'var(--text-secondary)' } : undefined}
                                >
                                  <td>{exercise.name}</td>
                                  <td>{exercise.sets}</td>
                                  <td>{exercise.repRange}</td>
                                  <td>{exercise.inputMode}</td>
                                  <td>{exercise.supportsAssisted ? 'Yes' : 'No'}</td>
                                  <td>{exercise.isArchived ? 'Yes' : 'No'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ))}
                    </div>
                  );
                })}
            </section>
          );
        })
      )}
    </div>
  );
}

export default AdminPortal;
