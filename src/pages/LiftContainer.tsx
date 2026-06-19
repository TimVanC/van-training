import { useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import type { LiftSession } from '../types/session';
import type { Exercise } from '../types/lift';
import { loadSession, saveSession, clearSession } from '../utils/storage';
import { createLiftSession } from '../utils/session';
import { normalizeSessionToRows } from '../utils/normalizeSession';
import { submitWorkout } from '../utils/submitWorkout';
import { resolveWorkoutIdForLiftSession } from '../utils/resolveWorkoutId';
import { supabase } from '../utils/supabaseClient';
import SplitSelection from './SplitSelection';
import DaySelection from './DaySelection';
import ExerciseList from './ExerciseList';
import ExerciseLogging from './ExerciseLogging';
import WorkoutCheckin from '../components/WorkoutCheckin';

interface EmbeddedExercise {
  name: string;
  input_mode: 'weight' | 'plates' | null;
  is_archived: boolean | null;
}

interface WorkoutExerciseRow {
  sets: number;
  rep_range: string;
  order_index: number;
  input_mode: 'weight' | 'plates' | null;
  exercises: EmbeddedExercise | EmbeddedExercise[] | null;
}

async function loadDayExercises(splitName: string, dayName: string): Promise<Exercise[] | null> {
  const userResult = await supabase.auth.getUser();
  const userId = userResult.data.user?.id;
  if (!userId) return null;

  const splitResult = await supabase
    .from('splits')
    .select('id')
    .eq('user_id', userId)
    .eq('name', splitName)
    .maybeSingle();
  const splitId = splitResult.data?.id;
  if (!splitId) return null;

  const workoutResult = await supabase
    .from('workouts')
    .select('id')
    .eq('split_id', splitId)
    .eq('name', dayName)
    .maybeSingle();
  const workoutId = workoutResult.data?.id;
  if (!workoutId) return null;

  const { data: rows } = await supabase
    .from('workout_exercises')
    .select('sets, rep_range, order_index, input_mode, exercises ( name, input_mode, is_archived )')
    .eq('workout_id', workoutId)
    .order('order_index', { ascending: true });

  const exercises: Exercise[] = [];
  for (const row of (rows ?? []) as WorkoutExerciseRow[]) {
    const exerciseRecord = Array.isArray(row.exercises) ? row.exercises[0] : row.exercises;
    if (!exerciseRecord) continue;
    // Archived exercises are hidden from the logging UI.
    if (exerciseRecord.is_archived) continue;
    // Per-prescription override wins; otherwise inherit the exercise's input mode.
    const effectiveMode = row.input_mode ?? exerciseRecord.input_mode ?? 'weight';
    const exercise: Exercise = {
      exercise: exerciseRecord.name,
      sets: row.sets,
      repRange: row.rep_range,
    };
    if (effectiveMode === 'plates') exercise.inputMode = 'plates';
    exercises.push(exercise);
  }
  return exercises;
}

function LiftContainer(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const isLiftRoot = location.pathname === '/lift' || location.pathname === '/lift/';

  const [session, setSession] = useState<LiftSession | null>(() => {
    const saved = loadSession();
    if (!saved || saved.activityType !== 'Lift') return null;
    if (isLiftRoot) return null;
    return saved;
  });

  const [showResume, setShowResume] = useState<boolean>(() => {
    if (!isLiftRoot) return false;
    const saved = loadSession();
    return saved !== null && saved.activityType === 'Lift';
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [navigatingToHome, setNavigatingToHome] = useState(false);
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinContext, setCheckinContext] = useState<{ split: string; day: string } | null>(null);

  function handleResume(): void {
    const saved = loadSession();
    if (!saved || saved.activityType !== 'Lift') return;
    setSession(saved);
    setShowResume(false);
    navigate(`/lift/${encodeURIComponent(saved.split)}/${encodeURIComponent(saved.day)}`);
  }

  function handleDiscard(): void {
    clearSession();
    setShowResume(false);
    setSession(null);
  }

  async function handleDaySelect(splitName: string, dayName: string): Promise<void> {
    const exercises = await loadDayExercises(splitName, dayName);
    if (!exercises || exercises.length === 0) return;

    const newSession = createLiftSession(splitName, dayName, exercises);
    setSession(newSession);
    saveSession(newSession);
    navigate(`/lift/${encodeURIComponent(splitName)}/${encodeURIComponent(dayName)}`);
  }

  function handleUpdateSession(updated: LiftSession): void {
    setSession(updated);
    saveSession(updated);
  }

  async function handleSubmit(): Promise<void> {
    if (!session || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    const workoutId = await resolveWorkoutIdForLiftSession(session);
    if (!workoutId) {
      setSubmitError('Could not find this workout. Try again or contact support.');
      setIsSubmitting(false);
      return;
    }
    const rows = normalizeSessionToRows(session);
    const ok = await submitWorkout(rows, workoutId, session.notes);
    if (!ok) {
      setSubmitError('Submission failed. Please try again.');
      setIsSubmitting(false);
      return;
    }
    // Capture the split/day before clearing the session so the checkin
    // overlay still has context to display and persist.
    setCheckinContext({ split: session.split, day: session.day });
    clearSession();
    setSession(null);
    setIsSubmitting(false);
    setShowCheckin(true);
  }

  function handleCheckinComplete(): void {
    setShowCheckin(false);
    setCheckinContext(null);
    setNavigatingToHome(true);
    navigate('/');
  }

  if (showResume) {
    return (
      <div className="page">
        <h1>Resume unfinished workout?</h1>
        <div className="button-list">
          <button className="nav-button" onClick={handleResume}>Resume</button>
          <button className="nav-button" onClick={handleDiscard}>Discard</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route index element={<SplitSelection />} />
        <Route path=":splitName" element={<DaySelection onDaySelect={handleDaySelect} />} />
        <Route path=":splitName/:dayName" element={
          session
            ? <ExerciseList session={session} onUpdateSession={handleUpdateSession} onSubmit={handleSubmit} isSubmitting={isSubmitting} submitError={submitError ?? undefined} onRetry={handleSubmit} />
            : navigatingToHome ? <Navigate to="/" replace /> : <Navigate to="/lift" replace />
        } />
        <Route path=":splitName/:dayName/:exerciseIndex" element={
          session
            ? <ExerciseLogging session={session} onUpdateSession={handleUpdateSession} />
            : navigatingToHome ? <Navigate to="/" replace /> : <Navigate to="/lift" replace />
        } />
      </Routes>
      {showCheckin && checkinContext && (
        <WorkoutCheckin
          splitName={checkinContext.split}
          dayName={checkinContext.day}
          onComplete={handleCheckinComplete}
        />
      )}
    </>
  );
}

export default LiftContainer;
