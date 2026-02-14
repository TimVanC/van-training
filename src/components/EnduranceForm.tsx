import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EnduranceSession, EnduranceActivityType } from '../types/session';
import { loadSession, saveSession, clearSession } from '../utils/storage';

interface EnduranceFormProps {
  activityType: EnduranceActivityType;
  title: string;
  distanceUnit: string;
  metricLabel: string;
  calculateMetric: (distance: number, totalSeconds: number) => number;
  formatMetric: (metric: number) => string;
}

function EnduranceForm({
  activityType,
  title,
  distanceUnit,
  metricLabel,
  calculateMetric,
  formatMetric,
}: EnduranceFormProps): React.JSX.Element {
  const navigate = useNavigate();
  const startedAtRef = useRef(new Date().toISOString());

  const [showResume, setShowResume] = useState<boolean>(() => {
    const saved = loadSession();
    return saved !== null && saved.activityType === activityType;
  });

  const [distance, setDistance] = useState('');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [rpe, setRpe] = useState('');
  const [notes, setNotes] = useState('');

  // Persist to localStorage on every meaningful input change
  useEffect(() => {
    if (showResume) return;
    if (!distance && !minutes && !seconds && !rpe && !notes) return;

    const d = parseFloat(distance) || 0;
    const m = parseInt(minutes, 10) || 0;
    const s = parseInt(seconds, 10) || 0;
    const total = m * 60 + s;
    const metric = (d > 0 && total > 0) ? calculateMetric(d, total) : 0;

    const session: EnduranceSession = {
      activityType,
      distance: d,
      minutes: m,
      seconds: s,
      totalSeconds: total,
      derivedMetric: metric,
      rpe: parseInt(rpe, 10) || 0,
      notes: notes || undefined,
      startedAt: startedAtRef.current,
    };
    saveSession(session);
  }, [distance, minutes, seconds, rpe, notes, showResume, activityType, calculateMetric]);

  function handleResume(): void {
    const saved = loadSession();
    if (!saved || saved.activityType !== activityType) return;
    const endurance = saved as EnduranceSession;
    setDistance(endurance.distance > 0 ? String(endurance.distance) : '');
    setMinutes(endurance.minutes > 0 ? String(endurance.minutes) : '');
    setSeconds(endurance.seconds > 0 ? String(endurance.seconds) : '');
    setRpe(endurance.rpe > 0 ? String(endurance.rpe) : '');
    setNotes(endurance.notes ?? '');
    startedAtRef.current = endurance.startedAt;
    setShowResume(false);
  }

  function handleDiscard(): void {
    clearSession();
    setShowResume(false);
  }

  function handleSubmit(): void {
    const d = parseFloat(distance) || 0;
    const m = parseInt(minutes, 10) || 0;
    const s = parseInt(seconds, 10) || 0;
    const total = m * 60 + s;
    const metric = (d > 0 && total > 0) ? calculateMetric(d, total) : 0;

    const session: EnduranceSession = {
      activityType,
      distance: d,
      minutes: m,
      seconds: s,
      totalSeconds: total,
      derivedMetric: metric,
      rpe: parseInt(rpe, 10) || 0,
      notes: notes || undefined,
      startedAt: startedAtRef.current,
    };
    // Temporary: log session for Phase 4 verification
    console.log(session);
    clearSession();
    navigate('/');
  }

  // Derived metric for live display
  const d = parseFloat(distance) || 0;
  const m = parseInt(minutes, 10) || 0;
  const s = parseInt(seconds, 10) || 0;
  const total = m * 60 + s;
  const isValid = d > 0 && total > 0;
  const metricDisplay = isValid ? formatMetric(calculateMetric(d, total)) : '--';
  const rpeNum = parseInt(rpe, 10) || 0;
  const canSubmit = d > 0 && total > 0 && rpeNum >= 1 && rpeNum <= 10;

  if (showResume) {
    return (
      <div className="page">
        <h1>Resume {title} session?</h1>
        <div className="button-list">
          <button className="nav-button" onClick={handleResume}>Resume</button>
          <button className="nav-button" onClick={handleDiscard}>Discard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>{title}</h1>
      <p className="metric-display">{metricLabel}: {metricDisplay}</p>
      <div className="input-group">
        <label className="input-label">
          Distance ({distanceUnit})
          <input
            className="input-field"
            type="number"
            inputMode="decimal"
            step="0.01"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
          />
        </label>
        <label className="input-label">
          Minutes
          <input
            className="input-field"
            type="number"
            inputMode="numeric"
            min="0"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
        <label className="input-label">
          Seconds
          <input
            className="input-field"
            type="number"
            inputMode="numeric"
            min="0"
            max="59"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </label>
        <label className="input-label">
          RPE (1–10)
          <input
            className="input-field"
            type="number"
            inputMode="numeric"
            min="1"
            max="10"
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
          />
        </label>
        <label className="input-label">
          Notes (optional)
          <textarea
            className="textarea-field"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      <button
        className="submit-button"
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        Submit {title}
      </button>
    </div>
  );
}

export default EnduranceForm;
