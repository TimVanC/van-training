import { useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import type { LiftSession } from '../types/session';
import type { Split } from '../types/lift';
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
import splits from '../data/splits';

const splitItems: Split[] = splits;

function normalizeExerciseName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  if (String(e.code ?? '') === '42703') return true;
  const message = String(e.message ?? '');
  const details = String(e.details ?? '');
  return message.includes(columnName) || details.includes(columnName);
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

  async function fetchLatestSwapDefaults(userId: string, baseExerciseNames: string[]): Promise<Map<string, string>> {
    const normalizedToOriginal = new Map<string, string>();
    for (const name of baseExerciseNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const key = normalizeExerciseName(trimmed);
      if (!normalizedToOriginal.has(key)) normalizedToOriginal.set(key, trimmed);
    }

    const uniqueBaseNames = Array.from(normalizedToOriginal.values());
    if (uniqueBaseNames.length === 0) return new Map<string, string>();

    const primaryResult = await supabase
      .from('exercise_swaps')
      .select('base_exercise_name,swap_exercise_name,updated_at,created_at')
      .eq('user_id', userId)
      .in('base_exercise_name', uniqueBaseNames)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false });
    let primaryData: Array<{ base_exercise_name?: unknown; swap_exercise_name?: unknown }> | null =
      primaryResult.data as Array<{ base_exercise_name?: unknown; swap_exercise_name?: unknown }> | null;
    let primaryError: unknown = primaryResult.error;
    if (primaryError && isMissingColumnError(primaryError, 'updated_at')) {
      const fallbackResult = await supabase
        .from('exercise_swaps')
        .select('base_exercise_name,swap_exercise_name,created_at')
        .eq('user_id', userId)
        .in('base_exercise_name', uniqueBaseNames)
        .order('created_at', { ascending: false });
      primaryData = fallbackResult.data as Array<{ base_exercise_name?: unknown; swap_exercise_name?: unknown }> | null;
      primaryError = fallbackResult.error;
    }

    if (!primaryError && Array.isArray(primaryData)) {
      const byBase = new Map<string, string>();
      for (const row of primaryData) {
        const baseName = typeof row.base_exercise_name === 'string' ? row.base_exercise_name.trim() : '';
        const swapName = typeof row.swap_exercise_name === 'string' ? row.swap_exercise_name.trim() : '';
        if (!baseName || !swapName) continue;
        const key = normalizeExerciseName(baseName);
        if (!byBase.has(key)) byBase.set(key, swapName);
      }
      return byBase;
    }

    if (!isMissingColumnError(primaryError, 'swap_exercise_name')) {
      return new Map<string, string>();
    }

    const baseExerciseRows = await supabase
      .from('exercises')
      .select('id,name')
      .in('name', uniqueBaseNames);
    if (baseExerciseRows.error || !Array.isArray(baseExerciseRows.data) || baseExerciseRows.data.length === 0) {
      return new Map<string, string>();
    }

    const baseNameById = new Map<string, string>();
    const baseIds: string[] = [];
    for (const row of baseExerciseRows.data) {
      const id = String(row.id ?? '').trim();
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (!id || !name) continue;
      baseNameById.set(id, name);
      baseIds.push(id);
    }
    if (baseIds.length === 0) return new Map<string, string>();

    const legacyRows = await supabase
      .from('exercise_swaps')
      .select('original_exercise_id,substitute_exercise_id,created_at')
      .eq('user_id', userId)
      .in('original_exercise_id', baseIds)
      .order('created_at', { ascending: false });
    if (legacyRows.error || !Array.isArray(legacyRows.data) || legacyRows.data.length === 0) {
      return new Map<string, string>();
    }

    const latestSubIdByOriginalId = new Map<string, string>();
    const substituteIds: string[] = [];
    for (const row of legacyRows.data) {
      const originalId = String(row.original_exercise_id ?? '').trim();
      const substituteId = String(row.substitute_exercise_id ?? '').trim();
      if (!originalId || !substituteId) continue;
      if (latestSubIdByOriginalId.has(originalId)) continue;
      latestSubIdByOriginalId.set(originalId, substituteId);
      substituteIds.push(substituteId);
    }
    if (substituteIds.length === 0) return new Map<string, string>();

    const substituteRows = await supabase
      .from('exercises')
      .select('id,name')
      .in('id', substituteIds);
    if (substituteRows.error || !Array.isArray(substituteRows.data)) {
      return new Map<string, string>();
    }

    const substituteNameById = new Map<string, string>();
    for (const row of substituteRows.data) {
      const id = String(row.id ?? '').trim();
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (id && name) substituteNameById.set(id, name);
    }

    const byBase = new Map<string, string>();
    for (const [originalId, substituteId] of latestSubIdByOriginalId.entries()) {
      const baseName = baseNameById.get(originalId);
      const swapName = substituteNameById.get(substituteId);
      if (!baseName || !swapName) continue;
      byBase.set(normalizeExerciseName(baseName), swapName);
    }
    return byBase;
  }

  async function handleDaySelect(splitName: string, dayName: string): Promise<void> {
    const split = splitItems.find((s) => s.split === splitName);
    if (!split) return;
    const exercises = split.days[dayName];
    if (!exercises) return;

    const newSession = createLiftSession(splitName, dayName, exercises);
    try {
      const userResult = await supabase.auth.getUser();
      const userId = userResult.data.user?.id;
      if (userId) {
        const swapByBaseName = await fetchLatestSwapDefaults(
          userId,
          newSession.exercises.map((exercise) => exercise.name),
        );
        if (swapByBaseName.size > 0) {
          newSession.exercises = newSession.exercises.map((exercise) => {
            const swapName = swapByBaseName.get(normalizeExerciseName(exercise.name));
            if (!swapName) return exercise;
            return { ...exercise, activeName: swapName };
          });
        }
      }
    } catch {
      // If swap defaults fail to load, keep workout creation unblocked.
    }

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
    setNavigatingToHome(true);
    clearSession();
    setSession(null);
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
    </>
  );
}

export default LiftContainer;
