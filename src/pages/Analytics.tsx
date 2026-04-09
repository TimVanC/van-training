import { useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface ExerciseHistoryRow {
  date: string;
  weight: number;
  reps: number;
  volume: number;
  plate_data?: {
    '45': number;
    '35': number;
    '25': number;
    '10': number;
    '5': number;
    sled?: number;
  };
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

  function formatPlateDisplay(row: ExerciseHistoryRow): string | null {
    const plateData = row.plate_data;
    if (!plateData) return null;
    const parts: string[] = [];
    if (plateData['45'] > 0) parts.push(`${plateData['45']}x45`);
    if (plateData['35'] > 0) parts.push(`${plateData['35']}x35`);
    if (plateData['25'] > 0) parts.push(`${plateData['25']}x25`);
    if (plateData['10'] > 0) parts.push(`${plateData['10']}x10`);
    if (plateData['5'] > 0) parts.push(`${plateData['5']}x5`);
    if ((plateData.sled ?? 0) > 0) parts.push(`sled ${plateData.sled}`);
    return parts.length > 0 ? parts.join(' + ') : null;
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
        <>
          <div style={{ width: '100%', maxWidth: 560, height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="weight"
                  name="Weight"
                  stroke="#8884d8"
                  dot
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="volume"
                  name="Volume"
                  stroke="#82ca9d"
                  dot
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
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
                  <td style={tableCellStyle}>{formatPlateDisplay(row) ?? row.weight}</td>
                  <td style={tableCellStyle}>{row.reps}</td>
                  <td style={tableCellStyle}>{row.volume}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default Analytics;
