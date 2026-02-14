import { useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import type { LiftSession } from '../types/session';
import type { Split } from '../types/lift';
import { loadSession, saveSession, clearSession } from '../utils/storage';
import { createLiftSession } from '../utils/session';
import splitsData from '../data/splits.json';
import SplitSelection from './SplitSelection';
import DaySelection from './DaySelection';
import ExerciseList from './ExerciseList';
import ExerciseLogging from './ExerciseLogging';

const splits: Split[] = splitsData;

function LiftContainer(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const isLiftRoot = location.pathname === '/lift' || location.pathname === '/lift/';

  const [session, setSession] = useState<LiftSession | null>(() => {
    const saved = loadSession();
    if (!saved) return null;
    if (isLiftRoot) return null;
    return saved;
  });

  const [showResume, setShowResume] = useState<boolean>(() => {
    if (!isLiftRoot) return false;
    return loadSession() !== null;
  });

  function handleResume(): void {
    const saved = loadSession();
    if (!saved) return;
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

  function handleSubmit(): void {
    if (!session) return;
    // Temporary: log session for Phase 3 verification
    console.log(session);
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
  );
}

export default LiftContainer;
