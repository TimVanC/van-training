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

interface DeletePrompt {
  id: string;
  confirmations: number;
}

interface AddExerciseForm {
  name: string;
  workoutId: string;
  sets: string;
  repRange: string;
  inputMode: InputMode;
  supportsAssisted: boolean;
  swapParentName: string;
}

interface ExerciseOption {
  id: string;
  name: string;
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

const IconArchive = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect x="1" y="3" width="22" height="5" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);

const IconRestore = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
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

const ACTIVE_COLSPAN = 7;

const INITIAL_ADD_EXERCISE: AddExerciseForm = {
  name: '',
  workoutId: '',
  sets: '',
  repRange: '',
  inputMode: 'weight',
  supportsAssisted: false,
  swapParentName: '',
};

// "Add Day" targets a single primary split: prefer PPLs, then the first
// non-placeholder split, then whatever exists.
function resolveTargetSplit(views: SplitView[]): SplitView | null {
  if (views.length === 0) return null;
  return (
    views.find((s) => s.name === 'PPLs') ??
    views.find((s) => s.name.trim().toLowerCase() !== 'import split') ??
    views[0]
  );
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

const archivedHeaderButtonStyle: React.CSSProperties = {
  ...subHeaderButtonStyle,
  color: 'var(--text-secondary)',
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

const actionsCellStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.4rem',
  justifyContent: 'flex-end',
};

const dangerButtonStyle: React.CSSProperties = {
  padding: '0.6rem 1rem',
  fontSize: '0.95rem',
  fontWeight: 600,
  fontFamily: 'inherit',
  border: '1px solid var(--danger)',
  borderRadius: 'var(--radius)',
  background: 'transparent',
  color: 'var(--danger)',
  cursor: 'pointer',
};

const neutralButtonStyle: React.CSSProperties = {
  padding: '0.6rem 1rem',
  fontSize: '0.95rem',
  fontWeight: 600,
  fontFamily: 'inherit',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'transparent',
  color: 'var(--text-primary)',
  cursor: 'pointer',
};

function AdminPortal(): React.JSX.Element | null {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [splits, setSplits] = useState<SplitView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [expandedSplits, setExpandedSplits] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [expandedArchived, setExpandedArchived] = useState<Set<string>>(new Set());

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deletePrompt, setDeletePrompt] = useState<DeletePrompt | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [exerciseOptions, setExerciseOptions] = useState<ExerciseOption[]>([]);
  const [addExerciseOpen, setAddExerciseOpen] = useState(false);
  const [addExerciseForm, setAddExerciseForm] = useState<AddExerciseForm>(INITIAL_ADD_EXERCISE);
  const [addExerciseError, setAddExerciseError] = useState<string | null>(null);
  const [addExerciseSubmitting, setAddExerciseSubmitting] = useState(false);
  const [addDayOpen, setAddDayOpen] = useState(false);
  const [addDayName, setAddDayName] = useState('');
  const [addDayError, setAddDayError] = useState<string | null>(null);
  const [addDaySubmitting, setAddDaySubmitting] = useState(false);

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

  async function loadExerciseOptions(): Promise<void> {
    const { data } = await supabase.from('exercises').select('id, name').order('name', { ascending: true });
    setExerciseOptions((data ?? []) as ExerciseOption[]);
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
      await loadExerciseOptions();
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  function startEdit(exercise: ExerciseView): void {
    setEditingId(exercise.id);
    setDeletePrompt(null);
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

  async function setArchived(exercise: ExerciseView, archived: boolean): Promise<void> {
    if (!userId) return;
    setActionPending(true);
    setActionError(null);
    try {
      const { error } = await supabase
        .from('exercises')
        .update({ is_archived: archived })
        .eq('id', exercise.exerciseId);
      if (error) throw error;
      await loadSplits(userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setActionError(`${archived ? 'Archive' : 'Restore'} failed: ${message}`);
    } finally {
      setActionPending(false);
    }
  }

  function startDelete(exercise: ExerciseView): void {
    setEditingId(null);
    setActionError(null);
    setDeletePrompt({ id: exercise.id, confirmations: 0 });
  }

  function cancelDelete(): void {
    setDeletePrompt(null);
    setActionError(null);
  }

  function confirmDelete(exercise: ExerciseView): void {
    if (!deletePrompt || deletePrompt.id !== exercise.id) return;
    const next = deletePrompt.confirmations + 1;
    if (next >= 2) {
      void executeDelete(exercise);
    } else {
      setDeletePrompt({ id: exercise.id, confirmations: next });
    }
  }

  async function executeDelete(exercise: ExerciseView): Promise<void> {
    if (!userId) return;
    setActionPending(true);
    setActionError(null);
    try {
      const { error } = await supabase.from('exercises').delete().eq('id', exercise.exerciseId);
      if (error) throw error;
      await loadSplits(userId);
      setDeletePrompt(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setActionError(`Delete failed: ${message}`);
    } finally {
      setActionPending(false);
    }
  }

  async function handleAddExercise(): Promise<void> {
    if (!userId) return;
    const name = addExerciseForm.name.trim();
    const repRange = addExerciseForm.repRange.trim();
    const setsNum = Number(addExerciseForm.sets);

    if (!name) {
      setAddExerciseError('Name is required.');
      return;
    }
    if (!addExerciseForm.workoutId) {
      setAddExerciseError('Select a day to add this exercise to.');
      return;
    }
    if (!repRange) {
      setAddExerciseError('Rep range is required.');
      return;
    }
    if (!Number.isInteger(setsNum) || setsNum <= 0) {
      setAddExerciseError('Sets must be a whole number greater than 0.');
      return;
    }

    setAddExerciseSubmitting(true);
    setAddExerciseError(null);
    try {
      // Insert the exercise into the global catalog, reusing an existing row if
      // the name is already taken (name is unique).
      let exerciseId: string;
      const insertRes = await supabase
        .from('exercises')
        .insert({
          name,
          input_mode: addExerciseForm.inputMode,
          supports_assisted: addExerciseForm.supportsAssisted,
          is_archived: false,
        })
        .select('id')
        .single();
      if (insertRes.error) {
        const existing = await supabase.from('exercises').select('id').eq('name', name).maybeSingle();
        if (existing.error || !existing.data) throw insertRes.error;
        exerciseId = existing.data.id;
      } else {
        exerciseId = insertRes.data.id;
      }

      // Append to the chosen day at the next order_index.
      const orderRes = await supabase
        .from('workout_exercises')
        .select('order_index')
        .eq('workout_id', addExerciseForm.workoutId)
        .order('order_index', { ascending: false })
        .limit(1);
      const nextOrder = (orderRes.data?.[0]?.order_index ?? 0) + 1;

      const { error: weError } = await supabase.from('workout_exercises').insert({
        workout_id: addExerciseForm.workoutId,
        exercise_id: exerciseId,
        sets: setsNum,
        rep_range: repRange,
        input_mode: addExerciseForm.inputMode,
        order_index: nextOrder,
      });
      if (weError) throw weError;

      // Optional: register the new exercise as a swap child of a parent.
      const swapParent = addExerciseForm.swapParentName.trim();
      if (swapParent) {
        const { error: swapError } = await supabase.from('exercise_swaps').insert({
          user_id: userId,
          base_exercise_name: swapParent,
          swap_exercise_name: name,
        });
        if (swapError) throw swapError;
      }

      await loadSplits(userId);
      await loadExerciseOptions();
      setAddExerciseForm(INITIAL_ADD_EXERCISE);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setAddExerciseError(`Add exercise failed: ${message}`);
    } finally {
      setAddExerciseSubmitting(false);
    }
  }

  async function handleAddDay(): Promise<void> {
    if (!userId || splits === null) return;
    const name = addDayName.trim();
    if (!name) {
      setAddDayError('Name is required.');
      return;
    }
    const targetSplit = resolveTargetSplit(splits);
    if (!targetSplit) {
      setAddDayError('No split available to add a day to.');
      return;
    }

    setAddDaySubmitting(true);
    setAddDayError(null);
    try {
      const orderRes = await supabase
        .from('workouts')
        .select('order_index')
        .eq('split_id', targetSplit.id)
        .order('order_index', { ascending: false })
        .limit(1);
      const nextOrder = (orderRes.data?.[0]?.order_index ?? 0) + 1;

      const { error } = await supabase.from('workouts').insert({
        split_id: targetSplit.id,
        name,
        order_index: nextOrder,
      });
      if (error) throw error;

      await loadSplits(userId);
      setAddDayName('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setAddDayError(`Add day failed: ${message}`);
    } finally {
      setAddDaySubmitting(false);
    }
  }

  function renderEditRow(exercise: ExerciseView): React.JSX.Element {
    return (
      <tr key={exercise.id}>
        <td colSpan={ACTIVE_COLSPAN}>
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
                value={form?.name ?? ''}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
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
                value={form?.sets ?? ''}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, sets: e.target.value } : prev))}
                disabled={saving}
              />
            </label>

            <label style={editFieldStyle}>
              Rep range
              <input
                className="input-field"
                type="text"
                placeholder="8-12"
                value={form?.repRange ?? ''}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, repRange: e.target.value } : prev))}
                disabled={saving}
              />
            </label>

            <label style={editFieldStyle}>
              Input mode
              <select
                className="input-field"
                value={form?.inputMode ?? 'weight'}
                onChange={(e) =>
                  setForm((prev) => (prev ? { ...prev, inputMode: e.target.value as InputMode } : prev))
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
                checked={form?.supportsAssisted ?? false}
                onChange={(e) =>
                  setForm((prev) => (prev ? { ...prev, supportsAssisted: e.target.checked } : prev))
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
              <button type="button" className="nav-button" onClick={cancelEdit} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  function renderDeleteRow(exercise: ExerciseView): React.JSX.Element {
    const confirmations = deletePrompt?.confirmations ?? 0;
    return (
      <tr key={exercise.id}>
        <td colSpan={ACTIVE_COLSPAN}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              maxWidth: 480,
              padding: '0.5rem 0',
            }}
          >
            <p style={{ margin: 0, color: 'var(--danger)', fontWeight: 600 }}>
              This will permanently delete {exercise.name}. Historical lift data will be orphaned and
              unrecoverable. This cannot be undone.
            </p>

            {actionError && (
              <div className="submit-error" role="alert">
                {actionError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                style={dangerButtonStyle}
                onClick={() => confirmDelete(exercise)}
                disabled={actionPending}
              >
                {actionPending
                  ? 'Deleting…'
                  : confirmations === 0
                    ? 'Confirm delete'
                    : 'Click again to permanently delete'}
              </button>
              <button
                type="button"
                style={neutralButtonStyle}
                onClick={cancelDelete}
                disabled={actionPending}
              >
                Cancel
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  function renderActiveRow(exercise: ExerciseView): React.JSX.Element {
    return (
      <tr key={exercise.id}>
        <td>{exercise.name}</td>
        <td>{exercise.sets}</td>
        <td>{exercise.repRange}</td>
        <td>{exercise.inputMode}</td>
        <td>{exercise.supportsAssisted ? 'Yes' : 'No'}</td>
        <td>{exercise.isArchived ? 'Yes' : 'No'}</td>
        <td>
          <div style={actionsCellStyle}>
            <button
              type="button"
              className="set-action-button"
              onClick={() => startEdit(exercise)}
              disabled={actionPending || editingId !== null || deletePrompt !== null}
              aria-label={`Edit ${exercise.name}`}
            >
              <IconPencil />
            </button>
            <button
              type="button"
              className="set-action-button"
              onClick={() => void setArchived(exercise, true)}
              disabled={actionPending || editingId !== null || deletePrompt !== null}
              aria-label={`Archive ${exercise.name}`}
            >
              <IconArchive />
            </button>
            <button
              type="button"
              className="set-action-button set-action-button--delete"
              onClick={() => startDelete(exercise)}
              disabled={actionPending || editingId !== null || deletePrompt !== null}
              aria-label={`Permanently delete ${exercise.name}`}
            >
              <IconTrash />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  function renderArchivedRow(exercise: ExerciseView): React.JSX.Element {
    return (
      <tr key={exercise.id} style={{ color: 'var(--text-secondary)' }}>
        <td>{exercise.name}</td>
        <td>{exercise.sets}</td>
        <td>{exercise.repRange}</td>
        <td>{exercise.inputMode}</td>
        <td>{exercise.supportsAssisted ? 'Yes' : 'No'}</td>
        <td>Yes</td>
        <td>
          <div style={actionsCellStyle}>
            <button
              type="button"
              className="set-action-button"
              onClick={() => void setArchived(exercise, false)}
              disabled={actionPending || editingId !== null || deletePrompt !== null}
              aria-label={`Restore ${exercise.name}`}
            >
              <IconRestore />
            </button>
            <button
              type="button"
              className="set-action-button set-action-button--delete"
              onClick={() => startDelete(exercise)}
              disabled={actionPending || editingId !== null || deletePrompt !== null}
              aria-label={`Permanently delete ${exercise.name}`}
            >
              <IconTrash />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  if (!authorized) return null;

  const splitViews = splits ?? [];
  const multipleSplits = splitViews.length > 1;
  const dayOptions = splitViews.flatMap((split) =>
    split.days.map((day) => ({
      value: day.id,
      label: multipleSplits ? `${split.name} — ${day.name}` : day.name,
    })),
  );
  const addDayTargetSplit = resolveTargetSplit(splitViews);

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

      <section className="analytics-card">
        <button
          type="button"
          style={headerButtonStyle}
          onClick={() => setAddExerciseOpen((open) => !open)}
          aria-expanded={addExerciseOpen}
        >
          <IconChevron open={addExerciseOpen} />
          <span className="analytics-section-title" style={{ margin: 0 }}>
            Add Exercise
          </span>
        </button>

        {addExerciseOpen && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              maxWidth: 480,
              paddingTop: '0.75rem',
            }}
          >
            <label style={editFieldStyle}>
              Name
              <input
                className="input-field"
                type="text"
                value={addExerciseForm.name}
                onChange={(e) => setAddExerciseForm((prev) => ({ ...prev, name: e.target.value }))}
                disabled={addExerciseSubmitting}
              />
            </label>

            <label style={editFieldStyle}>
              Day
              <select
                className="input-field"
                value={addExerciseForm.workoutId}
                onChange={(e) => setAddExerciseForm((prev) => ({ ...prev, workoutId: e.target.value }))}
                disabled={addExerciseSubmitting || dayOptions.length === 0}
              >
                <option value="">{dayOptions.length === 0 ? 'No days available' : 'Select a day'}</option>
                {dayOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={editFieldStyle}>
              Sets
              <input
                className="input-field"
                type="number"
                inputMode="numeric"
                min={1}
                value={addExerciseForm.sets}
                onChange={(e) => setAddExerciseForm((prev) => ({ ...prev, sets: e.target.value }))}
                disabled={addExerciseSubmitting}
              />
            </label>

            <label style={editFieldStyle}>
              Rep range
              <input
                className="input-field"
                type="text"
                placeholder="8-12"
                value={addExerciseForm.repRange}
                onChange={(e) => setAddExerciseForm((prev) => ({ ...prev, repRange: e.target.value }))}
                disabled={addExerciseSubmitting}
              />
            </label>

            <label style={editFieldStyle}>
              Input mode
              <select
                className="input-field"
                value={addExerciseForm.inputMode}
                onChange={(e) =>
                  setAddExerciseForm((prev) => ({ ...prev, inputMode: e.target.value as InputMode }))
                }
                disabled={addExerciseSubmitting}
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
                checked={addExerciseForm.supportsAssisted}
                onChange={(e) =>
                  setAddExerciseForm((prev) => ({ ...prev, supportsAssisted: e.target.checked }))
                }
                disabled={addExerciseSubmitting}
              />
              Supports assisted
            </label>

            <label style={editFieldStyle}>
              Designate as swap child of (optional)
              <select
                className="input-field"
                value={addExerciseForm.swapParentName}
                onChange={(e) =>
                  setAddExerciseForm((prev) => ({ ...prev, swapParentName: e.target.value }))
                }
                disabled={addExerciseSubmitting}
              >
                <option value="">None</option>
                {exerciseOptions.map((option) => (
                  <option key={option.id} value={option.name}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>

            {addExerciseError && (
              <div className="submit-error" role="alert">
                {addExerciseError}
              </div>
            )}

            <button
              type="button"
              className="nav-button nav-button--finish-ready"
              onClick={() => void handleAddExercise()}
              disabled={addExerciseSubmitting}
            >
              {addExerciseSubmitting ? 'Adding…' : 'Add Exercise'}
            </button>
          </div>
        )}
      </section>

      <section className="analytics-card">
        <button
          type="button"
          style={headerButtonStyle}
          onClick={() => setAddDayOpen((open) => !open)}
          aria-expanded={addDayOpen}
        >
          <IconChevron open={addDayOpen} />
          <span className="analytics-section-title" style={{ margin: 0 }}>
            Add Day
          </span>
        </button>

        {addDayOpen && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              maxWidth: 480,
              paddingTop: '0.75rem',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Adds a day to: <strong>{addDayTargetSplit?.name ?? '—'}</strong>
            </p>

            <label style={editFieldStyle}>
              Name
              <input
                className="input-field"
                type="text"
                placeholder="Push C"
                value={addDayName}
                onChange={(e) => setAddDayName(e.target.value)}
                disabled={addDaySubmitting}
              />
            </label>

            {addDayError && (
              <div className="submit-error" role="alert">
                {addDayError}
              </div>
            )}

            <button
              type="button"
              className="nav-button nav-button--finish-ready"
              onClick={() => void handleAddDay()}
              disabled={addDaySubmitting || !addDayTargetSplit}
            >
              {addDaySubmitting ? 'Adding…' : 'Add Day'}
            </button>
          </div>
        )}
      </section>

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
                  const activeExercises = day.exercises.filter((e) => !e.isArchived);
                  const archivedExercises = day.exercises.filter((e) => e.isArchived);
                  const archivedOpen = expandedArchived.has(dayKey);
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
                          {activeExercises.length}{' '}
                          {activeExercises.length === 1 ? 'exercise' : 'exercises'}
                        </span>
                      </button>

                      {dayOpen && (
                        <>
                          {activeExercises.length === 0 ? (
                            <p className="analytics-empty-state" style={{ marginTop: 0 }}>
                              No active exercises.
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
                                {activeExercises.map((exercise) => {
                                  if (editingId === exercise.id) return renderEditRow(exercise);
                                  if (deletePrompt?.id === exercise.id) return renderDeleteRow(exercise);
                                  return renderActiveRow(exercise);
                                })}
                              </tbody>
                            </table>
                          )}

                          {archivedExercises.length > 0 && (
                            <>
                              <button
                                type="button"
                                style={archivedHeaderButtonStyle}
                                onClick={() => setExpandedArchived((prev) => toggleId(prev, dayKey))}
                                aria-expanded={archivedOpen}
                              >
                                <IconChevron open={archivedOpen} />
                                <span style={{ fontWeight: 600 }}>Archived</span>
                                <span style={countStyle}>{archivedExercises.length}</span>
                              </button>

                              {archivedOpen && (
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
                                    {archivedExercises.map((exercise) => {
                                      if (deletePrompt?.id === exercise.id) return renderDeleteRow(exercise);
                                      return renderArchivedRow(exercise);
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </>
                          )}
                        </>
                      )}
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
