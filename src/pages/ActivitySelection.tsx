import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActivityType } from '../types/activity';
import { supabase } from '../utils/supabaseClient';
import trophyIcon from '../assets/larry-obrien-icon.png';

const activities: ActivityType[] = ['Lift', 'Run', 'Bike', 'Swim'];

const IconMenu = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

const IconX = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconLogout = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

function ActivitySelection(): React.JSX.Element {
  const navigate = useNavigate();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  function handleSelect(activity: ActivityType): void {
    navigate(`/${activity.toLowerCase()}`);
  }

  function handleOpenAnalytics(): void {
    navigate('/analytics');
  }

  async function handleLogout(): Promise<void> {
    await supabase.auth.signOut();
    setIsSettingsOpen(false);
    navigate('/login', { replace: true });
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <button
          type="button"
          className="hamburger-button"
          onClick={() => setIsSettingsOpen(true)}
          aria-label="Open settings"
        >
          <IconMenu />
        </button>
        <h1>Van Training</h1>
      </div>
      <img src={trophyIcon} alt="" className="trophy-icon" />
      <div className="activity-list">
        {activities.map((activity) => (
          <button key={activity} className="activity-button" onClick={() => handleSelect(activity)}>
            {activity}
          </button>
        ))}
        <button type="button" className="nav-button" onClick={handleOpenAnalytics}>
          Analytics
        </button>
      </div>

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
              <button type="button" className="settings-drawer-item settings-drawer-item--danger" onClick={handleLogout}>
                <IconLogout />
                <span>Log Out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ActivitySelection;
