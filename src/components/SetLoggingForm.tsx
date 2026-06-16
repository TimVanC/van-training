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

/**
 * Plate denominations that are toggled via chips. 45 is intentionally
 * omitted — it is always active and rendered as a standalone input.
 */
const CHIP_PLATE_DENOMS = ['35', '25', '10', '5', '2.5'] as const;

interface SetLoggingFormProps {
  sets: LoggedSet[];
  weight: string;
  reps: string;
  rir: string;
  weightRef: React.RefObject<HTMLInputElement | null>;
  inputMode?: 'weight' | 'plates';
  showSledInput?: boolean;
  plate45?: string;
  plate35?: string;
  plate25?: string;
  plate10?: string;
  plate5?: string;
  plate2_5?: string;
  sled?: string;
  /**
   * Denominations currently activated via the chip row. The 45 lb input is
   * always rendered and does not need to be present here. Other plate
   * inputs are only rendered when their denomination is in this set.
   */
  activePlates?: Set<string>;
  onTogglePlate?: (denomination: string) => void;
  /** When true, render the "Assisted" toggle next to the weight field. */
  showAssistedToggle?: boolean;
  /**
   * Whether the current weight entry represents bodyweight-assistance.
   * The weight input itself still shows a positive number; the parent flips
   * the sign on save so assisted sets are persisted as negative weight.
   */
  isAssisted?: boolean;
  onAssistedChange?: (v: boolean) => void;
  onWeightChange: (v: string) => void;
  onRepsChange: (v: string) => void;
  onRirChange: (v: string) => void;
  onPlate45Change?: (v: string) => void;
  onPlate35Change?: (v: string) => void;
  onPlate25Change?: (v: string) => void;
  onPlate10Change?: (v: string) => void;
  onPlate5Change?: (v: string) => void;
  onPlate2_5Change?: (v: string) => void;
  onSledChange?: (v: string) => void;
  editingIndex: number | null;
  isSubmitting: boolean;
  onEdit: (i: number) => void;
  onDuplicate: (i: number) => void;
  onDelete: (i: number) => void;
  onAddSet: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onFinish: () => void;
  /** Shown when add/edit validation fails (e.g. reps or weight out of range). */
  inputError?: string | null;
}

