import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import type { LiftSession } from '../types/session';
import type { Exercise } from '../types/lift';
import { loadSession, saveSession, clearSession } from '../utils/storage';
import { createLiftSession, mergeLiftSessionWithTemplate } from '../utils/session';
import { normalizeSessionToRows } from '../utils/normalizeSession';
import { submitWorkout } from '../utils/submitWorkout';
import { resolveWorkoutIdForLiftSession } from '../utils/resolveWorkoutId';
import { supabase } from '../utils/supabaseClient';
import { invalidateDashboardCache } from '../hooks/useDashboardData';
import SplitSelection from './SplitSelection';
import DaySelection, { type DaySelectResult } from './DaySelection';
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

/**
 * Resolves the session a day/exercise route should render.
 *
 * The in-memory `session` state is preferred, but it may not be committed yet
 * on the first render after `handleDaySelect` calls `setSession` + `navigate`
 * together (React batches the updates, and on some devices the route renders
 * before the state commit lands). Because `saveSession` is written to
 * localStorage synchronously *before* navigation, the saved session is a
 * reliable fallback. We only trust either source when it matches the URL we're
 * actually on, so a stale saved session can never leak into the wrong route.
 */
function resolveRouteSession(
  stateSession: LiftSession | null,
  splitName: string | undefined,
  dayName: string | undefined,
): LiftSession | null {
  if (!splitName || !dayName) return null;
  if (stateSession && stateSession.split === splitName && stateSession.day === dayName) {
    return stateSession;
  }
  const saved = loadSession();
  if (
    saved &&
    saved.activityType === 'Lift' &&
    saved.split === splitName &&
    saved.day === dayName
  ) {
    return saved;
  }
  return null;
}

/**
 * Route guard that renders `children(session)` when a session matching the
 * current URL is available, otherwise redirects away. Reading route params
 * here (rather than trusting only in-memory state) makes day navigation
 * resilient to React's state-commit timing.
 */
function SessionRoute({
  stateSession,
  navigatingToHome,
  children,
}: {
  stateSession: LiftSession | null;
  navigatingToHome: boolean;
  children: (session: LiftSession) => React.JSX.Element;
}): React.JSX.Element {
  const { splitName, dayName } = useParams();
  const session = resolveRouteSession(stateSession, splitName, dayName);
  if (session) return children(session);
  return navigatingToHome ? <Navigate to="/" replace /> : <Navigate to="/lift" replace />;
}

