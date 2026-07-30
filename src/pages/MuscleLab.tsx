import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useDashboardData } from '../hooks/useDashboardData';
import type { MuscleHeadReport } from '../lib/muscleHeads.js';

function IconChevronLeft(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function HeadBars({ report }: { report: MuscleHeadReport }): React.JSX.Element {
  const heads = [...report.heads].sort((a, b) => b.sharePct - a.sharePct);
  const maxShare = Math.max(1, heads[0]?.sharePct ?? 0);
  return (
    <div className="head-bars">
      {heads.map((h) => {
        const heat = h.sharePct / maxShare;
        return (
          <div key={h.head} className="head-row">
            <div className="head-row-top">
              <span className="head-name">{h.head}</span>
              <span className="head-share">{h.sharePct}%</span>
            </div>
            <div className="head-bar-track">
              <div
                className="head-bar-fill"
                style={{
                  width: `${Math.max(3, h.sharePct)}%`,
                  backgroundColor: `rgba(245, 132, 38, ${(0.25 + 0.75 * heat).toFixed(2)})`,
                }}
              />
            </div>
            {h.topExercises.length > 0 && (
              <span className="head-sources">via {h.topExercises.join(' · ')}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MuscleLab(): React.JSX.Element {
  const navigate = useNavigate();
  const { data, loading, error, retry } = useDashboardData();

  const reports = useMemo(() => {
    // Most-trained groups first, matching the homepage ordering.
    return [...(data?.muscleHeads ?? [])].sort((a, b) => b.totalSets - a.totalSets);
  }, [data]);

  return (
    <div className="page page--with-nav dash-page">
      <div className="selection-header">
        <button type="button" className="selection-back" onClick={() => navigate('/')} aria-label="Back to home">
          <IconChevronLeft />
        </button>
        <div className="selection-heading">
          <p className="selection-kicker">Muscle Lab</p>
          <h1 className="selection-title">Where your training lands</h1>
        </div>
      </div>

      <p className="muscle-lab-intro dash-animate">
        Each muscle group broken into its heads and regions, weighted by the working sets
        you've logged in the last 8 weeks. Hotter bars = more of your training hits that head.
      </p>

      {loading && (
        <div className="muscle-grid" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="muscle-card skel-card" style={{ padding: '0.9rem 1rem' }}>
              <div className="skel skel-line" style={{ width: '35%', height: '1.05rem', marginBottom: '0.7rem' }} />
              {[0, 1, 2].map((j) => (
                <div key={j} className="skel skel-line" style={{ width: '100%', height: '0.85rem', marginBottom: '0.55rem' }} />
              ))}
            </div>
          ))}
        </div>
      )}

      {!loading && error && !data && (
        <section className="dash-card dash-error-card dash-animate">
          <span className="dash-error-icon" aria-hidden>!</span>
          <p className="dash-error-title">Couldn't load your muscle data</p>
          <p className="dash-error-detail">Check your connection, then give it another shot.</p>
          <button type="button" className="nav-button dash-error-retry" onClick={retry}>
            Try Again
          </button>
        </section>
      )}

      {!loading && data && reports.length === 0 && (
        <p className="analytics-empty-state">No lifts logged in the last 8 weeks yet — train and check back.</p>
      )}

      {!loading && reports.length > 0 && (
        <div className="muscle-grid">
          {reports.map((report, i) => (
            <div key={report.group} className="muscle-card muscle-lab-card dash-animate" style={{ animationDelay: `${i * 55}ms` }}>
              <div className="muscle-card-title-row">
                <span className="muscle-card-name">{report.group}</span>
                <span className="muscle-lab-sets">{report.totalSets} sets / 8 wk</span>
              </div>
              <HeadBars report={report} />
            </div>
          ))}
        </div>
      )}

      {!loading && reports.length > 0 && (
        <p className="muscle-lab-footnote dash-animate">
          Shares are estimates from each exercise's typical emphasis — swap in different
          variations and the heat moves with you.
        </p>
      )}

      <BottomNav />
    </div>
  );
}

export default MuscleLab;