function SetLoggingForm({
  sets,
  weight,
  reps,
  rir,
  weightRef,
  inputMode = 'weight',
  showSledInput = false,
  plate45 = '',
  plate35 = '',
  plate25 = '',
  plate10 = '',
  plate5 = '',
  plate2_5 = '',
  sled = '',
  activePlates,
  onTogglePlate,
  showAssistedToggle = false,
  isAssisted = false,
  onAssistedChange,
  onWeightChange,
  onRepsChange,
  onRirChange,
  onPlate45Change,
  onPlate35Change,
  onPlate25Change,
  onPlate10Change,
  onPlate5Change,
  onPlate2_5Change,
  onSledChange,
  editingIndex,
  isSubmitting,
  onEdit,
  onDuplicate,
  onDelete,
  onAddSet,
  onSaveEdit,
  onCancelEdit,
  onFinish,
  inputError,
}: SetLoggingFormProps): React.JSX.Element {
  const dis = isSubmitting;
  const isPlates = inputMode === 'plates';
  const showWeightInput = !isPlates;

  function renderSetSummary(set: LoggedSet, index: number): React.JSX.Element {
    const plateData = set.plateData ?? (
      set.plate45 != null
      && set.plate35 != null
      && set.plate25 != null
      && set.plate10 != null
      && set.plate5 != null
        ? {
          plate45: set.plate45,
          plate35: set.plate35,
          plate25: set.plate25,
          plate10: set.plate10,
          plate5: set.plate5,
          plate2_5: set.plate2_5 ?? 0,
          sled: set.sled ?? 0,
        }
        : null
    );
    const parts: string[] = [];
    if (plateData?.plate45 && plateData.plate45 > 0) parts.push(`${plateData.plate45}x45`);
    if (plateData?.plate35 && plateData.plate35 > 0) parts.push(`${plateData.plate35}x35`);
    if (plateData?.plate25 && plateData.plate25 > 0) parts.push(`${plateData.plate25}x25`);
    if (plateData?.plate10 && plateData.plate10 > 0) parts.push(`${plateData.plate10}x10`);
    if (plateData?.plate5 && plateData.plate5 > 0) parts.push(`${plateData.plate5}x5`);
    if (plateData?.plate2_5 && plateData.plate2_5 > 0) parts.push(`${plateData.plate2_5}x2.5`);
    const plateText = parts.join(' + ');
    if (isPlates && plateData) {
      return (
        <>
          Set {index + 1}: {plateText || `${set.weight} lbs`} &times; {set.reps} @ RIR {set.rir}
        </>
      );
    }
    const weightLabel = set.weight < 0
      ? `${Math.abs(set.weight)} lbs assisted`
      : `${set.weight} lbs`;
    return (
      <>
        Set {index + 1}: {weightLabel} &times; {set.reps} @ RIR {set.rir}
      </>
    );
  }

  return (
    <>
      {sets.length > 0 && (
        <ul className="set-list">
          {sets.map((set, i) => (
            <li key={set.clientId ?? i} className="set-row">
              <span className="set-info">
                {renderSetSummary(set, i)}
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
        {showWeightInput ? (
          <div className="weight-input-group">
            <label className="input-label">
              Weight (lbs)
              <input ref={weightRef} className="input-field" type="text" inputMode="decimal" value={weight}
                onChange={(e) => onWeightChange(e.target.value)} disabled={dis} />
            </label>
            {showAssistedToggle && (
              <label className="assisted-toggle">
                <input
                  type="checkbox"
                  checked={isAssisted}
                  onChange={(e) => onAssistedChange?.(e.target.checked)}
                  disabled={dis}
                />
                <span>Assisted</span>
              </label>
            )}
          </div>
        ) : (
          <div className="plate-fields">
            <label className="input-label">
              45 lb plates (per side)
              <input className="input-field" type="number" inputMode="numeric" min={0} value={plate45}
                onChange={(e) => onPlate45Change?.(e.target.value)} disabled={dis} />
            </label>
            <div className="plate-chip-row" role="group" aria-label="Add plate denomination">
              {CHIP_PLATE_DENOMS.map((denom) => {
                const isActive = activePlates?.has(denom) ?? false;
                return (
                  <button
                    key={denom}
                    type="button"
                    className={`plate-chip ${isActive ? 'plate-chip--active' : ''}`}
                    onClick={() => onTogglePlate?.(denom)}
                    aria-pressed={isActive}
                    disabled={dis}
                  >
                    {denom} lb
                  </button>
                );
              })}
            </div>
            <div className="plate-inputs">
              {activePlates?.has('35') && (
                <label className="input-label">
                  35 lb plates (per side)
                  <input className="input-field" type="number" inputMode="numeric" min={0} value={plate35}
                    onChange={(e) => onPlate35Change?.(e.target.value)} disabled={dis} />
                </label>
              )}
              {activePlates?.has('25') && (
                <label className="input-label">
                  25 lb plates (per side)
                  <input className="input-field" type="number" inputMode="numeric" min={0} value={plate25}
                    onChange={(e) => onPlate25Change?.(e.target.value)} disabled={dis} />
                </label>
              )}
              {activePlates?.has('10') && (
                <label className="input-label">
                  10 lb plates (per side)
                  <input className="input-field" type="number" inputMode="numeric" min={0} value={plate10}
                    onChange={(e) => onPlate10Change?.(e.target.value)} disabled={dis} />
                </label>
              )}
              {activePlates?.has('5') && (
                <label className="input-label">
                  5 lb plates (per side)
                  <input className="input-field" type="number" inputMode="numeric" min={0} value={plate5}
                    onChange={(e) => onPlate5Change?.(e.target.value)} disabled={dis} />
                </label>
              )}
              {activePlates?.has('2.5') && (
                <label className="input-label">
                  2.5 lb plates (per side)
                  <input className="input-field" type="number" inputMode="numeric" min={0} value={plate2_5}
                    onChange={(e) => onPlate2_5Change?.(e.target.value)} disabled={dis} />
                </label>
              )}
            </div>
            {showSledInput && (
              <label className="input-label">
                Sled weight (lbs)
                <input className="input-field" type="number" inputMode="numeric" min={0} value={sled}
                  onChange={(e) => onSledChange?.(e.target.value)} disabled={dis} />
              </label>
            )}
          </div>
        )}
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
      {inputError ? (
        <div className="submit-error" role="alert">
          {inputError}
        </div>
      ) : null}
      <div className="button-list">
        {editingIndex !== null ? (
          <>
            <button className="nav-button" onClick={onSaveEdit} disabled={isSubmitting}>Save Edit</button>
            <button className="nav-button" onClick={onCancelEdit} disabled={dis}>Cancel</button>
          </>
        ) : (
          <button className="nav-button" onClick={onAddSet} disabled={isSubmitting}>Add Set</button>
        )}
        <button className={`nav-button ${sets.length > 0 ? 'nav-button--finish-ready' : ''}`} onClick={onFinish} disabled={dis}>Finish Exercise</button>
      </div>
    </>
  );
}

export default SetLoggingForm;
