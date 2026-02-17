import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { LiftSession, LoggedSet, RecentLift, RecentLiftsResponse } from '../types/session';
import TemporaryOverlay from '../components/TemporaryOverlay';
import SetSavedToast from '../components/SetSavedToast';
import SetLoggingForm from '../components/SetLoggingForm';
import LoadingOverlay from '../components/LoadingOverlay';
import IncompleteSetModal from '../components/IncompleteSetModal';
import RecentLiftsSection from '../components/RecentLiftsSection';

interface ExerciseLoggingProps {
  session: LiftSession;
  onUpdateSession: (session: LiftSession) => void;
}

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ExerciseLogging({ session, onUpdateSession }: ExerciseLoggingProps): React.JSX.Element {
  const { exerciseIndex } = useParams<{ exerciseIndex: string }>();
  const navigate = useNavigate();
  const index = Number(exerciseIndex);
  const exercise = session.exercises[index];
  const weightRef = useRef<HTMLInputElement>(null);

  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [rir, setRir] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [overlayMsg, setOverlayMsg] = useState('');
  const [showOverlay, setShowOverlay] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [lastSetClientId, setLastSetClientId] = useState<string | null>(null);
  const [showIncompleteModal, setShowIncompleteModal] = useState(false);
  const [recentLifts, setRecentLifts] = useState<RecentLift[]>([]);
  const [lastTrained, setLastTrained] = useState<string | undefined>();
  const [recentLiftsLoading, setRecentLiftsLoading] = useState(false);
  const overlayTimer = useRef<number>(0);

  useEffect(() => {
    if (!exercise?.name) return;
    setRecentLiftsLoading(true);
    setRecentLifts([]);
    setLastTrained(undefined);
    fetch(`/api/getRecentLifts?exercise=${encodeURIComponent(exercise.name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { sets: [] }))
      .then((data: RecentLiftsResponse) => {
        setRecentLifts(Array.isArray(data.sets) ? data.sets : []);
        setLastTrained(typeof data.lastTrained === 'string' && data.lastTrained ? data.lastTrained : undefined);
      })
      .catch(() => {})
      .finally(() => setRecentLiftsLoading(false));
  }, [exercise?.name]);

  if (!exercise) {
    return (
      <div className="page">
        <h1>Exercise not found</h1>
      </div>
    );
  }

  const listPath = `/lift/${encodeURIComponent(session.split)}/${encodeURIComponent(session.day)}`;
  const loggedSets = exercise.sets.length;
  const totalSets = exercise.targetSets;
  const repRange = exercise.targetRepRange ?? (exercise.targetReps != null ? String(exercise.targetReps) : '-');

  function flashOverlay(msg: string): void {
    setOverlayMsg(msg);
    setShowOverlay(true);
    window.clearTimeout(overlayTimer.current);
    overlayTimer.current = window.setTimeout(() => setShowOverlay(false), 1050);
  }

  function updateExercise(updatedSets: LoggedSet[], completed?: boolean): void {
    const updated = session.exercises.map((ex, i) =>
      i === index ? { ...ex, sets: updatedSets, completed: completed ?? ex.completed } : ex,
    );
    onUpdateSession({ ...session, exercises: updated });
  }

  function parseRir(): number {
    return rir.trim() === '' ? 0 : (parseInt(rir, 10) || 0);
  }

  function doneSave(): void {
    weightRef.current?.focus({ preventScroll: true });
    setTimeout(() => setIsSubmitting(false), 500);
  }

  function handleAddSet(): LoggedSet[] | undefined {
    const normalizedWeight = Number(weight);
    const normalizedReps = Number(reps);
    const normalizedRir = rir === '' ? 0 : Number(rir);
    if (!Number.isFinite(normalizedWeight) || normalizedWeight <= 0) {
      flashOverlay('Weight and Reps are required');
      return undefined;
    }
    if (!Number.isFinite(normalizedReps) || normalizedReps <= 0) {
      flashOverlay('Weight and Reps are required');
      return undefined;
    }
    if (isSubmitting) return undefined;
    setIsSubmitting(true);
    const rid = Number.isFinite(normalizedRir) && normalizedRir >= 0 ? normalizedRir : 0;
    const clientId = genId();
    const newSet: LoggedSet = { weight: normalizedWeight, reps: normalizedReps, rir: rid, clientId };
    const newSets = [...exercise.sets, newSet];
    updateExercise(newSets);
    setToastMsg(`Set ${loggedSets + 1} saved. ${normalizedWeight} x ${normalizedReps} @ ${rid} RIR`);
    setLastSetClientId(clientId);
    setToastVisible(true);
    setWeight('');
    setReps('');
    setRir('');
    doneSave();
    return newSets;
  }

  function handleSaveEdit(): void {
    if (editingIndex === null) return;
    const w = parseFloat(weight);
    const r = parseInt(reps, 10);
    if (isNaN(w) || isNaN(r)) { flashOverlay('Weight and Reps are required'); return; }
    if (isSubmitting) return;
    setIsSubmitting(true);
    const updated = exercise.sets.map((s, i) =>
      i === editingIndex ? { ...s, weight: w, reps: r, rir: parseRir() } : s,
    );
    updateExercise(updated);
    setWeight('');
    setReps('');
    setRir('');
    setEditingIndex(null);
    doneSave();
  }

  function doFinish(setsToUse: LoggedSet[]): void {
    updateExercise(setsToUse, true);
    navigate(listPath);
  }

  function handleFinish(): void {
    const normalizedWeight = Number(weight);
    const normalizedReps = Number(reps);
    const bothValid = Number.isFinite(normalizedWeight) && normalizedWeight > 0
      && Number.isFinite(normalizedReps) && normalizedReps > 0;
    const hasWeight = weight.trim() !== '';
    const hasReps = reps.trim() !== '';
    const bothEmpty = !hasWeight && !hasReps;

    if (bothValid && !isSubmitting) {
      const newSets = handleAddSet();
      if (newSets) {
        doFinish(newSets);
      }
    } else if (!bothEmpty) {
      setShowIncompleteModal(true);
    } else {
      doFinish(exercise.sets);
    }
  }

  function handleDiscardAndFinish(): void {
    setWeight('');
    setReps('');
    setRir('');
    setShowIncompleteModal(false);
    doFinish(exercise.sets);
  }

  function handleUndo(): void {
    if (!lastSetClientId || exercise.sets.length === 0) return;
    const last = exercise.sets[exercise.sets.length - 1];
    if (last?.clientId !== lastSetClientId) return;
    fetch('/api/deleteLastSet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setId: lastSetClientId }) }).catch(() => {});
    updateExercise(exercise.sets.slice(0, -1));
    setLastSetClientId(null);
    setToastVisible(false);
  }

  function formatLastTrainedDate(dateStr: string): string {
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    const [year, month, day] = parts;
    const localDate = new Date(Number(year), Number(month) - 1, Number(day));
    if (isNaN(localDate.getTime())) return dateStr;
    const now = new Date();
    const includeYear = localDate.getFullYear() !== now.getFullYear();
    return localDate.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(includeYear ? { year: 'numeric' } : {}),
    });
  }

  return (
    <div className="page">
      <h1>{exercise.name}</h1>
      <p className="exercise-target">Target: {totalSets} sets &times; {repRange} reps</p>
      <p className="exercise-last-trained">
        <span className="exercise-last-trained-label">Last trained: </span>
        {recentLiftsLoading ? (
          <span className="exercise-last-trained-spinner" aria-hidden />
        ) : lastTrained ? (
          formatLastTrainedDate(lastTrained)
        ) : (
          'n/a'
        )}
      </p>
      <div className="progress-bar-container">
        <div className="progress-bar-label">{loggedSets} / {totalSets} sets completed</div>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${totalSets > 0 ? (loggedSets / totalSets) * 100 : 0}%` }} />
        </div>
      </div>
      <RecentLiftsSection recentLifts={recentLifts} loading={recentLiftsLoading} />
      <SetLoggingForm
        sets={exercise.sets}
        weight={weight}
        reps={reps}
        rir={rir}
        weightRef={weightRef}
        editingIndex={editingIndex}
        isSubmitting={isSubmitting}
        onWeightChange={setWeight}
        onRepsChange={setReps}
        onRirChange={setRir}
        onEdit={(i) => { const s = exercise.sets[i]; setWeight(String(s.weight)); setReps(String(s.reps)); setRir(String(s.rir)); setEditingIndex(i); }}
        onDuplicate={(i) => { const s = exercise.sets[i]; setWeight(String(s.weight)); setReps(String(s.reps)); setRir(String(s.rir)); setEditingIndex(null); }}
        onDelete={(i) => { updateExercise(exercise.sets.filter((_, j) => j !== i)); if (editingIndex === i) { setEditingIndex(null); setWeight(''); setReps(''); setRir(''); } }}
        onAddSet={handleAddSet}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={() => { setEditingIndex(null); setWeight(''); setReps(''); setRir(''); }}
        onFinish={handleFinish}
      />
      <LoadingOverlay visible={isSubmitting} />
      <TemporaryOverlay message={overlayMsg} visible={showOverlay} />
      <SetSavedToast visible={toastVisible} message={toastMsg} onUndo={handleUndo} onDismiss={() => setToastVisible(false)} />
      <IncompleteSetModal visible={showIncompleteModal} onDiscard={handleDiscardAndFinish} onGoBack={() => setShowIncompleteModal(false)} />
    </div>
  );
}

export default ExerciseLogging;
