import type { LoggedSet } from '../types/session';

const IconPencil = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </svg>
);

const IconCopy = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16V4a2 2 0 0 1 2-2h12" />
  </svg>
);

const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
);

interface SetLoggingFormProps {
  sets: LoggedSet[];
  weight: string;
  reps: string;
  rir: string;
  weightRef: React.RefObject<HTMLInputElement | null>;
  editingIndex: number | null;
  isSubmitting: boolean;
  onWeightChange: (v: string) => void;
  onRepsChange: (v: string) => void;
  onRirChange: (v: string) => void;
  onEdit: (i: number) => void;
  onDuplicate: (i: number) => void;
  onDelete: (i: number) => void;
  onAddSet: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onFinish: () => void;
}

function SetLoggingForm({
  sets,
  weight,
  reps,
  rir,
  weightRef,
  editingIndex,
  isSubmitting,
  onWeightChange,
  onRepsChange,
  onRirChange,
  onEdit,
  onDuplicate,
  onDelete,
  onAddSet,
  onSaveEdit,
  onCancelEdit,
  onFinish,
}: SetLoggingFormProps): React.JSX.Element {
  const dis = isSubmitting;
  return (
    <>
      {sets.length > 0 && (
        <ul className="set-list">
          {sets.map((set, i) => (
            <li key={set.clientId ?? i} className="set-row">
              <span className="set-info">
                Set {i + 1}: {set.weight} lbs &times; {set.reps} @ RIR {set.rir}
              </span>
              <span className="set-actions">
                <button className="set-action-button" onClick={() => onEdit(i)} disabled={dis} aria-label="Edit set">
                  <IconPencil />
                </button>
                <button className="set-action-button" onClick={() => onDuplicate(i)} disabled={dis} aria-label="Duplicate set">
                  <IconCopy />
                </button>
                <button className="set-action-button set-action-button--delete" onClick={() => onDelete(i)} disabled={dis} aria-label="Delete set">
                  <IconTrash />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="input-group">
        <label className="input-label">
          Weight (lbs)
          <input ref={weightRef} className="input-field" type="number" inputMode="decimal" value={weight}
            onChange={(e) => onWeightChange(e.target.value)} disabled={dis} />
        </label>
        <label className="input-label">
          Reps
          <input className="input-field" type="number" inputMode="numeric" value={reps}
            onChange={(e) => onRepsChange(e.target.value)} disabled={dis} />
        </label>
        <label className="input-label">
          RIR (optional)
          <input className="input-field" type="number" inputMode="numeric" value={rir}
            onChange={(e) => onRirChange(e.target.value)} disabled={dis} />
        </label>
      </div>
      <div className="button-list">
        {editingIndex !== null ? (
          <>
            <button className="nav-button" onClick={onSaveEdit} disabled={isSubmitting}>Save Edit</button>
            <button className="nav-button" onClick={onCancelEdit} disabled={dis}>Cancel</button>
          </>
        ) : (
          <button className="nav-button" onClick={onAddSet} disabled={isSubmitting}>Add Set</button>
        )}
        <button className="nav-button" onClick={onFinish} disabled={dis}>Finish Exercise</button>
      </div>
    </>
  );
}

export default SetLoggingForm;
