import { useNavigate } from 'react-router-dom';
import type { ActivityType } from '../types/activity';

const activities: ActivityType[] = ['Lift', 'Run', 'Bike', 'Swim'];

function ActivitySelection(): React.JSX.Element {
  const navigate = useNavigate();

  function handleSelect(activity: ActivityType): void {
    navigate(`/${activity.toLowerCase()}`);
  }

  function handleOpenAnalytics(): void {
    navigate('/analytics');
  }

  function handleOpenSettings(): void {
    navigate('/settings');
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>Van Training</h1>
        <button
          type="button"
          className="settings-gear-button"
          onClick={handleOpenSettings}
          aria-label="Settings"
        >
          ⚙️
        </button>
      </div>
      <div className="activity-list">
        {activities.map((activity) => (
          <button
            key={activity}
            className="activity-button"
            onClick={() => handleSelect(activity)}
          >
            {activity}
          </button>
        ))}
        <button type="button" className="nav-button" onClick={handleOpenAnalytics}>
          📊 Analytics
        </button>
      </div>
    </div>
  );
}

export default ActivitySelection;
