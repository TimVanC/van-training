import { useState } from 'react';
import type { RecommendedPlanSet, RecentLift } from '../types/session';

function IconCaretDown(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

interface RecentLiftsSectionProps {
  recentLifts: RecentLift[];
  loading: boolean;
  previousNote?: string;
  recommendedPlan?: RecommendedPlanSet[] | null;
  targetSets?: number;
  inputMode?: 'weight' | 'plates';
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
  return parts.length > 0 ? parts.join(', ') : '';
}

function RecentLiftsSection({
  recentLifts,
  loading,
  previousNote,
  recommendedPlan,
  targetSets = 3,
  inputMode = 'weight',
}: RecentLiftsSectionProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSuggestionExpanded, setIsSuggestionExpanded] = useState(false);
  const [isNoteExpanded, setIsNoteExpanded] = useState(false);
  const [isNoteFullExpanded, setIsNoteFullExpanded] = useState(false);
  const noteText = String(previousNote ?? '').trim();
  const previewMax = 62;
  const notePreview =
    noteText.length > previewMax ? `${noteText.slice(0, previewMax).trimEnd()}...` : noteText;
  const shouldRenderNote = noteText.length > 0;
  const shouldShowMoreToggle = noteText.length > 240;
  const hasMissingPlateData =
    inputMode === 'plates' && recentLifts.some((lift) => lift.plateBreakdown == null);

  return (
    <div className="recent-lifts">
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
            {shouldRenderNote && (
              <div className="recent-lifts-note">
                <button
                  type="button"
                  className="recent-lifts-header recent-lifts-header--note"
                  onClick={() => {
                    setIsNoteExpanded((v) => !v);
                    if (isNoteExpanded) setIsNoteFullExpanded(false);
                  }}
                  aria-expanded={isNoteExpanded}
                >
                  <span className="recent-lifts-note-label">
                    {isNoteExpanded ? 'Note' : `Note: "${notePreview}"`}
                  </span>
                  <span className={`recent-lifts-caret recent-lifts-note-caret ${isNoteExpanded ? 'recent-lifts-note-caret--open' : ''}`}>
                    <IconCaretDown />
                  </span>
                </button>
                <div
                  className={`recent-lifts-note-panel ${isNoteExpanded ? 'recent-lifts-note-panel--expanded' : ''}`}
                  aria-hidden={!isNoteExpanded}
                >
                  <p className={`recent-lifts-previous-note ${isNoteFullExpanded ? 'recent-lifts-previous-note--expanded' : ''}`}>&quot;{noteText}&quot;</p>
                  {shouldShowMoreToggle && (
                    <button
                      type="button"
                      className="recent-lifts-note-more"
                      onClick={() => setIsNoteFullExpanded((v) => !v)}
                    >
                      {isNoteFullExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>
              </div>
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
              recommendedPlan.map((planSet) => (
                <div key={`${planSet.setNumber}-${planSet.weight}`} className="recent-lifts-item">
                  Set {planSet.setNumber} - {planSet.weight} lbs {'->'} {planSet.targetReps} reps (Target RIR: {planSet.targetRIR})
                </div>
              ))
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
