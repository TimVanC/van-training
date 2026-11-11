import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { invalidateDashboardCache } from '../hooks/useDashboardData';
import { supabase } from '../utils/supabaseClient';
import { validateLiftWeight, validateReps } from '../utils/validateSetInput';

interface LoggedSet {
  id: string;
  sessionId: string;
  date: string;
  exerciseName: string;
  setNumber: number;
  weight: number;
  reps: number;
  rir: number;
}

interface SetRow {
  id: string;
  session_id: string;
  exercise_name: string | null;
  set_number: number | null;
  weight: number | string | null;
  reps: number | null;
  rir: number | string | null;
  sessions: { date: string } | { date: string }[] | null;
}

interface Draft {
  weight: string;
  reps: string;
  rir: string;
}

const PAGE_SIZE = 1000;
const MAX_RIR = 10;

/** Every set the signed-in user has logged in the app. RLS limits rows to their own sessions. */
async function fetchAllSets(): Promise<LoggedSet[]> {
  const out: LoggedSet[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('lift_sets')
      .select('id, session_id, exercise_name, set_number, weight, reps, rir, sessions!inner(date)')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as SetRow[];
    for (const r of rows) {
      const session = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
      if (!r.exercise_name || !session) continue;
      out.push({
        id: r.id,
        sessionId: r.session_id,
        date: session.date,
        exerciseName: r.exercise_name.trim(),
        setNumber: r.set_number ?? 0,
        weight: Number(r.weight ?? 0),
        reps: Number(r.reps ?? 0),
        rir: Number(r.rir ?? 0),
      });
    }
    if (rows.length < PAGE_SIZE) return out;
  }
}

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function draftOf(set: LoggedSet): Draft {
  return { weight: String(set.weight), reps: String(set.reps), rir: String(set.rir) };
}

/** Problem with a draft, or null when it can be saved. */
function draftError(d: Draft): string | null {
  const weight = Number(d.weight);
  if (d.weight.trim() === '') return 'Enter a weight.';
  const w = validateLiftWeight(weight);
  if (!w.valid) return w.message ?? 'Invalid weight.';
  const r = validateReps(Number(d.reps));
  if (!r.valid) return r.message ?? 'Invalid reps.';
  const rir = d.rir.trim() === '' ? 0 : Number(d.rir);
  if (!Number.isInteger(rir) || rir < 0 || rir > MAX_RIR) return `RIR must be a whole number from 0 to ${MAX_RIR}.`;
  return null;
}

/**
 * Settings → Historical data: browse every exercise ever logged and fix any
 * past set (a typo'd RIR or weight). Everything downstream — progression,
 * dashboard trends, Muscle Lab — is computed from these rows on each load,
 * so a correction takes effect everywhere.
 */
