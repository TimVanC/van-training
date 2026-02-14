import { useParams, useNavigate } from 'react-router-dom';
import type { Split } from '../types/lift';
import splitsData from '../data/splits.json';

const splits: Split[] = splitsData;

function DaySelection(): React.JSX.Element {
  const { splitName } = useParams<{ splitName: string }>();
  const navigate = useNavigate();

  const split = splits.find((s) => s.split === splitName);

  if (!split) {
    return (
      <div className="page">
        <h1>Split not found</h1>
      </div>
    );
  }

  const currentSplit = split.split;
  const dayNames = Object.keys(split.days);

  function handleSelect(dayName: string): void {
    navigate(`/lift/${encodeURIComponent(currentSplit)}/${encodeURIComponent(dayName)}`);
  }

  return (
    <div className="page">
      <h1>{split.split}</h1>
      <div className="button-list">
        {dayNames.map((day) => (
          <button
            key={day}
            className="nav-button"
            onClick={() => handleSelect(day)}
          >
            {day}
          </button>
        ))}
      </div>
    </div>
  );
}

export default DaySelection;
