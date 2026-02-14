import { useNavigate } from 'react-router-dom';
import type { Split } from '../types/lift';
import splitsData from '../data/splits.json';

const splits: Split[] = Array.isArray(splitsData) ? splitsData : [splitsData as Split];

function SplitSelection(): React.JSX.Element {
  const navigate = useNavigate();

  function handleSelect(splitName: string): void {
    navigate(`/lift/${encodeURIComponent(splitName)}`);
  }

  return (
    <div className="page">
      <h1>Select Split</h1>
      <div className="button-list">
        {splits.map((s) => (
          <button
            key={s.split}
            className="nav-button"
            onClick={() => handleSelect(s.split)}
          >
            {s.split}
          </button>
        ))}
      </div>
    </div>
  );
}

export default SplitSelection;
