import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { PlanAdjustment, ProgressionPhase } from '../types/session';

interface BadgeDef {
  key: string;
  label: string;
  title: string;
  blurb: string;
  tone: 'phase' | 'fatigue' | 'layoff';
}

const PHASE_BADGES: Record<ProgressionPhase, Omit<BadgeDef, 'key' | 'tone'>> = {
  baseline: { label: 'Baseline', title: 'Baseline', blurb: 'Not enough history yet, so this repeats your last session.' },
  ladder: { label: 'Progress', title: 'Progress', blurb: 'The next step up the weight ladder.' },
  build: { label: 'Build reps', title: 'Build reps', blurb: "The next weight jump isn't realistic yet, so this adds reps first." },
  hold: { label: 'Hold', title: 'Hold', blurb: 'Same prescription again until it is earned.' },
  'rep-ladder': { label: 'Rep push', title: 'Rep push', blurb: 'Weight is stuck, so reps progress set by set.' },
  deload: { label: 'Deload', title: 'Deload', blurb: 'One lighter session to recover, then rebuild.' },
};

const ADJUSTMENT_BADGES: Record<PlanAdjustment, Omit<BadgeDef, 'key' | 'tone'>> = {
  fatigue: {
    label: 'Fatigue',
    title: "Adjusted for today's fatigue",
    blurb: 'Earlier lifts today worked the same muscles, so these targets are set lower than a fresh session.',
  },
  layoff: {
    label: 'Time off',
    title: 'Adjusted for time off',
    blurb: "You haven't trained this muscle in a while, so expected strength is scaled down for the comeback.",
  },
};

/**
 * Small tags under the recommended sets. Tapping one opens a modal with what
 * the tag means and the full reason for the plan, so the explanation doesn't
 * take up room on the card.
 */
function PlanBadges({
  phase,
  adjustments,
  rationale,
}: {
  phase?: ProgressionPhase;
  adjustments: PlanAdjustment[];
  rationale?: string;
}): React.JSX.Element | null {
  const [open, setOpen] = useState<BadgeDef | null>(null);

  const badges: BadgeDef[] = [
    ...adjustments.map((a) => ({ key: a, tone: a, ...ADJUSTMENT_BADGES[a] })),
    ...(phase ? [{ key: phase, tone: 'phase' as const, ...PHASE_BADGES[phase] }] : []),
  ];
  if (badges.length === 0) return null;

  return (
    <>
      <div className="plan-badges">
        {badges.map((b) => (
          <button key={b.key} type="button" className={`plan-badge plan-badge--${b.tone}`} onClick={() => setOpen(b)}>
            {b.label}
          </button>
        ))}
      </div>
      {open && createPortal(
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="plan-badge-title" onClick={() => setOpen(null)}>
          <div className="modal-card plan-badge-modal" onClick={(e) => e.stopPropagation()}>
            <span className={`plan-badge plan-badge--${open.tone}`}>{open.label}</span>
            <h2 id="plan-badge-title" className="modal-title">{open.title}</h2>
            <p className="modal-message">{open.blurb}</p>
            {rationale && <p className="plan-badge-rationale">{rationale}</p>}
            <button type="button" className="nav-button" onClick={() => setOpen(null)}>
              Got it
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export default PlanBadges;
