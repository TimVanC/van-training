import { useState } from 'react';

interface ExerciseHistoryRow {
  date: string;
  weight: number;
  reps: number;
  volume: number;
}

const tableCellStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  textAlign: 'left',
};

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
        <table style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={tableCellStyle}>Date</th>
              <th style={tableCellStyle}>Weight</th>
              <th style={tableCellStyle}>Reps</th>
              <th style={tableCellStyle}>Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.date}-${row.weight}-${row.reps}-${i}`}>
                <td style={tableCellStyle}>{row.date}</td>
                <td style={tableCellStyle}>{row.weight}</td>
                <td style={tableCellStyle}>{row.reps}</td>
                <td style={tableCellStyle}>{row.volume}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default Analytics;
