import { useNavigate } from 'react-router-dom';
import type { ActivityType } from '../types/activity';

const activities: ActivityType[] = ['Lift', 'Run', 'Bike', 'Swim'];

function ActivitySelection(): React.JSX.Element {
  const navigate = useNavigate();

  function handleSelect(activity: ActivityType): void {
    navigate(`/${activity.toLowerCase()}`);
  }

  return (
    <div className="page">
      <h1>Van Training</h1>
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
      </div>
    </div>
  );
}

export default ActivitySelection;
