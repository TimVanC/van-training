import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { LiftSession, LoggedSet, RecommendedPlanSet, RecentLift, RecentLiftsResponse } from '../types/session';
import TemporaryOverlay from '../components/TemporaryOverlay';
import SetLoggingForm from '../components/SetLoggingForm';
import LoadingOverlay from '../components/LoadingOverlay';
import IncompleteSetModal from '../components/IncompleteSetModal';
import RecentLiftsSection from '../components/RecentLiftsSection';

interface ExerciseLoggingProps {
  session: LiftSession;
  onUpdateSession: (session: LiftSession) => void;
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
  const [plate45, setPlate45] = useState('');
  const [plate35, setPlate35] = useState('');
  const [plate25, setPlate25] = useState('');
  const [plate10, setPlate10] = useState('');
  const [sled, setSled] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [overlayMsg, setOverlayMsg] = useState('');
  const [showOverlay, setShowOverlay] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showIncompleteModal, setShowIncompleteModal] = useState(false);
  const [recentLifts, setRecentLifts] = useState<RecentLift[]>([]);
  const [lastTrained, setLastTrained] = useState<string | undefined>();
  const [previousNote, setPreviousNote] = useState<string | undefined>();
  const [recommendedPlan, setRecommendedPlan] = useState<RecommendedPlanSet[] | null>(null);
  const [recentLiftsLoading, setRecentLiftsLoading] = useState(false);
  const overlayTimer = useRef<number>(0);

  useEffect(() => {
    if (!exercise?.name) return;
    setRecentLiftsLoading(true);
    setRecentLifts([]);
    setLastTrained(undefined);
    setPreviousNote(undefined);
    setRecommendedPlan(null);
    const targetSets = exercise.targetSets ?? 3;
    fetch(`/api/getRecentLifts?exercise=${encodeURIComponent(exercise.name)}&targetSets=${targetSets}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { sets: [] }))
      .then((data: RecentLiftsResponse) => {
        setRecentLifts(Array.isArray(data.sets) ? data.sets : []);
        setLastTrained(typeof data.lastTrained === 'string' && data.lastTrained ? data.lastTrained : undefined);
        setPreviousNote(typeof data.previousNote === 'string' && data.previousNote ? data.previousNote : undefined);
        setRecommendedPlan(Array.isArray(data.recommendedPlan) ? data.recommendedPlan : null);
      })
      .catch(() => {})
      .finally(() => setRecentLiftsLoading(false));
  }, [exercise?.name, exercise?.targetSets]);

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
  const inputMode = exercise.inputMode ?? 'weight';
  const isPlatesMode = inputMode === 'plates';

  function computePlateWeight(): number {
    const p45 = Number(plate45);
    const p35 = Number(plate35);
    const p25 = Number(plate25);
    const p10 = Number(plate10);
    const s = Number(sled);
    const perSide = (45 * (Number.isFinite(p45) ? p45 : 0)) + (35 * (Number.isFinite(p35) ? p35 : 0)) + (25 * (Number.isFinite(p25) ? p25 : 0)) + (10 * (Number.isFinite(p10) ? p10 : 0));
    return perSide * 2 + (Number.isFinite(s) ? s : 0);
  }

  function clearPlateState(): void {
    setPlate45('');
    setPlate35('');
    setPlate25('');
    setPlate10('');
    setSled('');
  }

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
    let normalizedWeight: number;
    if (isPlatesMode) {
      const p45 = Number(plate45);
      const p35 = Number(plate35);
      const p25 = Number(plate25);
      const p10 = Number(plate10);
      const s = Number(sled);
      if (!Number.isFinite(p45) || p45 < 0 || !Number.isFinite(p35) || p35 < 0 || !Number.isFinite(p25) || p25 < 0 || !Number.isFinite(p10) || p10 < 0 || !Number.isFinite(s) || s < 0) {
        flashOverlay('Plate counts and sled weight must be 0 or greater');
        return undefined;
      }
      normalizedWeight = computePlateWeight();
    } else {
      normalizedWeight = Number(weight);
      if (!Number.isFinite(normalizedWeight)) {
        flashOverlay('Weight and Reps are required');
        return undefined;
      }
    }
    const normalizedReps = Number(reps);
    const normalizedRir = rir === '' ? 0 : Number(rir);
    if (!Number.isFinite(normalizedReps) || normalizedReps <= 0) {
      flashOverlay('Reps are required and must be greater than 0');
      return undefined;
    }
    if (isSubmitting) return undefined;
    setIsSubmitting(true);
    const rid = Number.isFinite(normalizedRir) && normalizedRir >= 0 ? normalizedRir : 0;
    const newSet: LoggedSet = { weight: normalizedWeight, reps: normalizedReps, rir: rid };
    const newSets = [...exercise.sets, newSet];
    updateExercise(newSets);
    if (isPlatesMode) clearPlateState();
    else setWeight('');
    setReps('');
    setRir('');
    doneSave();
    return newSets;
  }

  function handleSaveEdit(): void {
    if (editingIndex === null) return;
    const w = Number(weight);
    const r = Number(reps);
    if (!Number.isFinite(w)) { flashOverlay('Weight is required'); return; }
    if (!Number.isFinite(r) || r <= 0) { flashOverlay('Reps must be greater than 0'); return; }
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
    const normalizedReps = Number(reps);
    let bothValid: boolean;
    let bothEmpty: boolean;
    if (isPlatesMode) {
      const p45 = Number(plate45);
      const p35 = Number(plate35);
      const p25 = Number(plate25);
      const p10 = Number(plate10);
      const s = Number(sled);
      bothValid = Number.isFinite(p45) && p45 >= 0 && Number.isFinite(p35) && p35 >= 0 && Number.isFinite(p25) && p25 >= 0 && Number.isFinite(p10) && p10 >= 0 && Number.isFinite(s) && s >= 0 && Number.isFinite(normalizedReps) && normalizedReps > 0;
      const hasReps = reps.trim() !== '';
      const hasPlates = plate45.trim() !== '' || plate35.trim() !== '' || plate25.trim() !== '' || plate10.trim() !== '' || sled.trim() !== '';
      bothEmpty = !hasReps && !hasPlates;
    } else {
      const normalizedWeight = Number(weight);
      bothValid = Number.isFinite(normalizedWeight) && Number.isFinite(normalizedReps) && normalizedReps > 0;
      const hasWeight = weight.trim() !== '';
      const hasReps = reps.trim() !== '';
      bothEmpty = !hasWeight && !hasReps;
    }

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
    if (isPlatesMode) clearPlateState();
    setShowIncompleteModal(false);
    doFinish(exercise.sets);
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
      <RecentLiftsSection
        recentLifts={recentLifts}
        loading={recentLiftsLoading}
        previousNote={previousNote}
        recommendedPlan={recommendedPlan}
        targetSets={totalSets}
      />
      <SetLoggingForm
        sets={exercise.sets}
        weight={weight}
        reps={reps}
        rir={rir}
        weightRef={weightRef}
        inputMode={inputMode}
        plate45={plate45}
        plate35={plate35}
        plate25={plate25}
        plate10={plate10}
        sled={sled}
        onWeightChange={setWeight}
        onRepsChange={setReps}
        onRirChange={setRir}
        onPlate45Change={setPlate45}
        onPlate35Change={setPlate35}
        onPlate25Change={setPlate25}
        onPlate10Change={setPlate10}
        onSledChange={setSled}
        editingIndex={editingIndex}
        isSubmitting={isSubmitting}
        onEdit={(i) => { const s = exercise.sets[i]; setWeight(String(s.weight)); setReps(String(s.reps)); setRir(String(s.rir)); setEditingIndex(i); }}
        onDuplicate={(i) => { const s = exercise.sets[i]; setWeight(String(s.weight)); setReps(String(s.reps)); setRir(String(s.rir)); setEditingIndex(null); if (isPlatesMode) clearPlateState(); }}
        onDelete={(i) => { updateExercise(exercise.sets.filter((_, j) => j !== i)); if (editingIndex === i) { setEditingIndex(null); setWeight(''); setReps(''); setRir(''); if (isPlatesMode) clearPlateState(); } }}
        onAddSet={handleAddSet}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={() => { setEditingIndex(null); setWeight(''); setReps(''); setRir(''); if (isPlatesMode) clearPlateState(); }}
        onFinish={handleFinish}
      />
      <LoadingOverlay visible={isSubmitting} />
      <TemporaryOverlay message={overlayMsg} visible={showOverlay} />
      <IncompleteSetModal visible={showIncompleteModal} onDiscard={handleDiscardAndFinish} onGoBack={() => setShowIncompleteModal(false)} />
    </div>
  );
}

export default ExerciseLogging;
