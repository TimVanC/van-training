import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';

const ADMIN_EMAIL = 'timvancau@gmail.com';

const IconArrowLeft = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

function AdminPortal(): React.JSX.Element | null {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email ?? null;
      if (cancelled) return;
      if (email !== ADMIN_EMAIL) {
        navigate('/', { replace: true });
        return;
      }
      setAuthorized(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (!authorized) return null;

  return (
    <div className="page">
      <div className="page-header-row">
        <button
          type="button"
          className="hamburger-button"
          onClick={() => navigate('/')}
          aria-label="Back to home"
        >
          <IconArrowLeft />
        </button>
        <h1>Admin</h1>
      </div>
    </div>
  );
}

export default AdminPortal;
