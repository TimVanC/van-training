import { useMemo, useState } from 'react';
import BottomNav from '../components/BottomNav';
import ProgressTabs from '../components/ProgressTabs';
import { useDashboardData } from '../hooks/useDashboardData';
import {
  OUTCOME_LABELS,
  describeCombo,
  type ComboInsight,
  type FactorInsight,
  type OutcomeEffect,
  type OutcomeKey,
} from '../lib/readiness.js';

/** Rows every factor card shows, in order; other questions appear only when notable. */
const PRIMARY_OUTCOMES: OutcomeKey[] = ['strength', 'effort', 'feel'];

function signed(n: number, suffix = ''): string {
  return `${n > 0 ? '+' : ''}${n}${suffix}`;
}

function deltaClass(delta: number, outcome: OutcomeKey): string {
  // Higher soreness is the bad direction; everything else reads higher = better.
  const good = outcome === 'soreness' ? delta < 0 : delta > 0;
  if (delta === 0) return 'trend-flat';
  return good ? 'trend-up' : 'trend-down';
}

function formatValue(value: number, outcome: OutcomeKey): string {
  return outcome === 'strength' ? signed(value, '%') : value.toFixed(1);
}

function EffectRow({ effect }: { effect: OutcomeEffect }): React.JSX.Element {
  const suffix = effect.outcome === 'strength' ? ' pts' : '';
  return (
    <div className={`ready-row ${effect.notable ? 'ready-row--notable' : ''}`}>
      <span className="ready-row-label">{OUTCOME_LABELS[effect.outcome]}</span>
      <span className="ready-row-value">{formatValue(effect.high, effect.outcome)}</span>
      <span className="ready-row-value ready-row-value--low">{formatValue(effect.low, effect.outcome)}</span>
      <span className={`ready-row-delta ${deltaClass(effect.delta, effect.outcome)}`}>
        {signed(effect.delta, suffix)}
      </span>
    </div>
  );
}

function FactorCard({ insight, delayMs }: { insight: FactorInsight; delayMs: number }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const primary = PRIMARY_OUTCOMES.map((o) => insight.effects.find((e) => e.outcome === o)).filter(
    (e): e is OutcomeEffect => e !== undefined,
  );
  const secondary = insight.effects.filter((e) => !PRIMARY_OUTCOMES.includes(e.outcome));
  const notableSecondary = secondary.filter((e) => e.notable);
  const anyNotable = insight.effects.some((e) => e.notable);

  if (insight.status === 'insufficient') {
    return (
      <div className="dash-card ready-card ready-card--quiet dash-animate" style={{ animationDelay: `${delayMs}ms` }}>
        <div className="ready-card-head">
          <span className="ready-card-name">{insight.label}</span>
          <span className="verdict-badge verdict--insufficient">Early</span>
        </div>
        <p className="ready-card-note">
          {insight.highCount + insight.lowCount === 0
            ? 'No answers yet.'
            : `Needs at least 3 workouts on each side of the split (${insight.highCount} vs ${insight.lowCount} so far).`}
        </p>
      </div>
    );
  }

  return (
    <div className="dash-card ready-card dash-animate" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="ready-card-head">
        <span className="ready-card-name">{insight.label}</span>
        <span className={`verdict-badge ${anyNotable ? 'verdict--progressing' : 'verdict--steady'}`}>
          {anyNotable ? 'Matters' : 'No clear effect'}
        </span>
        {insight.status === 'early' && <span className="ready-card-early">small sample</span>}
      </div>
      <div className="ready-table">
        <div className="ready-row ready-row--header">
          <span className="ready-row-label" />
          <span className="ready-row-value">
            {insight.highLabel}
            <small>{insight.highCount}</small>
          </span>
          <span className="ready-row-value ready-row-value--low">
            {insight.lowLabel}
            <small>{insight.lowCount}</small>
          </span>
          <span className="ready-row-delta">diff</span>
        </div>
        {primary.map((e) => (
          <EffectRow key={e.outcome} effect={e} />
        ))}
        {expanded && secondary.map((e) => <EffectRow key={e.outcome} effect={e} />)}
      </div>
      {!expanded && notableSecondary.length > 0 && (
        <p className="ready-card-note">
          Also:{' '}
          {notableSecondary
            .map((e) => `${OUTCOME_LABELS[e.outcome].toLowerCase()} ${e.high} vs ${e.low}`)
            .join(' · ')}
        </p>
      )}
      {secondary.length > 0 && (
        <button type="button" className="ready-card-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Fewer questions' : 'Every question'}
        </button>
      )}
    </div>
  );
}

