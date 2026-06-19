import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';

const ADMIN_EMAIL = 'timvancau@gmail.com';

type InputMode = 'weight' | 'plates';

interface ExerciseRecord {
  id: string;
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
  exerciseId: string;
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

interface EditForm {
  name: string;
  sets: string;
  repRange: string;
  inputMode: InputMode;
  supportsAssisted: boolean;
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

const IconPencil = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
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
          exerciseId: exerciseRecord.id,
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

const SPLITS_SELECT =
  'id, name, created_at, workouts ( id, name, order_index, workout_exercises ( id, sets, rep_range, order_index, input_mode, exercises ( id, name, input_mode, supports_assisted, is_archived ) ) )';

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

const editFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  fontSize: '0.85rem',
  color: 'var(--text-secondary)',
};

function AdminPortal(): React.JSX.Element | null {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [splits, setSplits] = useState<SplitView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [expandedSplits, setExpandedSplits] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadSplits(currentUserId: string): Promise<void> {
    const { data, error } = await supabase
      .from('splits')
      .select(SPLITS_SELECT)
      .eq('user_id', currentUserId)
      .order('created_at', { ascending: true });

    if (error) {
      setLoadError(true);
      setSplits([]);
      return;
    }
    setLoadError(false);
    setSplits(buildSplitViews((data ?? []) as SplitRecord[]));
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const sessionResult = await supabase.auth.getSession();
      const email = sessionResult.data.session?.user?.email ?? null;
      const id = sessionResult.data.session?.user?.id ?? null;
      if (cancelled) return;
      if (email !== ADMIN_EMAIL || !id) {
        navigate('/', { replace: true });
        return;
      }
      setAuthorized(true);
      setUserId(id);
      await loadSplits(id);
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  function startEdit(exercise: ExerciseView): void {
    setEditingId(exercise.id);
    setFormError(null);
    setForm({
      name: exercise.name,
      sets: String(exercise.sets),
      repRange: exercise.repRange,
      inputMode: exercise.inputMode,
      supportsAssisted: exercise.supportsAssisted,
    });
  }

  function cancelEdit(): void {
    setEditingId(null);
    setForm(null);
    setFormError(null);
  }

  async function handleSave(exercise: ExerciseView): Promise<void> {
    if (!form || !userId) return;

    const trimmedName = form.name.trim();
    const trimmedRepRange = form.repRange.trim();
    const setsNum = Number(form.sets);

    if (!trimmedName) {
      setFormError('Name is required.');
      return;
    }
    if (!trimmedRepRange) {
      setFormError('Rep range is required.');
      return;
    }
    if (!Number.isInteger(setsNum) || setsNum <= 0) {
      setFormError('Sets must be a whole number greater than 0.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const { error: weError } = await supabase
        .from('workout_exercises')
        .update({ sets: setsNum, rep_range: trimmedRepRange, input_mode: form.inputMode })
        .eq('id', exercise.id);
      if (weError) throw weError;

      const { error: exError } = await supabase
        .from('exercises')
        .update({ name: trimmedName, supports_assisted: form.supportsAssisted })
        .eq('id', exercise.exerciseId);
      if (exError) throw exError;

      if (trimmedName !== exercise.name) {
        const { error: liftSetsError } = await supabase
          .from('lift_sets')
          .update({ exercise_name: trimmedName })
          .eq('exercise_name', exercise.name);
        if (liftSetsError) throw liftSetsError;
      }

      await loadSplits(userId);
      cancelEdit();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setFormError(`Save failed: ${message}`);
    } finally {
      setSaving(false);
    }
  }

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
                                <th aria-label="Actions" />
                              </tr>
                            </thead>
                            <tbody>
                              {day.exercises.map((exercise) =>
                                editingId === exercise.id && form ? (
                                  <tr key={exercise.id}>
                                    <td colSpan={7}>
                                      <div
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: '0.75rem',
                                          maxWidth: 480,
                                          padding: '0.5rem 0',
                                        }}
                                      >
                                        <label style={editFieldStyle}>
                                          Name
                                          <input
                                            className="input-field"
                                            type="text"
                                            value={form.name}
                                            onChange={(e) =>
                                              setForm((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                                            }
                                            disabled={saving}
                                          />
                                        </label>

                                        <label style={editFieldStyle}>
                                          Sets
                                          <input
                                            className="input-field"
                                            type="number"
                                            inputMode="numeric"
                                            min={1}
                                            value={form.sets}
                                            onChange={(e) =>
                                              setForm((prev) => (prev ? { ...prev, sets: e.target.value } : prev))
                                            }
                                            disabled={saving}
                                          />
                                        </label>

                                        <label style={editFieldStyle}>
                                          Rep range
                                          <input
                                            className="input-field"
                                            type="text"
                                            placeholder="8-12"
                                            value={form.repRange}
                                            onChange={(e) =>
                                              setForm((prev) => (prev ? { ...prev, repRange: e.target.value } : prev))
                                            }
                                            disabled={saving}
                                          />
                                        </label>

                                        <label style={editFieldStyle}>
                                          Input mode
                                          <select
                                            className="input-field"
                                            value={form.inputMode}
                                            onChange={(e) =>
                                              setForm((prev) =>
                                                prev ? { ...prev, inputMode: e.target.value as InputMode } : prev,
                                              )
                                            }
                                            disabled={saving}
                                          >
                                            <option value="weight">weight</option>
                                            <option value="plates">plates</option>
                                          </select>
                                        </label>

                                        <label
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            fontSize: '0.9rem',
                                            color: 'var(--text-primary)',
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={form.supportsAssisted}
                                            onChange={(e) =>
                                              setForm((prev) =>
                                                prev ? { ...prev, supportsAssisted: e.target.checked } : prev,
                                              )
                                            }
                                            disabled={saving}
                                          />
                                          Supports assisted
                                        </label>

                                        {formError && (
                                          <div className="submit-error" role="alert">
                                            {formError}
                                          </div>
                                        )}

                                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                                          <button
                                            type="button"
                                            className="nav-button nav-button--finish-ready"
                                            onClick={() => void handleSave(exercise)}
                                            disabled={saving}
                                          >
                                            {saving ? 'Saving…' : 'Save'}
                                          </button>
                                          <button
                                            type="button"
                                            className="nav-button"
                                            onClick={cancelEdit}
                                            disabled={saving}
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                ) : (
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
                                    <td>
                                      <button
                                        type="button"
                                        className="set-action-button"
                                        onClick={() => startEdit(exercise)}
                                        disabled={editingId !== null}
                                        aria-label={`Edit ${exercise.name}`}
                                      >
                                        <IconPencil />
                                      </button>
                                    </td>
                                  </tr>
                                ),
                              )}
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
