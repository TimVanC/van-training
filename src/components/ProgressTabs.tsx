import { useLocation, useNavigate } from 'react-router-dom';

const TABS = [
  { path: '/analytics', label: 'Lifts' },
  { path: '/muscles', label: 'Muscles' },
  { path: '/peak', label: 'Peak' },
] as const;

function ProgressTabs(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className="analytics-range-pills progress-tabs" aria-label="Progress views">
      {TABS.map((tab) => {
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