function LiftContainer(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const isLiftRoot = location.pathname === '/lift' || location.pathname === '/lift/';

  const [session, setSession] = useState<LiftSession | null>(() => {
    const saved = loadSession();
    if (!saved || saved.activityType !== 'Lift') return null;
    if (isLiftRoot) return null;
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    // On /lift or /lift/:splitName (selection screens) — don't restore.
    if (pathParts.length < 3) return null;
    const urlSplit = decodeURIComponent(pathParts[1]);
    const urlDay = decodeURIComponent(pathParts[2]);
    // Only restore into state if the saved session matches the URL we're on.
    // A mismatch is NOT grounds to delete it: the saved session is the user's
    // unfinished workout, and the resume prompt below will offer it back.
    // SessionRoute redirects mismatched URLs to /lift, which shows that prompt.
    if (saved.split !== urlSplit || saved.day !== urlDay) return null;
    return saved;
  });

  // The saved lift session, read fresh each render (a cheap localStorage
  // read) so the prompt below always reflects what is actually on disk.
  const savedRaw = loadSession();
  const savedLift: LiftSession | null = savedRaw && savedRaw.activityType === 'Lift' ? savedRaw : null;

  // On the /lift root, offer to resume whenever an unfinished workout is
  // saved (derived rather than mount-time state so a redirect back to the
  // root — e.g. from a mismatched day URL — shows the prompt too).
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const showResume = isLiftRoot && !resumeDismissed && savedLift !== null;

  // Set when the user taps a day on the day picker while an unfinished
  // workout is saved. Every entry point that used to skip the /lift root
  // (the home-screen Start button, the workout screen's back button) lands
  // on the day picker, so the resume prompt has to live here too or a single
  // tap silently overwrites the saved sets.
  const [pendingDay, setPendingDay] = useState<{ split: string; day: string } | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  // On the day-list view, re-fetch the day's template and fold any changes
  // into the active session (see mergeLiftSessionWithTemplate). This lets a
  // mid-workout template edit appear on refresh without discarding logged
  // sets. Scoped to the list route only, so exercise indexes can't shift
  // underneath the logging screen.
  useEffect(() => {
    const pathParts = location.pathname.split('/').filter(Boolean);
    if (pathParts.length !== 3 || pathParts[0] !== 'lift') return;
    const urlSplit = decodeURIComponent(pathParts[1]);
    const urlDay = decodeURIComponent(pathParts[2]);
    let cancelled = false;
    void (async () => {
      const template = await loadDayExercises(urlSplit, urlDay);
      if (cancelled || !template || template.length === 0) return;
      setSession((prev) => {
        // Prefer committed state; fall back to the saved session for the
        // first render after a refresh, mirroring resolveRouteSession.
        let base: LiftSession | null = null;
        if (prev && prev.split === urlSplit && prev.day === urlDay) {
          base = prev;
        } else {
          const saved = loadSession();
          if (
            saved &&
            saved.activityType === 'Lift' &&
            saved.split === urlSplit &&
            saved.day === urlDay
          ) {
            base = saved;
          }
        }
        if (!base) return prev;
        const mergedSession = mergeLiftSessionWithTemplate(base, template);
        if (mergedSession !== base) saveSession(mergedSession);
        return mergedSession;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [navigatingToHome, setNavigatingToHome] = useState(false);
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinContext, setCheckinContext] = useState<{ split: string; day: string } | null>(null);

  function handleResume(): void {
    const saved = loadSession();
    if (!saved || saved.activityType !== 'Lift') return;
    setSession(saved);
    setPendingDay(null);
    setPendingError(null);
    navigate(`/lift/${encodeURIComponent(saved.split)}/${encodeURIComponent(saved.day)}`);
  }

  function handleDiscard(): void {
    clearSession();
    setResumeDismissed(true);
    setSession(null);
  }

  async function startFreshSession(splitName: string, dayName: string): Promise<DaySelectResult> {
    const exercises = await loadDayExercises(splitName, dayName);
    // `null` means the split/workout couldn't be resolved; an empty array means
    // the day exists but has no (non-archived) exercises configured. Both used
    // to bail silently here, which looked like a dead tap to the user.
    if (!exercises) return 'error';
    if (exercises.length === 0) return 'empty';

    const newSession = createLiftSession(splitName, dayName, exercises);
    setSession(newSession);
    saveSession(newSession);
    navigate(`/lift/${encodeURIComponent(splitName)}/${encodeURIComponent(dayName)}`);
    return 'ok';
  }

  async function handleDaySelect(splitName: string, dayName: string): Promise<DaySelectResult> {
    const saved = loadSession();
    if (saved && saved.activityType === 'Lift') {
      // Never overwrite an unfinished workout on a single tap — ask first.
      setPendingDay({ split: splitName, day: dayName });
      return 'ok';
    }
    return startFreshSession(splitName, dayName);
  }

  async function handleDiscardAndStart(): Promise<void> {
    if (!pendingDay || isSubmitting) return;
    setPendingError(null);
    setIsSubmitting(true);
    const result = await startFreshSession(pendingDay.split, pendingDay.day);
    setIsSubmitting(false);
    if (result === 'ok') {
      // Only drop the old workout once the new one exists and is saved.
      setPendingDay(null);
      return;
    }
    setPendingError(
      result === 'empty'
        ? `"${pendingDay.day}" doesn't have any exercises set up yet.`
        : `Couldn't open "${pendingDay.day}". Please try again.`,
    );
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
    invalidateDashboardCache();
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

  // When the saved session has vanished underneath a pending prompt (another
  // tab discarded it), there is nothing to protect: fall through.
  if ((showResume || pendingDay) && savedLift) {
    const loggedSets = savedLift.exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
    const doneCount = savedLift.exercises.filter((ex) => ex.completed).length;
    const sameDay = pendingDay !== null && pendingDay.split === savedLift.split && pendingDay.day === savedLift.day;
    return (
      <div className="page selection-page">
        <div className="selection-header">
          <div className="selection-heading">
            <p className="selection-kicker">Unfinished workout</p>
            <h1 className="selection-title">{savedLift.day}</h1>
          </div>
        </div>
        <section className="workout-progress resume-card dash-animate" aria-label="Unfinished workout">
          <p className="resume-card-line">
            <strong>{savedLift.split}</strong> &middot; {savedLift.day}
          </p>
          <p className="resume-card-line resume-card-sub">
            {loggedSets === 1 ? '1 set' : `${loggedSets} sets`} logged &middot;{' '}
            {doneCount} of {savedLift.exercises.length} exercises done
          </p>
          {pendingDay && !sameDay && (
            <p className="resume-card-line resume-card-sub">
              You tapped <strong>{pendingDay.day}</strong>. Resuming keeps your logged sets; starting fresh deletes them.
            </p>
          )}
          {pendingError && <div className="submit-error" role="alert">{pendingError}</div>}
        </section>
        <div className="button-list resume-actions dash-animate" style={{ animationDelay: '70ms' }}>
          <button type="button" className="nav-button nav-button--finish-ready" onClick={handleResume} disabled={isSubmitting}>
            Resume {savedLift.day}
          </button>
          {pendingDay ? (
            <button type="button" className="nav-button resume-discard" onClick={handleDiscardAndStart} disabled={isSubmitting}>
              {isSubmitting ? 'Starting…' : sameDay ? 'Discard and start over' : `Discard and start ${pendingDay.day}`}
            </button>
          ) : (
            <button type="button" className="nav-button resume-discard" onClick={handleDiscard}>
              Discard
            </button>
          )}
          {pendingDay && (
            <button type="button" className="dash-hero-alt-link" onClick={() => { setPendingDay(null); setPendingError(null); }} disabled={isSubmitting}>
              Cancel
            </button>
          )}
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
          <SessionRoute stateSession={session} navigatingToHome={navigatingToHome}>
            {(active) => <ExerciseList session={active} onUpdateSession={handleUpdateSession} onSubmit={handleSubmit} isSubmitting={isSubmitting} submitError={submitError ?? undefined} onRetry={handleSubmit} />}
          </SessionRoute>
        } />
        <Route path=":splitName/:dayName/:exerciseIndex" element={
          <SessionRoute stateSession={session} navigatingToHome={navigatingToHome}>
            {(active) => <ExerciseLogging session={active} onUpdateSession={handleUpdateSession} />}
          </SessionRoute>
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
