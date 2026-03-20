import { useState } from 'react';

interface ExerciseHistoryRow {
  date: string;
  weight: number;
  reps: number;
  volume: number;
}

function Analytics(): React.JSX.Element {
  const [exerciseName, setExerciseName] = useState('');
  const [rows, setRows] = useState<ExerciseHistoryRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLoadData(): Promise<void> {
    const trimmed = exerciseName.trim();
    if (!trimmed) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/getExerciseHistory?exercise_name=${encodeURIComponent(trimmed)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        setRows([]);
        return;
      }
      const data = (await res.json()) as ExerciseHistoryRow[];
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <h1>Analytics</h1>
      <label>
        <input
          type="text"
          placeholder="Enter exercise name"
          value={exerciseName}
          onChange={(e) => setExerciseName(e.target.value)}
          disabled={loading}
        />
      </label>
      <button type="button" onClick={handleLoadData} disabled={loading}>
        Load Data
      </button>
      {loading && <p>Loading...</p>}
      {!loading && rows !== null && rows.length === 0 && <p>No data found</p>}
      {!loading && rows !== null && rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Weight</th>
              <th>Reps</th>
              <th>Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.date}-${row.weight}-${row.reps}-${i}`}>
                <td>{row.date}</td>
                <td>{row.weight}</td>
                <td>{row.reps}</td>
                <td>{row.volume}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default Analytics;
