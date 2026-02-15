import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LiftSession } from '../types/session';

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
            className="progress-bar-fill"
            style={{ width: `${totalSets > 0 ? (loggedSets / totalSets) * 100 : 0}%` }}
          />
        </div>
      </div>
      <ul className="exercise-list">
        {session.exercises.map((ex, index) => (
          <li
            key={index}
            className={`exercise-card ${ex.completed ? 'exercise-card--completed' : ''}`}
            onClick={() => handleNavigate(index)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNavigate(index); }}
          >
            <div className="exercise-card-header">
              <span className="exercise-name">
                {ex.completed ? '\u2713 ' : ''}{ex.name}
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
        className={`submit-button ${isSubmitting ? 'submit-button--saving' : ''}`}
        disabled={!allCompleted || isSubmitting}
        onClick={onSubmit}
      >
        {isSubmitting ? 'Saving...' : 'Submit Workout'}
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
    </div>
  );
}

export default ExerciseList;
