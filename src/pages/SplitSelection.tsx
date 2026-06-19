import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';

function isImportSplit(name: string): boolean {
  return name.trim().toLowerCase() === 'import split';
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
    <div className="page">
      <h1>Select Split</h1>
      {splitNames === null ? (
        <p>Loading…</p>
      ) : splitNames.length === 0 ? (
        <p>No splits found.</p>
      ) : (
        <div className="button-list">
          {splitNames.map((name) => (
            <button
              key={name}
              className="nav-button"
              onClick={() => handleSelect(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default SplitSelection;
