import { useState, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import type { LiftSession } from '../types/session';
import type { Split } from '../types/lift';
import { loadSession, saveSession, clearSession } from '../utils/storage';
import { createLiftSession } from '../utils/session';
import { normalizeSessionToRows } from '../utils/normalizeSession';
import { submitWorkout } from '../utils/submitWorkout';
import splitsData from '../data/splits.json';
import SplitSelection from './SplitSelection';
import DaySelection from './DaySelection';
import ExerciseList from './ExerciseList';
import ExerciseLogging from './ExerciseLogging';
import TemporaryOverlay from '../components/TemporaryOverlay';

const splits: Split[] = splitsData;

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

  const [overlayMsg, setOverlayMsg] = useState('');
  const [showOverlay, setShowOverlay] = useState(false);
  const overlayTimer = useRef<number>(0);

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

  function handleDaySelect(splitName: string, dayName: string): void {
    const split = splits.find((s) => s.split === splitName);
    if (!split) return;
    const exercises = split.days[dayName];
    if (!exercises) return;

    const newSession = createLiftSession(splitName, dayName, exercises);
    setSession(newSession);
    saveSession(newSession);
    navigate(`/lift/${encodeURIComponent(splitName)}/${encodeURIComponent(dayName)}`);
  }

  function handleUpdateSession(updated: LiftSession): void {
    setSession(updated);
    saveSession(updated);
  }

  function flashOverlay(msg: string): void {
    setOverlayMsg(msg);
    setShowOverlay(true);
    window.clearTimeout(overlayTimer.current);
    overlayTimer.current = window.setTimeout(() => setShowOverlay(false), 1050);
  }

  async function handleSubmit(): Promise<void> {
    if (!session) return;
    const rows = normalizeSessionToRows(session);
    if (!await submitWorkout(rows)) { flashOverlay('Submission failed. Please try again.'); return; }
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
            ? <ExerciseList session={session} onUpdateSession={handleUpdateSession} onSubmit={handleSubmit} />
            : <Navigate to="/lift" replace />
        } />
        <Route path=":splitName/:dayName/:exerciseIndex" element={
          session
            ? <ExerciseLogging session={session} onUpdateSession={handleUpdateSession} />
            : <Navigate to="/lift" replace />
        } />
      </Routes>
      <TemporaryOverlay message={overlayMsg} visible={showOverlay} />
    </>
  );
}

export default LiftContainer;
