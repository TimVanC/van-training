import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { supabase } from '../utils/supabaseClient';
import type {
  PeakGroupSummary,
  PeakLiftSummary,
  PeakPoint,
  PeakReport,
} from '../lib/peak.js';

// ----------------------------------------------------------------- data

let cache: { data: PeakReport; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function fetchPeak(): Promise<PeakReport | null> {
  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const response = await fetch('/api/getPeak', {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) return null;
    return (await response.json()) as PeakReport;
  } catch {
    return null;
  }
}

function usePeakData(): { data: PeakReport | null; loading: boolean; error: boolean; retry: () => void } {
  const [data, setData] = useState<PeakReport | null>(cache?.data ?? null);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return;
    let cancelled = false;
    void fetchPeak().then((result) => {
      if (result) cache = { data: result, fetchedAt: Date.now() };
      if (cancelled) return;
      if (result) {
        setData(result);
        setError(false);
      } else {
        setError(true);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    cache = null;
    setError(false);
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  return { data, loading, error, retry };
}

// -------------------------------------------------------------- helpers

type Band = 'at' | 'near' | 'below' | 'far' | 'none';

function bandFor(pct: number | null): Band {
  if (pct == null) return 'none';
  if (pct >= 97) return 'at';
  if (pct >= 90) return 'near';
  if (pct >= 75) return 'below';
  return 'far';
}

const BAND_LABEL: Record<Band, string> = {
  at: 'At peak',
  near: 'Near peak',
  below: 'Below peak',
  far: 'Well below',
  none: 'Resting',
};

function formatPct(pct: number | null): string {
  if (pct == null) return '—';
  return `${Math.round(pct)}%`;
}

function formatDate(iso: string, withYear = true): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const base = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!withYear) return base;
  return `${base} '${String(d.getFullYear()).slice(2)}`;
}

function formatMonthYear(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', " '");
}

function formatLoad(point: PeakPoint, bodyweight: boolean): string {
  if (!bodyweight) {
    const w = Number.isInteger(point.weight) ? String(point.weight) : point.weight.toFixed(1);
    return `${w} × ${point.reps}`;
  }
  if (point.weight === 0) return `BW × ${point.reps}`;
  if (point.weight < 0) return `BW −${Math.abs(point.weight)} × ${point.reps}`;
  return `BW +${point.weight} × ${point.reps}`;
}

function daysAgo(iso: string, now: Date): number {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - d.getTime()) / 86_400_000));
}

