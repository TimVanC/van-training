import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EnduranceSession, EnduranceActivityType } from '../types/session';
import type { TimeFormat } from '../utils/format';
import { parseTimeInput, formatTotalSeconds } from '../utils/format';
import { loadSession, saveSession, clearSession } from '../utils/storage';
import { normalizeSessionToRows } from '../utils/normalizeSession';

interface EnduranceFormProps {
  activityType: EnduranceActivityType;
  title: string;
  distanceUnit: string;
  metricLabel: string;
  timeFormat: TimeFormat;
  calculateMetric: (distance: number, totalSeconds: number) => number;
  formatMetric: (metric: number) => string;
}

function EnduranceForm({
  activityType,
  title,
  distanceUnit,
  metricLabel,
  timeFormat,
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
  const [time, setTime] = useState('');
  const [rpe, setRpe] = useState('5');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (showResume) return;
    if (!distance && !time) return;

    const d = parseFloat(distance) || 0;
    const parsed = parseTimeInput(time, timeFormat);
    const total = parsed ?? 0;
    const metric = (d > 0 && total > 0) ? calculateMetric(d, total) : 0;

    const session: EnduranceSession = {
      activityType,
      distance: d,
      minutes: Math.floor(total / 60),
      seconds: total % 60,
      totalSeconds: total,
      derivedMetric: metric,
      rpe: parseInt(rpe, 10) || 5,
      notes: notes || undefined,
      startedAt: startedAtRef.current,
    };
    saveSession(session);
  }, [distance, time, rpe, notes, showResume, activityType, timeFormat, calculateMetric]);

  function handleResume(): void {
    const saved = loadSession();
    if (!saved || saved.activityType !== activityType) return;
    const endurance = saved as EnduranceSession;
    setDistance(endurance.distance > 0 ? String(endurance.distance) : '');
    setTime(endurance.totalSeconds > 0 ? formatTotalSeconds(endurance.totalSeconds, timeFormat) : '');
    setRpe(endurance.rpe > 0 ? String(endurance.rpe) : '5');
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
    const parsed = parseTimeInput(time, timeFormat);
    if (!parsed || d <= 0) return;

    const session: EnduranceSession = {
      activityType,
      distance: d,
      minutes: Math.floor(parsed / 60),
      seconds: parsed % 60,
      totalSeconds: parsed,
      derivedMetric: calculateMetric(d, parsed),
      rpe: parseInt(rpe, 10) || 5,
      notes: notes || undefined,
      startedAt: startedAtRef.current,
    };
    const rows = normalizeSessionToRows(session);
    console.log(rows);
    clearSession();
    navigate('/');
  }

  const d = parseFloat(distance) || 0;
  const parsedTime = parseTimeInput(time, timeFormat);
  const isValid = d > 0 && parsedTime !== null;
  const metricValue = isValid ? formatMetric(calculateMetric(d, parsedTime)) : null;
  const canSubmit = isValid;
  const timePlaceholder = timeFormat === 'mm:ss' ? 'MM:SS' : 'HH:MM:SS';

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
      {metricValue !== null && (
        <p className="metric-display">{metricLabel}: {metricValue}</p>
      )}
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
          Time ({timePlaceholder})
          <input
            className="input-field"
            type="text"
            placeholder={timeFormat === 'mm:ss' ? '40:30' : '1:12:45'}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <div className="rpe-group">
          <span className="rpe-header">
            <span className="input-label">RPE</span>
            <span className="rpe-value">{rpe}</span>
          </span>
          <input
            className="rpe-slider"
            type="range"
            min="1"
            max="10"
            step="1"
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
          />
        </div>
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
