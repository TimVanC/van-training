import { useState } from 'react';
import type { HistorySession, RecommendedPlanSet, RecentLift } from '../types/session';
import { formatHistoryDate } from '../utils/format';

function IconCaretDown(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function IconHistory(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

interface RecentLiftsSectionProps {
  recentLifts: RecentLift[];
  loading: boolean;
  /** Day-level note from the last session with this exercise. */
  previousNote?: string;
  /** Note written for this exercise itself in that session. */
  previousExerciseNote?: string;
  recommendedPlan?: RecommendedPlanSet[] | null;
  /** Why the engine chose this plan — shown under the recommended sets. */
  planRationale?: string;
  targetSets?: number;
  inputMode?: 'weight' | 'plates';
  /**
   * Bar/sled weight (lbs) to subtract from a recommended total before
   * decomposing into plates per side. Defaults to a standard 45 lb bar.
   * Sled-style movements should pass 0 since the sled weight is already
   * baked into the user's recorded total via the dedicated sled input.
   */
  sledBarWeight?: number;
  /** Up to 10 recent sessions rendered in the side-drawer history view. */
  sessionHistory?: HistorySession[];
}

const PLATE_DENOMS = [45, 35, 25, 10, 5, 2.5];

/**
 * Convert a total weight (lbs) back into the most efficient
 * plates-per-side breakdown using standard denominations. Falls back to
 * a plain `lbs` string when the total can't be loaded cleanly (negative
 * remainder, or a residual the denominations can't cover).
 */
function decomposeWeightToPlates(totalWeight: number, barWeight = 45): string {
  const loadable = totalWeight - barWeight;
  if (loadable < 0) return `${totalWeight} lbs`;
  const perSide = loadable / 2;
  const parts: string[] = [];
  let remaining = perSide;
  for (const denom of PLATE_DENOMS) {
    // Add a tiny epsilon so 7.5 / 2.5 doesn't round to 2 via floating point.
    const count = Math.floor(remaining / denom + 0.001);
    if (count > 0) {
      parts.push(`${count}x${denom}`);
      remaining = Number((remaining - count * denom).toFixed(2));
    }
  }
  if (remaining > 0.1) return `${totalWeight} lbs`;
  return parts.length > 0 ? parts.join(', ') : 'Bar only';
}

function formatPlateBreakdown(lift: RecentLift): string | null {
  const plate = lift.plateBreakdown;
  if (!plate) return null;
  const parts: string[] = [];
  if (plate.plate45 > 0) parts.push(`${plate.plate45}x45`);
  if (plate.plate35 > 0) parts.push(`${plate.plate35}x35`);
  if (plate.plate25 > 0) parts.push(`${plate.plate25}x25`);
  if (plate.plate10 > 0) parts.push(`${plate.plate10}x10`);
  if (plate.plate5 > 0) parts.push(`${plate.plate5}x5`);
  if (plate.plate2_5 > 0) parts.push(`${plate.plate2_5}x2.5`);
  return parts.length > 0 ? parts.join(', ') : '';
}

/** A collapsible previous note: the exercise note and the day note each get one. */
function NoteDisclosure({ label, text }: { label: string; text: string }): React.JSX.Element | null {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFullExpanded, setIsFullExpanded] = useState(false);
  const noteText = text.trim();
  if (noteText.length === 0) return null;
  const previewMax = 62;
  const preview = noteText.length > previewMax ? `${noteText.slice(0, previewMax).trimEnd()}...` : noteText;
  const shouldShowMoreToggle = noteText.length > 240;
  return (
    <div className="recent-lifts-note">
      <button
        type="button"
        className="recent-lifts-header recent-lifts-header--note"
        onClick={() => {
          setIsExpanded((v) => !v);
          if (isExpanded) setIsFullExpanded(false);
        }}
        aria-expanded={isExpanded}
      >
        <span className="recent-lifts-note-label">{isExpanded ? label : `${label}: "${preview}"`}</span>
        <span className={`recent-lifts-caret recent-lifts-note-caret ${isExpanded ? 'recent-lifts-note-caret--open' : ''}`}>
          <IconCaretDown />
        </span>
      </button>
      <div className={`recent-lifts-note-panel ${isExpanded ? 'recent-lifts-note-panel--expanded' : ''}`} aria-hidden={!isExpanded}>
        <p className={`recent-lifts-previous-note ${isFullExpanded ? 'recent-lifts-previous-note--expanded' : ''}`}>&quot;{noteText}&quot;</p>
        {shouldShowMoreToggle && (
          <button type="button" className="recent-lifts-note-more" onClick={() => setIsFullExpanded((v) => !v)}>
            {isFullExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}

function RecentLiftsSection({
  recentLifts,
  loading,
  previousNote,
  previousExerciseNote,
  recommendedPlan,
  planRationale,
  targetSets = 3,
  inputMode = 'weight',
  sledBarWeight = 45,
  sessionHistory,
}: RecentLiftsSectionProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSuggestionExpanded, setIsSuggestionExpanded] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const hasMissingPlateData =
    inputMode === 'plates' && recentLifts.some((lift) => lift.plateBreakdown == null);

  return (
    <div className="recent-lifts">
      <div className="recent-lifts-header-row">
        <button
          type="button"
          className="recent-lifts-header"
          onClick={() => setIsExpanded((v) => !v)}
          aria-expanded={isExpanded}
        >
          <span className="recent-lifts-header-text">Last {targetSets} Sets</span>
          <span className={`recent-lifts-caret ${isExpanded ? 'recent-lifts-caret--open' : ''}`}>
            <IconCaretDown />
          </span>
        </button>
        <button
          type="button"
          className={`recent-lifts-history-tab ${isHistoryOpen ? 'recent-lifts-history-tab--open' : ''}`}
          onClick={(e) => {
            e.currentTarget.blur();
            setIsHistoryOpen((v) => !v);
          }}
          aria-expanded={isHistoryOpen}
          aria-label="Show session history"
          title="Session history"
        >
          <IconHistory />
        </button>
      </div>
      <div className={`recent-lifts-panel ${isExpanded ? 'recent-lifts-panel--expanded' : ''}`}>
        <div className="recent-lifts-inner">
          <div className="recent-lifts-content">
            {loading ? (
              <p className="recent-lifts-loading">Loading recent lifts...</p>
            ) : recentLifts.length > 0 ? (
              recentLifts.map((lift, i) => {
                const rir = lift.rir == null || String(lift.rir).trim() === '' ? 0 : lift.rir;
                const plateText = formatPlateBreakdown(lift);
                const hasPlateData = lift.plateBreakdown != null;
                return (
                  <div key={i} className="recent-lifts-item">
                    <strong>Set {i + 1}</strong> - {inputMode === 'plates' ? (
                      hasPlateData ? (
                        <>
                          <strong>Plates:</strong> {plateText && plateText.length > 0 ? plateText : '-'}, <strong>Reps:</strong> {lift.reps}, <strong>RIR:</strong> {rir}
                        </>
                      ) : (
                        <span className="recent-lifts-error">Plate data missing for this set. Re-log to capture breakdown.</span>
                      )
                    ) : (
                      <>
                        <strong>Weight:</strong> {lift.weight} lbs, <strong>Reps:</strong> {lift.reps}, <strong>RIR:</strong> {rir}
                      </>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="recent-lifts-empty">No data available</p>
            )}
            {hasMissingPlateData && (
              <p className="recent-lifts-error">
                One or more recent plate-based sets are missing plate data.
              </p>
            )}
            <NoteDisclosure label="Exercise note" text={previousExerciseNote ?? ''} />
            <NoteDisclosure label="Day note" text={previousNote ?? ''} />
          </div>
        </div>
      </div>
      <div
        className={`recent-lifts-panel recent-lifts-history-panel ${isHistoryOpen ? 'recent-lifts-panel--expanded' : ''}`}
        aria-hidden={!isHistoryOpen}
      >
        <div className="recent-lifts-inner">
          <div className="recent-lifts-content">
            {!sessionHistory || sessionHistory.length === 0 ? (
              <p className="recent-lifts-empty">No session history available.</p>
            ) : (
              sessionHistory.map((historySession, si) => (
                <div key={`${historySession.date}-${si}`} className="history-session-block">
                  <p className="history-session-date">{formatHistoryDate(historySession.date)}</p>
                  {historySession.note && <p className="history-session-note">&quot;{historySession.note}&quot;</p>}
                  {historySession.sets.map((set, i) => {
                    const rir = set.rir == null || String(set.rir).trim() === '' ? 0 : set.rir;
                    const plateText = formatPlateBreakdown(set);
                    const showPlates = inputMode === 'plates' && plateText && plateText.length > 0;
                    return (
                      <div key={i} className="recent-lifts-item">
                        <strong>Set {i + 1}</strong> - {showPlates ? (
                          <>
                            <strong>Plates:</strong> {plateText},{' '}
                          </>
                        ) : (
                          <>
                            <strong>Weight:</strong> {set.weight} lbs,{' '}
                          </>
                        )}
                        <strong>Reps:</strong> {set.reps}, <strong>RIR:</strong> {rir}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="recent-lifts-header recent-lifts-header--suggestion"
        onClick={() => setIsSuggestionExpanded((v) => !v)}
        aria-expanded={isSuggestionExpanded}
      >
        <span className="recent-lifts-header-text">Recommended Progression</span>
        <span className={`recent-lifts-caret ${isSuggestionExpanded ? 'recent-lifts-caret--open' : ''}`}>
          <IconCaretDown />
        </span>
      </button>
      <div className={`recent-lifts-panel ${isSuggestionExpanded ? 'recent-lifts-panel--expanded' : ''}`}>
        <div className="recent-lifts-inner">
          <div className="recent-lifts-content">
            {loading ? (
              <p className="recent-lifts-loading">Loading progression...</p>
            ) : recommendedPlan && recommendedPlan.length > 0 ? (
              <>
                {recommendedPlan.map((planSet) => (
                  <div key={`${planSet.setNumber}-${planSet.weight}`} className="recent-lifts-item">
                    Set {planSet.setNumber} - {inputMode === 'plates'
                      ? decomposeWeightToPlates(planSet.weight, sledBarWeight)
                      : `${planSet.weight} lbs`} {'->'} {planSet.targetReps} reps (Target RIR: {planSet.targetRIR})
                  </div>
                ))}
                {planRationale && <p className="recent-lifts-rationale">{planRationale}</p>}
              </>
            ) : (
              <p className="recent-lifts-empty">Not enough data to generate progression.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RecentLiftsSection;
