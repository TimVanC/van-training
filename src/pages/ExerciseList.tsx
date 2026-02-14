import { useParams } from 'react-router-dom';
import type { Split, Exercise } from '../types/lift';
import splitsData from '../data/splits.json';

const splits: Split[] = splitsData;

function ExerciseList(): React.JSX.Element {
  const { splitName, dayName } = useParams<{ splitName: string; dayName: string }>();

  const split = splits.find((s) => s.split === splitName);
  const exercises: Exercise[] | undefined = split?.days[dayName ?? ''];

  if (!split || !exercises) {
    return (
      <div className="page">
        <h1>Day not found</h1>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>{dayName}</h1>
      <ul className="exercise-list">
        {exercises.map((ex, index) => (
          <li key={index} className="exercise-card">
            <span className="exercise-name">{ex.exercise}</span>
            <span className="exercise-detail">{ex.sets} sets &times; {ex.reps} reps</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ExerciseList;
