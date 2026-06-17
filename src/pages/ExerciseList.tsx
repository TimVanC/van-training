import type { MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LiftSession } from '../types/session';
import LoadingOverlay from '../components/LoadingOverlay';

interface ExerciseListProps {
  session: LiftSession;
  onUpdateSession: (session: LiftSession) => void;
  onSubmit: () => void;
  isSubmitting?: boolean;
  submitError?: string;
  onRetry?: () => void;
}

function ExerciseList({
  session,
  onUpdateSession,
  onSubmit,
  isSubmitting = false,
  submitError,
  onRetry,
}: ExerciseListProps): React.JSX.Element {
  const navigate = useNavigate();
  const allCompleted = session.exercises.every((ex) => ex.completed);
  const totalSets = session.exercises.reduce((acc, ex) => acc + ex.targetSets, 0);
  const loggedSets = session.exercises.reduce((acc, ex) => acc + ex.sets.length, 0);

  const wasAllCompleted = useRef(false);
  const [justUnlocked, setJustUnlocked] = useState(false);

  useEffect(() => {
    if (allCompleted && !wasAllCompleted.current) {
      const cascadeDuration = session.exercises.length * 100 + 450;
      const timeout = window.setTimeout(() => {
        setJustUnlocked(true);
        window.setTimeout(() => setJustUnlocked(false), 700);
      }, cascadeDuration);
      wasAllCompleted.current = true;
      return () => window.clearTimeout(timeout);
    }
    if (!allCompleted) {
      wasAllCompleted.current = false;
    }
  }, [allCompleted, session.exercises.length]);

  function handleNavigate(exerciseIndex: number): void {
    navigate(
      `/lift/${encodeURIComponent(session.split)}/${encodeURIComponent(session.day)}/${exerciseIndex}`,
    );
  }

  function handleSkip(e: MouseEvent, exerciseIndex: number): void {
    e.stopPropagation();
    const updatedExercises = session.exercises.map((ex, i) =>
      i === exerciseIndex ? { ...ex, completed: true } : ex,
    );
    onUpdateSession({ ...session, exercises: updatedExercises });
  }

  return (
    <div className="page">
      <h1>{session.day}</h1>
      <div className="progress-bar-container">
        <div className="progress-bar-label">{loggedSets} / {totalSets} sets completed</div>
        <div className="progress-bar-track">
          <div
            className={`progress-bar-fill ${allCompleted ? 'progress-bar-fill--all-done' : ''}`}
            style={{ width: `${totalSets > 0 ? (loggedSets / totalSets) * 100 : 0}%` }}
          />
        </div>
      </div>
      <ul className="exercise-list">
        {session.exercises.map((ex, index) => (
          <li
            key={index}
            className={`exercise-card ${ex.completed ? (allCompleted ? 'exercise-card--all-done' : 'exercise-card--completed') : ''}`}
            style={allCompleted ? { animationDelay: `${index * 100}ms` } : undefined}
            onClick={() => handleNavigate(index)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNavigate(index); }}
          >
            <div className="exercise-card-header">
              <span className="exercise-name">
                {ex.completed ? '\u2713 ' : ''}{ex.activeName ?? ex.name}
              </span>
              {!ex.completed && (
                <button className="skip-button" onClick={(e) => handleSkip(e, index)}>
                  Skip
                </button>
              )}
            </div>
            <span className="exercise-detail">
              {ex.targetSets} sets &times; {(ex.targetRepRange ?? (ex.targetReps != null ? String(ex.targetReps) : '-'))} reps
              {ex.sets.length > 0 ? ` \u2014 ${ex.sets.length === 1 ? '1 set logged' : `${ex.sets.length} sets logged`}` : ''}
            </span>
          </li>
        ))}
      </ul>
      <label className="input-label notes-label">
        Notes (optional)
        <textarea
          className="textarea-field"
          rows={3}
          value={session.notes ?? ''}
          onChange={(e) => onUpdateSession({ ...session, notes: e.target.value || undefined })}
          disabled={isSubmitting}
        />
      </label>
      <button
        className={`submit-button ${justUnlocked ? 'submit-button--just-unlocked' : ''}`}
        disabled={!allCompleted || isSubmitting}
        onClick={onSubmit}
      >
        Submit Workout
      </button>
      {submitError && (
        <div className="submit-error">
          {submitError}
          {onRetry && (
            <button type="button" className="submit-error-retry" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}
      <LoadingOverlay visible={isSubmitting} />
    </div>
  );
}

export default ExerciseList;
