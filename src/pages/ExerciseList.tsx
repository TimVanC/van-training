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

function IconChevronLeft(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconChevronRight(): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconCheck(): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
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
  const completedCount = session.exercises.filter((ex) => ex.completed).length;
  const progressPct = totalSets > 0 ? Math.min(100, (loggedSets / totalSets) * 100) : 0;
  const remaining = session.exercises.length - completedCount;

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

  const progressSub = allCompleted
    ? 'All exercises done. Submit when you’re ready.'
    : remaining === 1
      ? '1 exercise to go'
      : `${remaining} exercises to go`;

  // Stagger offsets so the header card, each exercise row, and the footer
  // fade in one after another, matching the split/day selection screens.
  const cardsDelayBase = 60;
  const footerDelay = cardsDelayBase + session.exercises.length * 55 + 40;

  return (
    <div className="page selection-page workout-page">
      <div className="selection-header">
        <button
          type="button"
          className="selection-back"
          onClick={() => navigate(`/lift/${encodeURIComponent(session.split)}`)}
          aria-label="Back to days"
        >
          <IconChevronLeft />
        </button>
        <div className="selection-heading">
          <p className="selection-kicker">{session.split}</p>
          <h1 className="selection-title">{session.day}</h1>
        </div>
      </div>

      <section
        className={`workout-progress dash-animate ${allCompleted ? 'workout-progress--done' : ''}`}
        aria-label="Workout progress"
      >
        <div className="workout-progress-row">
          <div className="workout-progress-count">
            <span className="workout-progress-value">{loggedSets}</span>
            <span className="workout-progress-total">/ {totalSets} sets</span>
          </div>
          <span className="workout-progress-pct">{Math.round(progressPct)}%</span>
        </div>
        <div className="workout-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={totalSets} aria-valuenow={loggedSets}>
          <div className="workout-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="workout-progress-sub">{progressSub}</p>
      </section>

      <ul className="selection-list workout-list">
        {session.exercises.map((ex, index) => {
          const logged = ex.sets.length;
          const started = logged > 0;
          const state = ex.completed ? (allCompleted ? 'all-done' : 'completed') : started ? 'started' : 'pending';
          const reps = ex.targetRepRange ?? (ex.targetReps != null ? String(ex.targetReps) : '-');
          const loggedLabel = logged === 0 ? null : logged === 1 ? '1 set logged' : `${logged} sets logged`;
          return (
            <li
              key={index}
              className="workout-item dash-animate"
              style={{ animationDelay: `${cardsDelayBase + index * 55}ms` }}
            >
              <div
                className={`day-card workout-card workout-card--${state}`}
                style={allCompleted ? { animationDelay: `${index * 100}ms` } : undefined}
                onClick={() => handleNavigate(index)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleNavigate(index);
                  }
                }}
              >
                <span className={`day-card-bar workout-card-bar workout-card-bar--${state}`} aria-hidden />
                <span className="day-card-body">
                  <span className="day-card-top">
                    <span className="day-card-name workout-card-name">{ex.activeName ?? ex.name}</span>
                    {ex.completed ? (
                      <span className={`day-card-badge workout-card-badge workout-card-badge--${state}`}>Done</span>
                    ) : (
                      <button
                        type="button"
                        className="skip-button workout-skip"
                        onClick={(e) => handleSkip(e, index)}
                      >
                        Skip
                      </button>
                    )}
                  </span>
                  <span className="day-card-sub workout-card-sub">
                    <span>{ex.targetSets} sets &times; {reps} reps</span>
                    {loggedLabel && (
                      <>
                        <span className="workout-card-dot" aria-hidden>&middot;</span>
                        <span className="workout-card-logged">{loggedLabel}</span>
                      </>
                    )}
                  </span>
                </span>
                <span className="day-card-go workout-card-go" aria-hidden>
                  {ex.completed ? <IconCheck /> : <IconChevronRight />}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="workout-footer dash-animate" style={{ animationDelay: `${footerDelay}ms` }}>
        <label className="input-label notes-label workout-notes">
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
          className={`submit-button workout-submit ${justUnlocked ? 'submit-button--just-unlocked' : ''}`}
          disabled={!allCompleted || isSubmitting}
          onClick={onSubmit}
        >
          Submit Workout
        </button>
        {submitError && (
          <div className="submit-error workout-error">
            {submitError}
            {onRetry && (
              <button type="button" className="submit-error-retry" onClick={onRetry}>
                Retry
              </button>
            )}
          </div>
        )}
      </div>
      <LoadingOverlay visible={isSubmitting} />
    </div>
  );
}

export default ExerciseList;
