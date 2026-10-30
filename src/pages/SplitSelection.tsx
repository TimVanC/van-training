import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import { describeSplitDays } from '../lib/rotation.js';
import { invalidateDashboardCache } from '../hooks/useDashboardData';

interface SplitRow {
  id: string;
  name: string;
  is_preferred: boolean | null;
  workouts: Array<{ name: string; order_index: number }> | null;
}

interface SplitCard {
  id: string;
  name: string;
  preferred: boolean;
  /** "Push / Pull / Legs / Upper / Lower", from the split's own day names. */
  summary: string;
}

function isImportSplit(name: string): boolean {
  return name.trim().toLowerCase() === 'import split';
}

function toCard(row: SplitRow): SplitCard {
  const dayNames = [...(row.workouts ?? [])]
    .sort((a, b) => a.order_index - b.order_index)
    .map((w) => w.name);
  return {
    id: row.id,
    name: row.name,
    preferred: row.is_preferred === true,
    summary: describeSplitDays(dayNames) || 'No days yet',
  };
}

function IconChevronLeft(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconChevronRight(): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconStar({ filled }: { filled: boolean }): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="12 2.5 15.1 8.8 22 9.8 17 14.7 18.2 21.6 12 18.3 5.8 21.6 7 14.7 2 9.8 8.9 8.8" />
    </svg>
  );
}

function SplitSelection(): React.JSX.Element {
  const navigate = useNavigate();
  const [splits, setSplits] = useState<SplitCard[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const userResult = await supabase.auth.getUser();
      const userId = userResult.data.user?.id;
      if (!userId) {
        if (!cancelled) setSplits([]);
        return;
      }

      const { data } = await supabase
        .from('splits')
        .select('id, name, is_preferred, workouts(name, order_index)')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      const cards = ((data ?? []) as SplitRow[])
        .filter((row) => !isImportSplit(row.name))
        .map(toCard);

      if (!cancelled) setSplits(cards);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleSelect(splitName: string): void {
    navigate(`/lift/${encodeURIComponent(splitName)}`);
  }

  /**
   * Star a split as the default the home card and reminders follow, or
   * un-star it to go back to following whichever split was trained last.
   * Only one split can be preferred, so any current star is cleared first.
   */
  async function handleTogglePreferred(card: SplitCard): Promise<void> {
    if (savingId || !splits) return;
    setSavingId(card.id);
    try {
      const userResult = await supabase.auth.getUser();
      const userId = userResult.data.user?.id;
      if (!userId) return;

      const makePreferred = !card.preferred;
      const clear = await supabase
        .from('splits')
        .update({ is_preferred: false })
        .eq('user_id', userId)
        .eq('is_preferred', true);
      if (clear.error) return;
      if (makePreferred) {
        const set = await supabase.from('splits').update({ is_preferred: true }).eq('id', card.id);
        if (set.error) return;
      }

      setSplits(splits.map((s) => ({ ...s, preferred: makePreferred && s.id === card.id })));
      invalidateDashboardCache();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="page selection-page">
      <div className="selection-header">
        <button type="button" className="selection-back" onClick={() => navigate('/')} aria-label="Back to home">
          <IconChevronLeft />
        </button>
        <div className="selection-heading">
          <p className="selection-kicker">Start a workout</p>
          <h1 className="selection-title">Choose a split</h1>
        </div>
      </div>

      {splits === null ? (
        <div className="selection-list">
          {[0, 1].map((i) => (
            <div key={i} className="day-card day-card--skeleton" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      ) : splits.length === 0 ? (
        <p className="analytics-empty-state">No splits found.</p>
      ) : (
        <>
          <div className="selection-list">
            {splits.map((card, i) => (
              <div
                key={card.id}
                className={`day-card day-card--other dash-animate${card.preferred ? ' day-card--next' : ''}`}
                style={{ animationDelay: `${i * 55}ms` }}
              >
                <span className="day-card-bar day-card-bar--push" aria-hidden />
                <button type="button" className="day-card-main" onClick={() => handleSelect(card.name)}>
                  <span className="day-card-body">
                    <span className="day-card-top">
                      <span className="day-card-name">{card.name}</span>
                      {card.preferred && <span className="day-card-badge">Default</span>}
                    </span>
                    <span className="day-card-sub">{card.summary}</span>
                  </span>
                  <span className="day-card-go" aria-hidden>
                    <IconChevronRight />
                  </span>
                </button>
                <button
                  type="button"
                  className="day-card-star"
                  aria-pressed={card.preferred}
                  aria-label={card.preferred ? `${card.name} is your default split` : `Make ${card.name} your default split`}
                  disabled={savingId !== null}
                  onClick={() => void handleTogglePreferred(card)}
                >
                  <IconStar filled={card.preferred} />
                </button>
              </div>
            ))}
          </div>
          <p className="selection-hint">
            Star a split to make it your default. The home screen and your reminders follow it; with no star they
            follow whichever split you trained last.
          </p>
        </>
      )}
    </div>
  );
}

export default SplitSelection;
