import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { LiftSession, LoggedSet } from '../types/session';
import TemporaryOverlay from '../components/TemporaryOverlay';

interface ExerciseLoggingProps {
  session: LiftSession;
  onUpdateSession: (session: LiftSession) => void;
}

function ExerciseLogging({ session, onUpdateSession }: ExerciseLoggingProps): React.JSX.Element {
  const { exerciseIndex } = useParams<{ exerciseIndex: string }>();
  const navigate = useNavigate();
  const index = Number(exerciseIndex);
  const exercise = session.exercises[index];

  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [rir, setRir] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [overlayMsg, setOverlayMsg] = useState('');
  const [showOverlay, setShowOverlay] = useState(false);
  const overlayTimer = useRef<number>(0);

  if (!exercise) {
    return (
      <div className="page">
        <h1>Exercise not found</h1>
      </div>
    );
  }

  const exerciseListPath = `/lift/${encodeURIComponent(session.split)}/${encodeURIComponent(session.day)}`;

  function flashOverlay(msg: string): void {
    setOverlayMsg(msg);
    setShowOverlay(true);
    window.clearTimeout(overlayTimer.current);
    overlayTimer.current = window.setTimeout(() => setShowOverlay(false), 500);
  }

  function updateExercise(updatedSets: LoggedSet[], completed?: boolean): void {
    const updatedExercises = session.exercises.map((ex, i) =>
      i === index
        ? { ...ex, sets: updatedSets, completed: completed ?? ex.completed }
        : ex,
    );
    onUpdateSession({ ...session, exercises: updatedExercises });
  }

  function parseRir(): number {
    return rir.trim() === '' ? 0 : (parseInt(rir, 10) || 0);
  }

  function handleAddSet(): void {
    const w = parseFloat(weight);
    const r = parseInt(reps, 10);
    if (isNaN(w) || isNaN(r)) {
      flashOverlay('Weight and Reps are required');
      return;
    }
    const newSet: LoggedSet = { weight: w, reps: r, rir: parseRir() };
    updateExercise([...exercise.sets, newSet]);
    setWeight('');
    setReps('');
    setRir('');
  }

  function handleSaveEdit(): void {
    if (editingIndex === null) return;
    const w = parseFloat(weight);
    const r = parseInt(reps, 10);
    if (isNaN(w) || isNaN(r)) {
      flashOverlay('Weight and Reps are required');
      return;
    }
    const updatedSets = exercise.sets.map((s, i) =>
      i === editingIndex ? { weight: w, reps: r, rir: parseRir() } : s,
    );
    updateExercise(updatedSets);
    setWeight('');
    setReps('');
    setRir('');
    setEditingIndex(null);
  }

  function handleEdit(setIndex: number): void {
    const set = exercise.sets[setIndex];
    setWeight(String(set.weight));
    setReps(String(set.reps));
    setRir(String(set.rir));
    setEditingIndex(setIndex);
  }

  function handleDuplicate(setIndex: number): void {
    const set = exercise.sets[setIndex];
    setWeight(String(set.weight));
    setReps(String(set.reps));
    setRir(String(set.rir));
    setEditingIndex(null);
  }

  function handleDeleteSet(setIndex: number): void {
    const updatedSets = exercise.sets.filter((_, i) => i !== setIndex);
    updateExercise(updatedSets);
    if (editingIndex === setIndex) handleCancelEdit();
  }

  function handleCancelEdit(): void {
    setEditingIndex(null);
    setWeight('');
    setReps('');
    setRir('');
  }

  function handleFinish(): void {
    updateExercise(exercise.sets, true);
    navigate(exerciseListPath);
  }

  return (
    <div className="page">
      <h1>{exercise.name}</h1>
      <p className="exercise-target">
        Target: {exercise.targetSets} sets &times; {exercise.targetReps} reps
      </p>

      {exercise.sets.length > 0 && (
        <ul className="set-list">
          {exercise.sets.map((set, i) => (
            <li key={i} className="set-row">
              <span className="set-info">
                Set {i + 1}: {set.weight} lbs &times; {set.reps} @ RIR {set.rir}
              </span>
              <span className="set-actions">
                <button className="set-action-button" onClick={() => handleEdit(i)}>Edit</button>
                <button className="set-action-button" onClick={() => handleDuplicate(i)}>Dup</button>
                <button className="set-action-button" onClick={() => handleDeleteSet(i)}>Del</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="input-group">
        <label className="input-label">
          Weight (lbs)
          <input
            className="input-field"
            type="number"
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        <label className="input-label">
          Reps
          <input
            className="input-field"
            type="number"
            inputMode="numeric"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
          />
        </label>
        <label className="input-label">
          RIR (optional)
          <input
            className="input-field"
            type="number"
            inputMode="numeric"
            value={rir}
            onChange={(e) => setRir(e.target.value)}
          />
        </label>
      </div>

      <div className="button-list">
        {editingIndex !== null ? (
          <>
            <button className="nav-button" onClick={handleSaveEdit}>Save Edit</button>
            <button className="nav-button" onClick={handleCancelEdit}>Cancel</button>
          </>
        ) : (
          <button className="nav-button" onClick={handleAddSet}>Add Set</button>
        )}
        <button className="nav-button" onClick={handleFinish}>Finish Exercise</button>
      </div>
      <TemporaryOverlay message={overlayMsg} visible={showOverlay} />
    </div>
  );
}

export default ExerciseLogging;
