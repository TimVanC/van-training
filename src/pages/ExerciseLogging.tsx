import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { LiftSession, LoggedSet, RecommendedPlanSet, RecentLift, RecentLiftsResponse } from '../types/session';
import TemporaryOverlay from '../components/TemporaryOverlay';
import SetLoggingForm from '../components/SetLoggingForm';
import LoadingOverlay from '../components/LoadingOverlay';
import IncompleteSetModal from '../components/IncompleteSetModal';
import RecentLiftsSection from '../components/RecentLiftsSection';
import { exerciseAlternates } from '../data/exerciseAlternates';
import { validateLiftWeight, validateReps } from '../utils/validateSetInput';
import { supabase } from '../utils/supabaseClient';

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
  const [plate45, setPlate45] = useState('0');
  const [plate35, setPlate35] = useState('0');
  const [plate25, setPlate25] = useState('0');
  const [plate10, setPlate10] = useState('0');
  const [plate5, setPlate5] = useState('0');
  const [sled, setSled] = useState('0');
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
  const [selectedExerciseName, setSelectedExerciseName] = useState(
    exercise?.activeName ?? exercise?.name ?? '',
  );
  const [showSwapOptions, setShowSwapOptions] = useState(false);
  const [setInputError, setSetInputError] = useState<string | null>(null);
  const overlayTimer = useRef<number>(0);

  function clearSetInputError(): void {
    setSetInputError(null);
  }

  useEffect(() => {
    const queryExerciseName = selectedExerciseName.trim();
    if (!queryExerciseName) return;
    setRecentLiftsLoading(true);
    setRecentLifts([]);
    setLastTrained(undefined);
    setPreviousNote(undefined);
    setRecommendedPlan(null);
    const targetSets = exercise.targetSets ?? 3;
    const repRangeQuery = exercise.targetRepRange ?? (exercise.targetReps != null ? String(exercise.targetReps) : '');
    (async () => {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const response = await fetch(
          `/api/getRecentLifts?exercise=${encodeURIComponent(queryExerciseName)}&targetSets=${targetSets}&repRange=${encodeURIComponent(repRangeQuery)}`,
          {
            cache: 'no-store',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        const data: RecentLiftsResponse = response.ok ? await response.json() : { sets: [] };
        const mappedRecentLifts = Array.isArray(data.sets) ? data.sets : [];
        const mappedLastTrained = typeof data.lastTrained === 'string' && data.lastTrained ? data.lastTrained : undefined;
        const mappedPreviousNote = typeof data.previousNote === 'string' && data.previousNote ? data.previousNote : undefined;
        const mappedRecommendedPlan = Array.isArray(data.recommendedPlan) ? data.recommendedPlan : null;
        setRecentLifts(mappedRecentLifts);
        setLastTrained(mappedLastTrained);
        setPreviousNote(mappedPreviousNote);
        setRecommendedPlan(mappedRecommendedPlan);
      } catch {
      } finally {
        setRecentLiftsLoading(false);
      }
    })();
  }, [selectedExerciseName, exercise?.targetSets]);

  useEffect(() => {
    if (!exercise?.name) return;
    setSelectedExerciseName(exercise.activeName ?? exercise.name);
    setShowSwapOptions(false);
  }, [exercise?.name, exercise?.activeName, session.startedAt]);

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
  const baseExerciseName = exercise.name;
  const alternateExercises = exerciseAlternates[baseExerciseName] ?? [];
  const canSwapExercise = alternateExercises.length > 0;

  function computePlateWeight(): number {
    const p45 = Number(plate45);
    const p35 = Number(plate35);
    const p25 = Number(plate25);
    const p10 = Number(plate10);
    const p5 = Number(plate5);
    const s = Number(sled);
    const perSide = (45 * (Number.isFinite(p45) ? p45 : 0))
      + (35 * (Number.isFinite(p35) ? p35 : 0))
      + (25 * (Number.isFinite(p25) ? p25 : 0))
      + (10 * (Number.isFinite(p10) ? p10 : 0))
      + (5 * (Number.isFinite(p5) ? p5 : 0));
    return perSide * 2 + (Number.isFinite(s) ? s : 0);
  }

  function clearPlateState(): void {
    setPlate45('0');
    setPlate35('0');
    setPlate25('0');
    setPlate10('0');
    setPlate5('0');
    setSled('0');
  }

  function flashOverlay(msg: string): void {
    setOverlayMsg(msg);
    setShowOverlay(true);
    window.clearTimeout(overlayTimer.current);
    overlayTimer.current = window.setTimeout(() => setShowOverlay(false), 1050);
  }

  function updateExercise(updatedSets: LoggedSet[], completed?: boolean): void {
    const updated = session.exercises.map((ex, i) =>
      i === index
        ? {
          ...ex,
          activeName: selectedExerciseName,
          sets: updatedSets,
          completed: completed ?? ex.completed,
        }
        : ex,
    );
    onUpdateSession({ ...session, exercises: updated });
  }

  function handleExerciseSwap(nextExercise: string): void {
    setSelectedExerciseName(nextExercise);
    const updated = session.exercises.map((ex, i) =>
      i === index ? { ...ex, activeName: nextExercise } : ex,
    );
    onUpdateSession({ ...session, exercises: updated });
  }

  function parseRir(): number {
    return rir.trim() === '' ? 0 : (parseInt(rir, 10) || 0);
  }

  function parseWeightInput(value: string): number {
    return parseFloat(value);
  }

  function doneSave(): void {
    weightRef.current?.focus({ preventScroll: true });
    setTimeout(() => setIsSubmitting(false), 500);
  }

  function handleAddSet(): LoggedSet[] | undefined {
    let normalizedWeight: number;
    let p45 = 0;
    let p35 = 0;
    let p25 = 0;
    let p10 = 0;
    let p5 = 0;
    let s = 0;
    if (isPlatesMode) {
      p45 = Number(plate45);
      p35 = Number(plate35);
      p25 = Number(plate25);
      p10 = Number(plate10);
      p5 = Number(plate5);
      s = Number(sled);
      if (!Number.isFinite(p45) || p45 < 0 || !Number.isFinite(p35) || p35 < 0 || !Number.isFinite(p25) || p25 < 0 || !Number.isFinite(p10) || p10 < 0 || !Number.isFinite(p5) || p5 < 0 || !Number.isFinite(s) || s < 0) {
        clearSetInputError();
        flashOverlay('Plate counts and sled weight must be 0 or greater');
        return undefined;
      }
      normalizedWeight = computePlateWeight();
    } else {
      normalizedWeight = parseWeightInput(weight);
      if (!Number.isFinite(normalizedWeight)) {
        clearSetInputError();
        flashOverlay('Weight and Reps are required');
        return undefined;
      }
    }
    const normalizedReps = Number(reps);
    const normalizedRir = rir === '' ? 0 : Number(rir);
    if (!Number.isFinite(normalizedReps) || normalizedReps <= 0) {
      clearSetInputError();
      flashOverlay('Reps are required and must be greater than 0');
      return undefined;
    }
    const repsCheck = validateReps(normalizedReps);
    if (!repsCheck.valid) {
      setSetInputError(repsCheck.message ?? 'Invalid reps.');
      return undefined;
    }
    const weightCheck = validateLiftWeight(normalizedWeight);
    if (!weightCheck.valid) {
      setSetInputError(weightCheck.message ?? 'Invalid weight.');
      return undefined;
    }
    setSetInputError(null);
    if (isSubmitting) return undefined;
    setIsSubmitting(true);
    const rid = Number.isFinite(normalizedRir) && normalizedRir >= 0 ? normalizedRir : 0;
    const newSet: LoggedSet = isPlatesMode
      ? {
        weight: normalizedWeight,
        reps: normalizedReps,
        rir: rid,
        plate45: Math.trunc(p45),
        plate35: Math.trunc(p35),
        plate25: Math.trunc(p25),
        plate10: Math.trunc(p10),
        plate5: Math.trunc(p5),
        sled: s,
        plateData: {
          plate45: Math.trunc(p45),
          plate35: Math.trunc(p35),
          plate25: Math.trunc(p25),
          plate10: Math.trunc(p10),
          plate5: Math.trunc(p5),
          sled: s,
        },
      }
      : { weight: normalizedWeight, reps: normalizedReps, rir: rid };
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
    const w = parseWeightInput(weight);
    const r = Number(reps);
    if (!Number.isFinite(w)) {
      clearSetInputError();
      flashOverlay('Weight is required');
      return;
    }
    if (!Number.isFinite(r) || r <= 0) {
      clearSetInputError();
      flashOverlay('Reps must be greater than 0');
      return;
    }
    const repsCheck = validateReps(r);
    if (!repsCheck.valid) {
      setSetInputError(repsCheck.message ?? 'Invalid reps.');
      return;
    }
    const weightCheck = validateLiftWeight(w);
    if (!weightCheck.valid) {
      setSetInputError(weightCheck.message ?? 'Invalid weight.');
      return;
    }
    setSetInputError(null);
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
      const p5 = Number(plate5);
      const s = Number(sled);
      bothValid = Number.isFinite(p45) && p45 >= 0 && Number.isFinite(p35) && p35 >= 0 && Number.isFinite(p25) && p25 >= 0 && Number.isFinite(p10) && p10 >= 0 && Number.isFinite(p5) && p5 >= 0 && Number.isFinite(s) && s >= 0 && Number.isFinite(normalizedReps) && normalizedReps > 0;
      const hasReps = reps.trim() !== '';
      const hasPlates = p45 > 0 || p35 > 0 || p25 > 0 || p10 > 0 || p5 > 0 || s > 0;
      bothEmpty = !hasReps && !hasPlates;
    } else {
      const normalizedWeight = parseWeightInput(weight);
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
      <h1>{selectedExerciseName}</h1>
      {selectedExerciseName !== baseExerciseName && (
        <p className="exercise-substitute-note">(substitute for {baseExerciseName})</p>
      )}
      <p className="exercise-target">Target: {totalSets} sets &times; {repRange} reps</p>
      {canSwapExercise && (
        <div className="exercise-swap">
          <button
            type="button"
            className="swap-button"
            onClick={() => setShowSwapOptions((prev) => !prev)}
            disabled={isSubmitting}
          >
            Swap Exercise
          </button>
          {showSwapOptions && (
            <label className="input-label exercise-swap-label">
              Select exercise
              <select
                className="input-field exercise-swap-select"
                value={selectedExerciseName}
                onChange={(e) => handleExerciseSwap(e.target.value)}
                disabled={isSubmitting}
              >
                <option value={baseExerciseName}>{baseExerciseName}</option>
                {alternateExercises.map((alt) => (
                  <option key={alt} value={alt}>{alt}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
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
        inputMode={inputMode}
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
        plate5={plate5}
        sled={sled}
        onWeightChange={(v) => { clearSetInputError(); setWeight(v); }}
        onRepsChange={(v) => { clearSetInputError(); setReps(v); }}
        onRirChange={(v) => { clearSetInputError(); setRir(v); }}
        onPlate45Change={(v) => { clearSetInputError(); setPlate45(v); }}
        onPlate35Change={(v) => { clearSetInputError(); setPlate35(v); }}
        onPlate25Change={(v) => { clearSetInputError(); setPlate25(v); }}
        onPlate10Change={(v) => { clearSetInputError(); setPlate10(v); }}
        onPlate5Change={(v) => { clearSetInputError(); setPlate5(v); }}
        onSledChange={(v) => { clearSetInputError(); setSled(v); }}
        editingIndex={editingIndex}
        isSubmitting={isSubmitting}
        inputError={setInputError}
        onEdit={(i) => {
          clearSetInputError();
          const s = exercise.sets[i];
          setWeight(String(s.weight));
          setReps(String(s.reps));
          setRir(String(s.rir));
          if (isPlatesMode) {
            const plateData = s.plateData;
            setPlate45(s.plate45 != null ? String(s.plate45) : (plateData ? String(plateData.plate45) : '0'));
            setPlate35(s.plate35 != null ? String(s.plate35) : (plateData ? String(plateData.plate35) : '0'));
            setPlate25(s.plate25 != null ? String(s.plate25) : (plateData ? String(plateData.plate25) : '0'));
            setPlate10(s.plate10 != null ? String(s.plate10) : (plateData ? String(plateData.plate10) : '0'));
            setPlate5(s.plate5 != null ? String(s.plate5) : (plateData ? String(plateData.plate5) : '0'));
            setSled(s.sled != null ? String(s.sled) : (plateData ? String(plateData.sled) : '0'));
          }
          setEditingIndex(i);
        }}
        onDuplicate={(i) => {
          clearSetInputError();
          const s = exercise.sets[i];
          setWeight(String(s.weight));
          setReps(String(s.reps));
          setRir(String(s.rir));
          setEditingIndex(null);
          if (isPlatesMode) {
            const plateData = s.plateData;
            setPlate45(s.plate45 != null ? String(s.plate45) : (plateData ? String(plateData.plate45) : '0'));
            setPlate35(s.plate35 != null ? String(s.plate35) : (plateData ? String(plateData.plate35) : '0'));
            setPlate25(s.plate25 != null ? String(s.plate25) : (plateData ? String(plateData.plate25) : '0'));
            setPlate10(s.plate10 != null ? String(s.plate10) : (plateData ? String(plateData.plate10) : '0'));
            setPlate5(s.plate5 != null ? String(s.plate5) : (plateData ? String(plateData.plate5) : '0'));
            setSled(s.sled != null ? String(s.sled) : (plateData ? String(plateData.sled) : '0'));
          }
        }}
        onDelete={(i) => {
          clearSetInputError();
          updateExercise(exercise.sets.filter((_, j) => j !== i));
          if (editingIndex === i) {
            setEditingIndex(null);
            setWeight('');
            setReps('');
            setRir('');
            if (isPlatesMode) clearPlateState();
          }
        }}
        onAddSet={handleAddSet}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={() => {
          clearSetInputError();
          setEditingIndex(null);
          setWeight('');
          setReps('');
          setRir('');
          if (isPlatesMode) clearPlateState();
        }}
        onFinish={handleFinish}
      />
      <LoadingOverlay visible={isSubmitting} />
      <TemporaryOverlay message={overlayMsg} visible={showOverlay} />
      <IncompleteSetModal visible={showIncompleteModal} onDiscard={handleDiscardAndFinish} onGoBack={() => setShowIncompleteModal(false)} />
    </div>
  );
}

export default ExerciseLogging;