function SetHistory(): React.JSX.Element {
  const navigate = useNavigate();
  const [sets, setSets] = useState<LoggedSet[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [exercise, setExercise] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllSets()
      .then((result) => {
        if (!cancelled) setSets(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Exercises, most recently trained first.
  const exercises = useMemo(() => {
    const byName = new Map<string, { name: string; last: string; count: number }>();
    for (const s of sets ?? []) {
      const key = s.exerciseName.toLowerCase();
      const entry = byName.get(key);
      if (!entry) byName.set(key, { name: s.exerciseName, last: s.date, count: 1 });
      else {
        entry.count += 1;
        if (s.date > entry.last) entry.last = s.date;
      }
    }
    return [...byName.values()].sort((a, b) => b.last.localeCompare(a.last));
  }, [sets]);

  const visibleExercises = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? exercises.filter((e) => e.name.toLowerCase().includes(q)) : exercises;
  }, [exercises, query]);

  // Sessions of the chosen exercise, newest first, sets in order.
  const sessions = useMemo(() => {
    if (!exercise || !sets) return [];
    const key = exercise.toLowerCase();
    const bySession = new Map<string, { date: string; sets: LoggedSet[] }>();
    for (const s of sets) {
      if (s.exerciseName.toLowerCase() !== key) continue;
      const entry = bySession.get(s.sessionId) ?? { date: s.date, sets: [] };
      entry.sets.push(s);
      bySession.set(s.sessionId, entry);
    }
    return [...bySession.entries()]
      .map(([id, v]) => ({ id, date: v.date, sets: v.sets.sort((a, b) => a.setNumber - b.setNumber) }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [exercise, sets]);

  function openExercise(name: string): void {
    setExercise(name);
    setDrafts({});
    setRowMessage(null);
    window.scrollTo(0, 0);
  }

  function updateDraft(set: LoggedSet, field: keyof Draft, value: string): void {
    setRowMessage(null);
    setDrafts((prev) => ({ ...prev, [set.id]: { ...(prev[set.id] ?? draftOf(set)), [field]: value } }));
  }

  async function save(set: LoggedSet): Promise<void> {
    const draft = drafts[set.id];
    if (!draft) return;
    const problem = draftError(draft);
    if (problem) {
      setRowMessage({ id: set.id, text: problem, ok: false });
      return;
    }
    const next = {
      weight: Number(draft.weight),
      reps: Number(draft.reps),
      rir: draft.rir.trim() === '' ? 0 : Number(draft.rir),
    };
    setSavingId(set.id);
    // A changed weight no longer matches the logged plate breakdown, so drop it.
    const patch = next.weight !== set.weight ? { ...next, plate_data: null } : next;
    const { error } = await supabase.from('lift_sets').update(patch).eq('id', set.id);
    setSavingId(null);
    if (error) {
      setRowMessage({ id: set.id, text: "Couldn't save. Try again.", ok: false });
      return;
    }
    setSets((prev) => prev?.map((s) => (s.id === set.id ? { ...s, ...next } : s)) ?? prev);
    setDrafts((prev) => {
      const rest = { ...prev };
      delete rest[set.id];
      return rest;
    });
    invalidateDashboardCache();
    setRowMessage({ id: set.id, text: 'Saved', ok: true });
  }

  function isDirty(set: LoggedSet): boolean {
    const d = drafts[set.id];
    if (!d) return false;
    const o = draftOf(set);
    return d.weight !== o.weight || d.reps !== o.reps || d.rir !== o.rir;
  }

  return (
    <div className="page page--with-nav history-page">
      <div className="history-header">
        <button
          type="button"
          className="analytics-back"
          onClick={() => (exercise ? setExercise(null) : navigate('/settings'))}
          aria-label={exercise ? 'Back to all exercises' : 'Back to settings'}
        >
          ←
        </button>
        <h1>{exercise ?? 'Historical data'}</h1>
      </div>

      {loadError && (
        <section className="settings-card">
          <p className="settings-note settings-note--warn">Couldn't load your logged sets.</p>
          <button
            type="button"
            className="settings-btn"
            onClick={() => {
              setLoadError(false);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </section>
      )}

      {!loadError && sets === null && <p className="settings-note">Loading your sets…</p>}

      {sets !== null && !exercise && (
        <>
          <p className="settings-note history-intro">
            Pick an exercise to fix any set you've logged. Progression, trends and Muscle Lab update from the corrected numbers.
          </p>
          <div className="analytics-search-wrap">
            <input
              className="input-field analytics-search"
              type="search"
              placeholder="Search exercises"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="analytics-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                ×
              </button>
            )}
          </div>
          {visibleExercises.length === 0 && <p className="settings-note">No logged exercises match.</p>}
          <ul className="history-exercise-list">
            {visibleExercises.map((e) => (
              <li key={e.name}>
                <button type="button" className="history-exercise" onClick={() => openExercise(e.name)}>
                  <span className="history-exercise-name">{e.name}</span>
                  <span className="history-exercise-meta">
                    {e.count} {e.count === 1 ? 'set' : 'sets'} · last {formatSessionDate(e.last)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {sets !== null &&
        exercise &&
        sessions.map((session) => (
          <section key={session.id} className="settings-card history-session">
            <h2 className="settings-card-title">{formatSessionDate(session.date)}</h2>
            <div className="history-set-head" aria-hidden="true">
              <span>Set</span>
              <span>Lbs</span>
              <span>Reps</span>
              <span>RIR</span>
              <span />
            </div>
            {session.sets.map((set, i) => {
              const d = drafts[set.id] ?? draftOf(set);
              const dirty = isDirty(set);
              const message = rowMessage?.id === set.id ? rowMessage : null;
              return (
                <div key={set.id} className="history-set-block">
                  <div className="history-set">
                    <span className="history-set-num">{set.setNumber || i + 1}</span>
                    <input
                      className="input-field history-input"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      aria-label={`Set ${i + 1} weight`}
                      value={d.weight}
                      onChange={(e) => updateDraft(set, 'weight', e.target.value)}
                    />
                    <input
                      className="input-field history-input"
                      type="number"
                      inputMode="numeric"
                      aria-label={`Set ${i + 1} reps`}
                      value={d.reps}
                      onChange={(e) => updateDraft(set, 'reps', e.target.value)}
                    />
                    <input
                      className="input-field history-input"
                      type="number"
                      inputMode="numeric"
                      aria-label={`Set ${i + 1} RIR`}
                      value={d.rir}
                      onChange={(e) => updateDraft(set, 'rir', e.target.value)}
                    />
                    <button
                      type="button"
                      className="history-save"
                      disabled={!dirty || savingId !== null}
                      onClick={() => void save(set)}
                    >
                      {savingId === set.id ? '…' : 'Save'}
                    </button>
                  </div>
                  {message && (
                    <p className={`history-set-msg${message.ok ? ' history-set-msg--ok' : ''}`}>{message.text}</p>
                  )}
                </div>
              );
            })}
          </section>
        ))}

      <BottomNav />
    </div>
  );
}

export default SetHistory;