function ComboCard({ combo, delayMs }: { combo: ComboInsight; delayMs: number }): React.JSX.Element {
  const better = combo.direction === 'better';
  return (
    <div
      className={`dash-card ready-combo ${better ? 'ready-combo--better' : 'ready-combo--worse'} dash-animate`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="ready-combo-conditions">
        {combo.conditions.map((c) => (
          <span key={c.factor} className="ready-chip">
            {c.label}
          </span>
        ))}
      </div>
      <div className="ready-combo-stats">
        {combo.strengthDelta != null && (
          <div className="ready-stat">
            <span className={`ready-stat-value ${combo.strengthDelta >= 0 ? 'trend-up' : 'trend-down'}`}>
              {signed(combo.strengthDelta, '%')}
            </span>
            <span className="ready-stat-label">strength</span>
          </div>
        )}
        {combo.effortDelta != null && (
          <div className="ready-stat">
            <span className={`ready-stat-value ${combo.effortDelta >= 0 ? 'trend-up' : 'trend-down'}`}>
              {signed(combo.effortDelta)}
            </span>
            <span className="ready-stat-label">effort</span>
          </div>
        )}
        {combo.feelDelta != null && (
          <div className="ready-stat">
            <span className={`ready-stat-value ${combo.feelDelta >= 0 ? 'trend-up' : 'trend-down'}`}>
              {signed(combo.feelDelta)}
            </span>
            <span className="ready-stat-label">feel</span>
          </div>
        )}
        <div className="ready-stat">
          <span className="ready-stat-value">{combo.count}</span>
          <span className="ready-stat-label">workouts</span>
        </div>
      </div>
      <p className="ready-combo-detail">{describeCombo(combo)}</p>
    </div>
  );
}

function Readiness(): React.JSX.Element {
  const { data, loading, error, retry } = useDashboardData();
  const [showInfo, setShowInfo] = useState(false);
  const report = data?.readiness ?? null;

  const factors = useMemo(() => {
    if (!report) return [];
    // Factors with a clear effect first, then the rest, early/insufficient last.
    const rank = (f: FactorInsight) =>
      f.status === 'insufficient' ? 2 : f.effects.some((e) => e.notable) ? 0 : 1;
    return [...report.factors].sort((a, b) => rank(a) - rank(b));
  }, [report]);

  const better = report?.combos.filter((c) => c.direction === 'better') ?? [];
  const worse = report?.combos.filter((c) => c.direction === 'worse') ?? [];
  const hasAnything = report !== null && report.checkins > 0;

  return (
    <div className="page page--with-nav dash-page">
      <ProgressTabs />
      <div className="selection-header">
        <div className="selection-heading">
          <p className="selection-kicker">Readiness</p>
          <h1 className="selection-title">What moves your workouts</h1>
        </div>
      </div>

      <div className="ready-intro-row dash-animate">
        <p className="muscle-lab-intro">
          Every check-in you've ever filed, weighted equally, matched against how you actually
          lifted that day. Strength is each workout's lifts against their own average over the
          previous 4 weeks.
        </p>
        <button
          type="button"
          className="dash-info-button"
          aria-label="How is this calculated?"
          aria-expanded={showInfo}
          onClick={() => setShowInfo((v) => !v)}
        >
          i
        </button>
      </div>
      {showInfo && (
        <div className="dash-card dash-info-panel dash-animate">
          <ul className="dash-info-list">
            <li><strong>Strength</strong> — for each lift in a workout, its best set's estimated one-rep max
              against that lift's average over the previous 4 weeks (8 if it wasn't done in 4). The
              workout's score is the average across its lifts, as a percent above or below.</li>
            <li><strong>Splits</strong> — each 1-10 answer is cut at the point that divides your workouts
              most evenly, so the two sides are comparable. Pre-workout is yes vs no.</li>
            <li><strong>Diff</strong> — the high side minus the low side: percentage points for strength,
              scale points for everything else. Bold rows are big enough to act on.</li>
            <li><strong>Combinations</strong> — pairs and triples of sleep, diet, soreness and pre-workout,
              compared against all your other workouts. Only shown with 4+ workouts on each side.</li>
            <li><strong>Sample size</strong> — every number shows how many workouts are behind it. Under 6
              a side is marked a small sample; treat those as hints, not rules.</li>
          </ul>
        </div>
      )}

      {loading && (
        <div aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="dash-card skel-card">
              <div className="skel skel-line" style={{ width: '30%', height: '1rem', marginBottom: '0.7rem' }} />
              {[0, 1, 2].map((j) => (
                <div key={j} className="skel skel-line" style={{ width: '100%', height: '0.8rem', marginBottom: '0.5rem' }} />
              ))}
            </div>
          ))}
        </div>
      )}

      {!loading && error && !data && (
        <section className="dash-card dash-error-card dash-animate">
          <span className="dash-error-icon" aria-hidden>!</span>
          <p className="dash-error-title">Couldn't load your check-ins</p>
          <p className="dash-error-detail">Check your connection, then give it another shot.</p>
          <button type="button" className="nav-button dash-error-retry" onClick={retry}>
            Try Again
          </button>
        </section>
      )}

      {!loading && data && !hasAnything && (
        <p className="analytics-empty-state">
          No check-ins yet. Answer the questions after a workout and this page fills in as the
          answers start to line up with your lifting.
        </p>
      )}

      {!loading && report && hasAnything && (
        <>
          <p className="ready-count dash-animate">
            All {report.checkins} check-ins count the same · {report.matched} matched to a scored workout
          </p>

          {report.headline && (
            <div className="dash-card insight-card dash-animate">
              <p className="insight-title">Clearest signal</p>
              <p className="insight-detail">{report.headline}</p>
            </div>
          )}

          <section className="dash-section">
            <h2 className="dash-section-title dash-animate">When things line up</h2>
            {report.combos.length === 0 ? (
              <p className="ready-card-note dash-animate">
                No combination stands out yet. Combinations need 4+ workouts where the same answers
                coincide, so this fills in as the check-ins stack up.
              </p>
            ) : (
              <>
                {better.map((c, i) => (
                  <ComboCard key={c.conditions.map((x) => x.factor + x.state).join()} combo={c} delayMs={i * 60} />
                ))}
                {worse.map((c, i) => (
                  <ComboCard
                    key={c.conditions.map((x) => x.factor + x.state).join()}
                    combo={c}
                    delayMs={(better.length + i) * 60}
                  />
                ))}
              </>
            )}
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title dash-animate">One answer at a time</h2>
            {factors.map((f, i) => (
              <FactorCard key={f.factor} insight={f} delayMs={i * 55} />
            ))}
          </section>

          <p className="muscle-lab-footnote dash-animate">
            These are patterns in your own log, not causes. A factor that "matters" is one worth
            testing on purpose for a few weeks.
          </p>
        </>
      )}

      <BottomNav />
    </div>
  );
}

export default Readiness;
