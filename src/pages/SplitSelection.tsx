import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';

function isImportSplit(name: string): boolean {
  return name.trim().toLowerCase() === 'import split';
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

function SplitSelection(): React.JSX.Element {
  const navigate = useNavigate();
  const [splitNames, setSplitNames] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const userResult = await supabase.auth.getUser();
      const userId = userResult.data.user?.id;
      if (!userId) {
        if (!cancelled) setSplitNames([]);
        return;
      }

      const { data } = await supabase
        .from('splits')
        .select('name')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      const names = ((data ?? []) as { name: string }[])
        .map((s) => s.name)
        .filter((name) => !isImportSplit(name));

      if (!cancelled) setSplitNames(names);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleSelect(splitName: string): void {
    navigate(`/lift/${encodeURIComponent(splitName)}`);
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

      {splitNames === null ? (
        <div className="selection-list">
          {[0, 1].map((i) => (
            <div key={i} className="day-card day-card--skeleton" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      ) : splitNames.length === 0 ? (
        <p className="analytics-empty-state">No splits found.</p>
      ) : (
        <div className="selection-list">
          {splitNames.map((name, i) => (
            <button
              key={name}
              type="button"
              className="day-card day-card--other dash-animate"
              style={{ animationDelay: `${i * 55}ms` }}
              onClick={() => handleSelect(name)}
            >
              <span className="day-card-bar day-card-bar--push" aria-hidden />
              <span className="day-card-body">
                <span className="day-card-top">
                  <span className="day-card-name">{name}</span>
                </span>
                <span className="day-card-sub">Push / Pull / Legs</span>
              </span>
              <span className="day-card-go" aria-hidden>
                <IconChevronRight />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default SplitSelection;
