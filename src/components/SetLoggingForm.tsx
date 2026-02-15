import { Pencil, Copy, Trash2 } from 'lucide-react';
import type { LoggedSet } from '../types/session';

interface SetLoggingFormProps {
  sets: LoggedSet[];
  weight: string;
  reps: string;
  rir: string;
  weightRef: React.RefObject<HTMLInputElement | null>;
  editingIndex: number | null;
  isSubmitting: boolean;
  lastSet: { weight: number; reps: number; rir: number } | null;
  onWeightChange: (v: string) => void;
  onRepsChange: (v: string) => void;
  onRirChange: (v: string) => void;
  onEdit: (i: number) => void;
  onDuplicate: (i: number) => void;
  onDelete: (i: number) => void;
  onAddSet: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRepeatLastSet: () => void;
  onFinish: () => void;
}

const ICON_SIZE = 16;

function SetLoggingForm({
  sets,
  weight,
  reps,
  rir,
  weightRef,
  editingIndex,
  isSubmitting,
  lastSet,
  onWeightChange,
  onRepsChange,
  onRirChange,
  onEdit,
  onDuplicate,
  onDelete,
  onAddSet,
  onSaveEdit,
  onCancelEdit,
  onRepeatLastSet,
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
                  <Pencil size={ICON_SIZE} strokeWidth={2} aria-hidden />
                </button>
                <button className="set-action-button" onClick={() => onDuplicate(i)} disabled={dis} aria-label="Duplicate set">
                  <Copy size={ICON_SIZE} strokeWidth={2} aria-hidden />
                </button>
                <button className="set-action-button set-action-button--delete" onClick={() => onDelete(i)} disabled={dis} aria-label="Delete set">
                  <Trash2 size={ICON_SIZE} strokeWidth={2} aria-hidden />
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
      {lastSet && (
        <button type="button" className="set-action-button repeat-last-set-button" onClick={onRepeatLastSet} disabled={dis}>
          Repeat Last Set
        </button>
      )}
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
