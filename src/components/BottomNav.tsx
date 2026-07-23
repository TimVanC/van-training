import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';

const ADMIN_EMAIL = 'timvancau@gmail.com';

const IconHome = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const IconCalendar = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const IconPlus = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconChart = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const IconGear = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconShield = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const IconLogout = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const IconRun = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="13" cy="4" r="2" />
    <path d="m6 22 4-6 2-3 3 2 3 5" />
    <path d="m9 12 3-4 4 2 3-1" />
  </svg>
);

const IconX = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function BottomNav(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email ?? null;
      if (!cancelled) setIsAdmin(email === ADMIN_EMAIL);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout(): Promise<void> {
    await supabase.auth.signOut();
    setIsSettingsOpen(false);
    navigate('/login', { replace: true });
  }

  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      <nav className="bottom-nav" aria-label="Main navigation">
        <button
          type="button"
          className={`bottom-nav-item ${isActive('/') ? 'bottom-nav-item--active' : ''}`}
          onClick={() => navigate('/')}
          aria-label="Home"
        >
          <IconHome />
          <span>Home</span>
        </button>
        <button
          type="button"
          className={`bottom-nav-item ${isActive('/calendar') ? 'bottom-nav-item--active' : ''}`}
          onClick={() => navigate('/calendar')}
          aria-label="Calendar"
        >
          <IconCalendar />
          <span>Calendar</span>
        </button>
        <button
          type="button"
          className="bottom-nav-log"
          onClick={() => navigate('/lift')}
          aria-label="Log a workout"
        >
          <IconPlus />
        </button>
        <button
          type="button"
          className={`bottom-nav-item ${isActive('/analytics') ? 'bottom-nav-item--active' : ''}`}
          onClick={() => navigate('/analytics')}
          aria-label="Analytics"
        >
          <IconChart />
          <span>Analytics</span>
        </button>
        <button
          type="button"
          className="bottom-nav-item"
          onClick={() => setIsSettingsOpen(true)}
          aria-label="Settings"
        >
          <IconGear />
          <span>Settings</span>
        </button>
      </nav>

      {isSettingsOpen && (
        <div className="settings-drawer-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="settings-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="settings-drawer-header">
              <h2>Settings</h2>
              <button
                type="button"
                className="settings-drawer-close"
                onClick={() => setIsSettingsOpen(false)}
                aria-label="Close settings"
              >
                <IconX />
              </button>
            </div>
            <div className="settings-drawer-body">
              <button
                type="button"
                className="settings-drawer-item"
                onClick={() => {
                  setIsSettingsOpen(false);
                  navigate('/activities');
                }}
              >
                <IconRun />
                <span>Log Cardio</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="settings-drawer-item"
                  onClick={() => {
                    setIsSettingsOpen(false);
                    navigate('/admin');
                  }}
                >
                  <IconShield />
                  <span>Admin</span>
                </button>
              )}
              <button
                type="button"
                className="settings-drawer-item settings-drawer-item--danger"
                onClick={handleLogout}
              >
                <IconLogout />
                <span>Log Out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default BottomNav;
