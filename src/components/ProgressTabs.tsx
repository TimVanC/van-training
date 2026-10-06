import { useLocation, useNavigate } from 'react-router-dom';
import { useCoachEnabled } from '../hooks/useCoachEnabled';

const TABS = [
  { path: '/analytics', label: 'Lifts' },
  { path: '/muscles', label: 'Muscles' },
  { path: '/peak', label: 'Peak' },
  { path: '/readiness', label: 'Readiness' },
] as const;

const COACH_TAB = { path: '/coach', label: 'Coach' } as const;

function ProgressTabs(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  // The coach tab only appears once the server says Coach Van can answer.
  const coachEnabled = useCoachEnabled();
  const tabs = coachEnabled ? [...TABS, COACH_TAB] : TABS;

  return (
    <nav className="analytics-range-pills progress-tabs" aria-label="Progress views">
      {tabs.map((tab) => {
        const active = location.pathname === tab.path;
        return (
          <button
            key={tab.path}
            type="button"
            className={`range-pill ${active ? 'range-pill--active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => navigate(tab.path)}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

export default ProgressTabs;