function relativeLabel(iso: string, now: Date): string {
  const days = daysAgo(iso, now);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

// ------------------------------------------------------------ components

function IconChevronLeft(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function PeakRing({ pct }: { pct: number | null }): React.JSX.Element {
  const size = 118;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = pct ?? 0;
  const band = bandFor(pct);
  return (
    <div className={`peak-ring peak-band--${band}`} role="img" aria-label={pct == null ? 'No recent lifts' : `${Math.round(pct)} percent of peak strength`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="peak-ring-track" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="peak-ring-fill"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="peak-ring-label">
        <span className="peak-ring-value">{formatPct(pct)}</span>
        <span className="peak-ring-caption">of peak</span>
      </div>
    </div>
  );
}

function PctBadge({ pct, stale }: { pct: number | null; stale?: boolean }): React.JSX.Element {
  const band = stale ? 'none' : bandFor(pct);
  return (
    <span className={`peak-badge peak-band--${band}`}>
      {formatPct(pct)}
      <span className="peak-badge-word">{stale ? 'resting' : BAND_LABEL[band].toLowerCase()}</span>
    </span>
  );
}

function PctBar({ pct, stale }: { pct: number | null; stale?: boolean }): React.JSX.Element {
  const band = stale ? 'none' : bandFor(pct);
  return (
    <div className="peak-bar-track">
      <div className={`peak-bar-fill peak-band--${band}`} style={{ width: `${Math.max(2, pct ?? 0)}%` }} />
    </div>
  );
}

function LiftRow({ lift, now }: { lift: PeakLiftSummary; now: Date }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const peakWhen = lift.peak.dateEstimated ? `~${formatMonthYear(lift.peak.date)}` : formatDate(lift.peak.date);
  return (
    <div className={`peak-lift ${lift.stale ? 'peak-lift--stale' : ''}`}>
      <button type="button" className="peak-lift-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <div className="peak-lift-main">
          <span className="peak-lift-name">
            {lift.label}
            {lift.atPeak && <span className="peak-lift-star" title="All-time best is your current lift">★</span>}
          </span>
          <span className="peak-lift-line">
            <span className="peak-lift-k">Now</span> {formatLoad(lift.current, lift.bodyweight)}
            <span className="peak-lift-tag">{lift.current.splitAbbr}</span>
            <span className="peak-lift-when">{relativeLabel(lift.current.date, now)}</span>
          </span>
          <span className="peak-lift-line peak-lift-line--peak">
            <span className="peak-lift-k">Peak</span> {formatLoad(lift.peak, lift.bodyweight)}
            <span className="peak-lift-tag">{lift.peak.splitAbbr}</span>
            <span className="peak-lift-when">{peakWhen}</span>
          </span>
        </div>
        <PctBadge pct={lift.pctOfPeak} stale={lift.stale} />
      </button>
      {open && (
        <div className="peak-split-trail" aria-label="Best in each split">
          {lift.bySplit.map((p, i) => {
            const isPeak = p.splitAbbr === lift.peak.splitAbbr && p.score === lift.peak.score;
            return (
              <span key={p.splitAbbr} className="peak-split-step">
                {i > 0 && <span className="peak-split-arrow" aria-hidden>→</span>}
                <span className={`peak-split-chip ${isPeak ? 'peak-split-chip--peak' : ''}`}>
                  <span className="peak-split-abbr">{p.splitAbbr}</span>
                  <span className="peak-split-load">{formatLoad(p, lift.bodyweight)}</span>
                </span>
              </span>
            );
          })}
          <span className="peak-split-note">
            {lift.sessions} sessions · first {formatMonthYear(lift.firstTrained)}
            {lift.stale && ` · last ${formatDate(lift.lastTrained)}`}
          </span>
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  now,
  delay,
  windowWeeks,
}: {
  group: PeakGroupSummary;
  now: Date;
  delay: number;
  windowWeeks: number;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const resting = group.pctOfPeak == null;
  const band = bandFor(group.pctOfPeak);
  const heads = useMemo(() => group.heads.filter((h) => h.pctOfPeak != null), [group.heads]);
  const liftLabel = (key: string) => group.lifts.find((l) => l.key === key)?.label ?? key;

  let subline: string;
  if (resting) {
    subline = `Nothing logged in the last ${windowWeeks} weeks · ${group.totalLifts} lift${group.totalLifts === 1 ? '' : 's'} on record`;
  } else {
    const bits = [`${group.atPeakCount} of ${group.activeLifts} at all-time best`];
    if (group.peakEra) bits.push(`peak era ${group.peakEra}`);
    subline = bits.join(' · ');
  }

  return (
    <div
      className={`muscle-card peak-card dash-animate ${expanded ? 'muscle-card--expanded' : ''} ${resting ? 'peak-card--resting' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <button type="button" className="muscle-card-head" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <div className="muscle-card-title-row">
          <span className="muscle-card-name">{group.group}</span>
          <span className={`verdict-badge peak-band--${band}`}>{BAND_LABEL[band]}</span>
        </div>
        <div className="peak-card-body">
          <span className="peak-card-pct">{formatPct(group.pctOfPeak)}</span>
          <div className="peak-card-bar-wrap">
            <PctBar pct={group.pctOfPeak} stale={resting} />
            <span className="peak-card-sub">{subline}</span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="muscle-card-detail">
          {heads.length > 0 && (
            <>
              <p className="peak-section-label">By head</p>
              <div className="head-bars peak-heads">
                {heads.map((h) => (
                  <div key={h.head} className="head-row">
                    <div className="head-row-top">
                      <span className="head-name">{h.head}</span>
                      <span className={`head-share peak-text--${bandFor(h.pctOfPeak)}`}>{formatPct(h.pctOfPeak)}</span>
                    </div>
                    <PctBar pct={h.pctOfPeak} />
                    {h.liftKeys.length > 0 && (
                      <span className="head-sources">via {[...new Set(h.liftKeys)].slice(0, 3).map(liftLabel).join(' · ')}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          <p className="peak-section-label">Lifts</p>
          <div className="peak-lift-list">
            {group.lifts.map((lift) => (
              <LiftRow key={lift.key} lift={lift} now={now} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ page

function PeakStrength(): React.JSX.Element {
  const navigate = useNavigate();
  const { data, loading, error, retry } = usePeakData();
  const now = useMemo(() => new Date(), []);

  const groups = useMemo(() => {
    const list = data?.groups ?? [];
    // Groups with recent training first (keeping anatomical order inside each half).
    return [...list.filter((g) => g.pctOfPeak != null), ...list.filter((g) => g.pctOfPeak == null)];
  }, [data]);

  const windowWeeks = Math.round((data?.recentWindowDays ?? 42) / 7);

  return (
    <div className="page page--with-nav dash-page">
      <div className="selection-header">
        <button type="button" className="selection-back" onClick={() => navigate('/')} aria-label="Back to home">
          <IconChevronLeft />
        </button>
        <div className="selection-heading">
          <p className="selection-kicker">Peak Strength</p>
          <h1 className="selection-title">You vs. your best</h1>
        </div>
      </div>

      <p className="muscle-lab-intro dash-animate">
        Every lift you've ever logged, from the old spreadsheets through today, scored on its best set
        each session. Each number is how close your latest session sits to the strongest you've ever been.
      </p>

      {loading && (
        <>
          <div className="dash-card skel-card" aria-hidden>
            <div className="skel skel-line" style={{ width: '45%', height: '1.1rem', marginBottom: '0.8rem' }} />
            <div className="skel skel-block" style={{ height: '118px' }} />
          </div>
          <div className="muscle-grid" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="muscle-card skel-card" style={{ padding: '0.9rem 1rem' }}>
                <div className="skel skel-line" style={{ width: '35%', height: '1.05rem', marginBottom: '0.7rem' }} />
                <div className="skel skel-line" style={{ width: '100%', height: '0.85rem' }} />
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && error && !data && (
        <section className="dash-card dash-error-card dash-animate">
          <span className="dash-error-icon" aria-hidden>!</span>
          <p className="dash-error-title">Couldn't load your peak data</p>
          <p className="dash-error-detail">Check your connection, then give it another shot.</p>
          <button type="button" className="nav-button dash-error-retry" onClick={retry}>
            Try Again
          </button>
        </section>
      )}

      {!loading && data && data.totalLifts === 0 && (
        <p className="analytics-empty-state">No lifts on record yet — log a workout and come back.</p>
      )}

      {!loading && data && data.totalLifts > 0 && (
        <>
          <section className="dash-card peak-hero dash-animate">
            <PeakRing pct={data.overallPctOfPeak} />
            <div className="peak-hero-stats">
              <div className="peak-hero-stat">
                <span className="peak-hero-value">{data.liftsAtPeak}</span>
                <span className="peak-hero-label">lift{data.liftsAtPeak === 1 ? '' : 's'} at all-time best right now</span>
              </div>
              <div className="peak-hero-stat">
                <span className="peak-hero-value">{data.activeLifts}</span>
                <span className="peak-hero-label">lifts trained in the last {windowWeeks} weeks</span>
              </div>
              <div className="peak-hero-stat">
                <span className="peak-hero-value">{data.totalLifts}</span>
                <span className="peak-hero-label">
                  lifts on record{data.firstDate ? ` since ${formatMonthYear(data.firstDate)}` : ''}
                </span>
              </div>
            </div>
          </section>

          {data.splits.length > 0 && (
            <div className="peak-eras dash-animate" style={{ animationDelay: '40ms' }} aria-label="Training eras">
              {data.splits.map((s) => (
                <span key={s.abbr} className={`peak-era ${s.source === 'history' ? 'peak-era--history' : ''}`} title={`${s.name} · ${s.sessions} sessions`}>
                  <span className="peak-era-abbr">{s.abbr}</span>
                  <span className="peak-era-range">
                    {formatMonthYear(s.firstDate)}
                    {s.firstDate.slice(0, 7) !== s.lastDate.slice(0, 7) && ` – ${formatMonthYear(s.lastDate)}`}
                  </span>
                </span>
              ))}
            </div>
          )}

          <div className="muscle-grid">
            {groups.map((group, i) => (
              <GroupCard key={group.group} group={group} now={now} delay={60 + i * 50} windowWeeks={windowWeeks} />
            ))}
          </div>

          <p className="muscle-lab-footnote dash-animate">
            Score = load × (1 + reps ÷ 30) on your best set, so 90 × 10 beats 90 × 8. "Now" is your most recent
            session for that lift, good day or bad; lifts not trained in the last {windowWeeks} weeks show as
            resting and stay out of the group scores. Bodyweight moves count {`${200} lb`} of you plus any added or assisted load. Spreadsheet-era
            dates marked ~ are estimated from their position in the log.
          </p>
        </>
      )}

      <BottomNav />
    </div>
  );
}

export default PeakStrength;
