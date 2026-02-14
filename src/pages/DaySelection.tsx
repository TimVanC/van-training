import { useParams } from 'react-router-dom';
import type { Split } from '../types/lift';
import splitsData from '../data/splits.json';

const splits: Split[] = Array.isArray(splitsData) ? splitsData : [splitsData as Split];

interface DaySelectionProps {
  onDaySelect: (splitName: string, dayName: string) => void;
}

function DaySelection({ onDaySelect }: DaySelectionProps): React.JSX.Element {
  const { splitName } = useParams<{ splitName: string }>();

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

  return (
    <div className="page">
      <h1>{split.split}</h1>
      <div className="button-list">
        {dayNames.map((day) => (
          <button
            key={day}
            className="nav-button"
            onClick={() => onDaySelect(currentSplit, day)}
          >
            {day}
          </button>
        ))}
      </div>
    </div>
  );
}

export default DaySelection;
