import { useState } from 'react';
import type { RecentLift } from '../types/session';

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
}

function RecentLiftsSection({ recentLifts, loading }: RecentLiftsSectionProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="recent-lifts">
      <button
        type="button"
        className="recent-lifts-header"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
      >
        <span className="recent-lifts-header-text">Last 3 Sets</span>
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
                return (
                  <div key={i} className="recent-lifts-item">
                    <strong>Set {i + 1}</strong> - <strong>Weight:</strong> {lift.weight} lbs, <strong>Reps:</strong> {lift.reps}, <strong>RIR:</strong> {rir}
                  </div>
                );
              })
            ) : (
              <p className="recent-lifts-empty">No data available</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RecentLiftsSection;
