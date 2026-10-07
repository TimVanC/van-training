import { useMemo, useState } from 'react';
import BottomNav from '../components/BottomNav';
import ProgressTabs from '../components/ProgressTabs';
import { useDashboardData } from '../hooks/useDashboardData';
import {
  OUTCOME_LABELS,
  effectPhrase,
  sideLabels,
  type ComboInsight,
  type FactorInsight,
  type OutcomeEffect,
  type OutcomeKey,
} from '../lib/readiness.js';

/** Rows every factor card shows first; other answers follow when notable, or on demand. */
const PRIMARY_OUTCOMES: OutcomeKey[] = ['strength', 'effort', 'feel'];

function signed(n: number, suffix = ''): string {
  return `${n > 0 ? '+' : ''}${n}${suffix}`;
}

/** Whether a positive delta is the good direction for this outcome. */
function isGood(delta: number, outcome: OutcomeKey): boolean {
  return outcome === 'soreness' ? delta < 0 : delta > 0;
}

function toneClass(delta: number, outcome: OutcomeKey, notable: boolean): string {
  if (!notable || delta === 0) return 'tone-flat';
  return isGood(delta, outcome) ? 'tone-good' : 'tone-bad';
}

function formatValue(value: number, outcome: OutcomeKey): string {
  return outcome === 'strength' ? signed(value, '%') : value.toFixed(1);
}

/**
 * One outcome as a gap chart: a track with the low side as a hollow dot and
 * the high side as a filled dot, joined by a bar coloured by whether the gap
 * is good news. Scale answers run 1-10; strength runs symmetric around 0.
 */
function GapRow({ effect, strengthSpan }: { effect: OutcomeEffect; strengthSpan: number }): React.JSX.Element {
  const isStrength = effect.outcome === 'strength';
  const min = isStrength ? -strengthSpan : 1;
  const max = isStrength ? strengthSpan : 10;
  const W = 100;
  const x = (v: number) => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * W;
  const xh = x(effect.high);
  const xl = x(effect.low);
  const tone = toneClass(effect.delta, effect.outcome, effect.notable);
  const suffix = isStrength ? '%' : '';
  return (
    <div className={`gap-row ${effect.notable ? 'gap-row--notable' : ''}`}>
      <span className="gap-label">{OUTCOME_LABELS[effect.outcome]}</span>
      <div className="gap-chart">
        <svg viewBox={`0 0 ${W} 12`} preserveAspectRatio="none" aria-hidden>
          <line className="gap-track" x1="0" y1="6" x2={W} y2="6" />
          {isStrength && <line className="gap-zero" x1={x(0)} y1="2" x2={x(0)} y2="10" />}
          <line className={`gap-bar ${tone}`} x1={xl} y1="6" x2={xh} y2="6" />
        </svg>
        <span className="gap-dot gap-dot--low" style={{ left: `${xl}%` }} />
        <span className={`gap-dot gap-dot--high ${tone}`} style={{ left: `${xh}%` }} />
      </div>
      <span className="gap-numbers">
        <span className={`gap-delta ${tone}`}>{signed(effect.delta, suffix)}</span>
        <span className="gap-values">
          {formatValue(effect.high, effect.outcome)} vs {formatValue(effect.low, effect.outcome)}
        </span>
      </span>
    </div>
  );
}

/** "On 6+ sleep nights: harder effort, better feel." */
function factorSummary(insight: FactorInsight): string {
  const sides = sideLabels(insight);
  const notable = insight.effects.filter((e) => e.notable);
  // Lead with strength, effort and feel; other answers only if nothing else is notable.
  const lead = notable.filter((e) => PRIMARY_OUTCOMES.includes(e.outcome));
  const picked = (lead.length > 0 ? lead : notable).slice(0, 3);
  if (picked.length === 0) {
    return `No clear difference between ${sides.high} and ${sides.low}.`;
  }
  const head = sides.high.charAt(0).toUpperCase() + sides.high.slice(1);
  return `${head}: ${picked.map(effectPhrase).join(', ')}.`;
}

