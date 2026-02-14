import { useNavigate } from 'react-router-dom';
import type { LiftSession } from '../types/session';

interface ExerciseListProps {
  session: LiftSession;
  onUpdateSession: (session: LiftSession) => void;
  onSubmit: () => void;
}

function ExerciseList({ session, onSubmit }: ExerciseListProps): React.JSX.Element {
  const navigate = useNavigate();

  const allCompleted = session.exercises.every((ex) => ex.completed);

  function handleTap(exerciseIndex: number): void {
    navigate(
      `/lift/${encodeURIComponent(session.split)}/${encodeURIComponent(session.day)}/${exerciseIndex}`,
    );
  }

  return (
    <div className="page">
      <h1>{session.day}</h1>
      <ul className="exercise-list">
        {session.exercises.map((ex, index) => (
          <li
            key={index}
            className={`exercise-card ${ex.completed ? 'exercise-card--completed' : ''}`}
            onClick={() => handleTap(index)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTap(index); }}
          >
            <span className="exercise-name">
              {ex.completed ? '\u2713 ' : ''}{ex.name}
            </span>
            <span className="exercise-detail">
              {ex.targetSets} sets &times; {ex.targetReps} reps
              {ex.sets.length > 0 ? ` \u2014 ${ex.sets.length} logged` : ''}
            </span>
          </li>
        ))}
      </ul>
      <button
        className="submit-button"
        disabled={!allCompleted}
        onClick={onSubmit}
      >
        Submit Workout
      </button>
    </div>
  );
}

export default ExerciseList;