function FactorCard({ insight, delayMs }: { insight: FactorInsight; delayMs: number }): React.JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const sides = sideLabels(insight);

  if (insight.status === 'insufficient') {
    return (
      <div className="dash-card ready-card ready-card--quiet dash-animate" style={{ animationDelay: `${delayMs}ms` }}>
        <div className="ready-card-head">
          <span className="ready-card-name">{insight.label}</span>
          <span className="verdict-badge verdict--insufficient">Not yet</span>
        </div>
        <p className="ready-card-note">
          {insight.highCount + insight.lowCount === 0
            ? 'No answers to this question yet.'
            : `Needs 3 workouts on each side of the split. So far ${insight.highCount} vs ${insight.lowCount}.`}
        </p>
      </div>
    );
  }

  const primary = PRIMARY_OUTCOMES.map((o) => insight.effects.find((e) => e.outcome === o)).filter(
    (e): e is OutcomeEffect => e !== undefined,
  );
  const secondary = insight.effects.filter((e) => !PRIMARY_OUTCOMES.includes(e.outcome));
  const visibleSecondary = showAll ? secondary : secondary.filter((e) => e.notable);
  const hiddenCount = secondary.length - visibleSecondary.length;
  const anyNotable = insight.effects.some((e) => e.notable);
  // Strength axis: symmetric, at least ±5%, wide enough for this card's values.
  const strengthSpan = Math.max(
    5,
    ...insight.effects.filter((e) => e.outcome === 'strength').flatMap((e) => [Math.abs(e.high), Math.abs(e.low)]),
  );

  return (
    <div className="dash-card ready-card dash-animate" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="ready-card-head">
        <span className="ready-card-name">{insight.label}</span>
        <span className={`verdict-badge ${anyNotable ? 'verdict--progressing' : 'verdict--steady'}`}>
          {anyNotable ? 'Matters' : 'No clear effect'}
        </span>
        {insight.status === 'early' && <span className="ready-card-early">small sample</span>}
      </div>
      <p className="ready-card-summary">{factorSummary(insight)}</p>
      <p className="gap-legend">
        <span className="gap-legend-item">
          <span className="gap-dot gap-dot--high tone-legend" /> {sides.high} · {insight.highCount}
        </span>
        <span className="gap-legend-item">
          <span className="gap-dot gap-dot--low" /> {sides.low} · {insight.lowCount}
        </span>
      </p>
      <div className="gap-table">
        {primary.map((e) => (
          <GapRow key={e.outcome} effect={e} strengthSpan={strengthSpan} />
        ))}
        {visibleSecondary.length > 0 && <div className="gap-divider" />}
        {visibleSecondary.map((e) => (
          <GapRow key={e.outcome} effect={e} strengthSpan={strengthSpan} />
        ))}
      </div>
      {secondary.length > 0 && (hiddenCount > 0 || showAll) && (
        <button type="button" className="ready-card-toggle" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide the other answers' : `Other answers (${hiddenCount})`}
        </button>
      )}
    </div>
  );
}

function ComboList({ title, combos, tone }: { title: string; combos: ComboInsight[]; tone: 'good' | 'bad' }): React.JSX.Element | null {
  if (combos.length === 0) return null;
  return (
    <div className={`dash-card combo-list combo-list--${tone} dash-animate`}>
      <p className="combo-list-title">{title}</p>
      {combos.map((combo) => (
        <div key={combo.conditions.map((c) => c.factor + c.state).join()} className="combo-item">
          <div className="combo-item-main">
            <div className="combo-chips">
              {combo.conditions.map((c) => (
                <span key={c.factor} className="combo-chip">
                  {c.label}
                </span>
              ))}
            </div>
            <p className="combo-meta">
              {[
                combo.effortDelta != null ? `effort ${signed(combo.effortDelta)}` : null,
                combo.feelDelta != null ? `feel ${signed(combo.feelDelta)}` : null,
                `${combo.count} workouts`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {combo.strengthDelta != null ? (
            <div className="combo-strength">
              <span className={`combo-strength-value tone-${tone}`}>{signed(combo.strengthDelta, '%')}</span>
              <span className="combo-strength-label">strength</span>
            </div>
          ) : (
            <div className="combo-strength">
              <span className={`combo-strength-value tone-${tone}`}>{signed(combo.feelDelta ?? combo.effortDelta ?? 0)}</span>
              <span className="combo-strength-label">{combo.feelDelta != null ? 'feel' : 'effort'}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Readiness(): React.JSX.Element {
  const { data, loading, error, retry } = useDashboardData();
  const [showInfo, setShowInfo] = useState(false);
  const report = data?.readiness ?? null;

  const factors = useMemo(() => {
    if (!report) return [];
    // Clear effects first, then the quiet ones, then anything still waiting on data.
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
          Your check-in answers, matched to how you lifted that day. Every check-in counts the same.
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
            <li><strong>Strength</strong> — each lift's best set against that lift's average over the
              previous 4 weeks (8 if it wasn't done in 4), averaged across the workout. +3% means the
              workout ran 3% above the lifts' recent norm.</li>
            <li><strong>Sides</strong> — each 1-10 answer is split where it divides your workouts most
              evenly. The filled dot is the high side, the hollow dot the low side, and the bar between
              them is the gap. Green or red means the gap is big enough to act on.</li>
            <li><strong>Best and worst days</strong> — pairs and triples of sleep, diet, soreness and
              pre-workout, compared against all your other workouts. Needs 4+ workouts on each side.</li>
            <li><strong>Small sample</strong> — fewer than 6 workouts on a side. Treat those as hints.</li>
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
          {report.headline && (
            <div className="dash-card insight-card dash-animate">
              <p className="insight-title">Clearest signal</p>
              <p className="insight-detail">{report.headline}</p>
            </div>
          )}

          <section className="dash-section">
            <h2 className="dash-section-title dash-animate">When answers line up</h2>
            {report.combos.length === 0 ? (
              <p className="ready-card-note dash-animate">
                Nothing stands out yet. This needs 4+ workouts where the same answers coincide, so it
                fills in as the check-ins stack up.
              </p>
            ) : (
              <>
                <ComboList title="Your best days" combos={better} tone="good" />
                <ComboList title="Your worst days" combos={worse} tone="bad" />
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
            {report.checkins} check-ins, {report.matched} of them matched to a scored workout. These are
            patterns in your own log, not causes: a factor that matters is one worth testing on purpose
            for a few weeks.
          </p>
        </>
      )}

      <BottomNav />
    </div>
  );
}

export default Readiness;
