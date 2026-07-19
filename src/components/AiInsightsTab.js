import { useState, useEffect, useCallback } from 'react';
import botApi from '../services/botApi';
import TopstepAccountSelector from './TopstepAccountSelector';
import {
  AI_PARAMETERS,
  applyToTradeParameters,
  fmtPoints as fmtParamPoints,
  fmtDollars as fmtParamDollars,
} from './morningStrategyShared';
import './AiInsightsTab.css';

// Read-only analysis of how the NQ opening candle has actually behaved, and
// what that implies for Morning Strategy parameters. Structured around the
// three questions a trader actually opens this tab to answer, in order:
// "What should I use? Why? How much should I trust it?" -- everything else
// (historical evidence, weekday breakdown, methodology) sits beneath that
// decision summary rather than competing with it for attention.

// A single day/sample below this count is not enough to call something a
// pattern -- matches the backend's own MIN_COMPARABLE_DAYS (see
// app/morning_strategy_ai.py). Duplicated here only as a presentation
// threshold for the continuation/reversal bar (the raw counts themselves
// are always honest either way); the weekday cards' own sufficiency comes
// straight from the backend's `insufficient_evidence` flag, no duplication
// needed there.
const MIN_EVIDENCE_SAMPLES = 3;

// Deliberately not morningStrategyShared's useSelectedAccount() -- that
// hook always resolves to "first selected account," which made sense for
// single-account-at-a-time views (Trade Parameters targets one bot
// instance) but is the wrong default here: Morning Strategy Live can fire
// on a different account on different days, so "first selected" would
// silently hide whichever days traded on a different account. Combined
// (account_id=null) is the useful default across multiple/all-selected
// accounts; narrowing to exactly one account in the selector is what
// scopes the win-rate/contract-size guidance to that account specifically.
function useInsightsAccountFilter() {
  const [accountId, setAccountId] = useState(() => {
    const sel = window.topstepAccountsSelected;
    return sel && sel.length === 1 ? sel[0] : null;
  });

  useEffect(() => {
    const handler = e => {
      const sel = e.detail.selected;
      setAccountId(sel && sel.length === 1 ? sel[0] : null);
    };
    window.addEventListener('nq:accounts-changed', handler);
    return () => window.removeEventListener('nq:accounts-changed', handler);
  }, []);

  return accountId;
}

// Chicago-local "today," matching MorningCandleRecorder's own date-key
// convention (window_start.astimezone(CHICAGO).strftime("%Y-%m-%d")) --
// used to look up today's own candle once it's recorded.
function chicagoToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Whether it's currently before 08:30 CT (Chicago) -- gates whether
// "no candle yet" reads as "hasn't started" (compact, expected) vs.
// "should be here by now and isn't" (a bit more visible).
function isBeforeChicagoMarketOpen() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date());
  const get = type => Number(parts.find(p => p.type === type)?.value ?? 0);
  const minutes = (get('hour') % 24) * 60 + get('minute');
  return minutes < 8 * 60 + 30;
}

function fmtPoints(v) {
  return v != null ? `${Number(v).toFixed(2)} pts` : '—';
}
function fmtSignedPoints(v) {
  if (v == null) return '—';
  const n = Number(v);
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)} pts`;
}
function fmtDollars(v) {
  return v != null ? `$${Math.round(v)}` : '—';
}
function fmtPct(v) {
  return v != null ? `${Math.round(v * 100)}%` : '—';
}
function fmtVix(v) {
  return v != null ? Number(v).toFixed(1) : '—';
}
function fmtCount(v) {
  return Number.isFinite(v) ? `${v} day${v === 1 ? '' : 's'}` : '—';
}
function fmtSessionCount(v) {
  return Number.isFinite(v) ? `${v} session${v === 1 ? '' : 's'}` : '—';
}

function confidenceLabel(c) {
  if (c >= 0.7) return { label: 'High', cls: 'aic-confidence--high' };
  if (c >= 0.4) return { label: 'Medium', cls: 'aic-confidence--medium' };
  return { label: 'Low', cls: 'aic-confidence--low' };
}

// ── Hero card: "What should I use? Why? How much should I trust it?" ────
function RecommendedSetupCard({ rec }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [applied, setApplied] = useState(false);

  if (!rec) {
    return (
      <div className="card aic-hero">
        <span className="panel-title">Recommended Setup for Next Session</span>
        <p className="aic-note">Loading…</p>
      </div>
    );
  }

  const conf = confidenceLabel(rec.confidence);
  const handleApply = () => {
    applyToTradeParameters(rec);
    setApplied(true);
    setTimeout(() => setApplied(false), 2500);
  };

  return (
    <div className="card aic-hero">
      <div className="aic-hero-head">
        <span className="panel-title">Recommended Setup for Next Session</span>
        <span className={`aic-confidence-badge ${conf.cls}`}>{conf.label} confidence</span>
      </div>

      {/* Same formatters as the reasoning list below (both display the
          exact same recommended_* values) -- not the candle-stat fmtPoints
          used elsewhere in this file, which shows 2-decimal precision for
          genuinely fractional tick-derived figures; these are already
          rounded to whole points/dollars server-side. */}
      <div className="aic-hero-headline">
        Spread {fmtParamPoints(rec.recommended_spread_points)} · TP {fmtParamDollars(rec.recommended_tp_dollars)} · SL{' '}
        {fmtParamDollars(rec.recommended_sl_dollars)} · Trail {fmtParamPoints(rec.recommended_trailing_points)} ·{' '}
        {rec.recommended_contract_size} contract{rec.recommended_contract_size === 1 ? '' : 's'}
      </div>

      <div className="aic-hero-confidence-line">
        {conf.label} confidence — based on {fmtSessionCount(rec.sample_count)} recorded, {' '}
        {fmtSessionCount(rec.comparable_day_count)} usable for parameter evidence.
      </div>

      {rec.data_quality_warning && (
        <div className="aic-warning">⚠️ {rec.data_quality_warning}</div>
      )}

      <div className="aic-hero-actions">
        <button type="button" className="aic-btn aic-btn--secondary" onClick={() => setShowReasoning(v => !v)}>
          {showReasoning ? 'Hide reasoning' : 'View reasoning'}
        </button>
        <button type="button" className={`aic-btn aic-btn--primary${applied ? ' aic-btn--applied' : ''}`} onClick={handleApply}>
          {applied ? '✓ Copied to Trade Parameters' : 'Copy to Trade Parameters'}
        </button>
      </div>
      <p className="aic-hero-disclaimer">
        Copies values into Trade Parameters for review — never saves, arms, or trades automatically.
      </p>

      {showReasoning && (
        <div className="aic-reasoning">
          {AI_PARAMETERS.map(param => {
            const value = rec[`recommended_${param.key}`];
            const reason = rec.parameter_reasons?.[param.key];
            if (value == null && !reason) return null;
            return (
              <div key={param.key} className="aic-reasoning-row">
                <span className="aic-reasoning-term">{param.label} {param.fmt(value)}:</span>
                <span className="aic-reasoning-text">{reason || 'No evidence recorded yet.'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Today's opening candle: a compact strip before/without data, the full
// story once the candle is actually recorded. ────────────────────────────
function TodayCandleSection({ summary, status }) {
  const candle = summary?.candle;
  const oneMinute = candle?.one_minute;

  if (status === 'loading') {
    return <div className="aic-strip">Loading today's candle…</div>;
  }

  if (!candle) {
    return (
      <div className="aic-strip">
        {isBeforeChicagoMarketOpen()
          ? "Today's candle begins recording at 8:30 AM CT."
          : 'No candle recorded for today yet.'}
      </div>
    );
  }

  return (
    <div className="card aic-today-candle">
      <div className="aic-card-header">
        <span className="panel-title">Today's Opening Candle</span>
        <span className="aic-scope-badge aic-scope-badge--market">Market-wide</span>
      </div>

      {candle.feed_quality && !candle.feed_quality.recording_complete && (
        <div className="aic-warning">⚠️ Recording was incomplete for today's window — figures below are partial.</div>
      )}

      {oneMinute && (
        <div className="aic-headline">
          <span className="aic-headline-value">{fmtPoints(oneMinute.range_points)}</span>
          <span className="aic-headline-label">
            08:30 candle range · body {fmtPoints(oneMinute.body_points)} · closed {fmtPct(oneMinute.close_location_pct)} up its range
          </span>
        </div>
      )}

      <div className="aic-section">
        <span className="aic-section-label">First 10 Seconds (Decision Window)</span>
        <div className="aic-pair-stats aic-pair-stats--wrap">
          <div className="aic-stat"><span className="aic-stat-label">Range</span><span className="aic-stat-value">{fmtPoints(candle.range_points)}</span></div>
          <div className="aic-stat"><span className="aic-stat-label">Move</span><span className="aic-stat-value">{fmtSignedPoints(candle.signed_move_points)}</span></div>
          <div className="aic-stat"><span className="aic-stat-label">Extreme First</span><span className="aic-stat-value">{candle.extreme_first ?? '—'}</span></div>
          <div className="aic-stat"><span className="aic-stat-label">Direction Changes</span><span className="aic-stat-value">{candle.direction_changes_first_10s ?? '—'}</span></div>
        </div>
      </div>

      {oneMinute && (
        <div className="aic-section">
          <span className="aic-section-label">Completed 08:30 Candle (One Minute)</span>
          <div className="aic-pair-stats aic-pair-stats--wrap">
            <div className="aic-stat"><span className="aic-stat-label">Upper Wick</span><span className="aic-stat-value">{fmtPoints(oneMinute.upper_wick_points)}</span></div>
            <div className="aic-stat"><span className="aic-stat-label">Lower Wick</span><span className="aic-stat-value">{fmtPoints(oneMinute.lower_wick_points)}</span></div>
            <div className="aic-stat"><span className="aic-stat-label">Tick Count</span><span className="aic-stat-value">{oneMinute.tick_count ?? '—'}</span></div>
          </div>
        </div>
      )}

      {summary?.trade && (
        <div className="aic-section">
          <span className="aic-section-label">Today's Trade</span>
          <span className="aic-scope-badge aic-scope-badge--account">Selected account</span>
          <div className="aic-pair-stats aic-pair-stats--wrap">
            <div className="aic-stat"><span className="aic-stat-label">Entry</span><span className="aic-stat-value">{summary.trade.entry_price ?? '—'}</span></div>
            <div className="aic-stat"><span className="aic-stat-label">Exit</span><span className="aic-stat-value">{summary.trade.exit_price ?? '—'}</span></div>
            <div className="aic-stat"><span className="aic-stat-label">Realized P&amp;L</span><span className="aic-stat-value">{fmtDollars(summary.realized_pnl)}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── A single two-way split with counts alongside percentages, e.g.
// "Reversal: 3 of 3 favorable moves" -- a bare percentage from a handful
// of samples reads as an established pattern; the count makes the sample
// size impossible to miss.
function ProportionBar({ leftLabel, leftCount, rightLabel, rightCount, total }) {
  const leftPct = total > 0 ? (leftCount / total) * 100 : 50;
  const rightPct = 100 - leftPct;
  return (
    <div className="aic-proportion">
      <div
        className="aic-proportion-track"
        role="img"
        aria-label={`${leftLabel} ${leftCount} of ${total}, ${rightLabel} ${rightCount} of ${total}`}
      >
        {leftPct > 0 && <span className="aic-proportion-segment aic-proportion-segment--a" style={{ width: `${leftPct}%` }} />}
        {rightPct > 0 && <span className="aic-proportion-segment aic-proportion-segment--b" style={{ width: `${rightPct}%` }} />}
      </div>
      <div className="aic-proportion-legend">
        <span className="aic-proportion-legend-item aic-proportion-legend-item--a">
          <span className="aic-proportion-swatch aic-proportion-swatch--a" aria-hidden="true" />
          {leftLabel}: <b>{leftCount} of {total}</b> favorable moves
        </span>
        <span className="aic-proportion-legend-item aic-proportion-legend-item--b">
          <span className="aic-proportion-swatch aic-proportion-swatch--b" aria-hidden="true" />
          {rightLabel}: <b>{rightCount} of {total}</b>
        </span>
      </div>
    </div>
  );
}

// ── Historical evidence: market-wide candle behavior the recommendation
// above was actually built from. ─────────────────────────────────────────
function EvidenceCard({ rec }) {
  if (!rec) return null;
  const favorableCount = rec.favorable_move_count ?? 0;
  const hasEnoughForBar = favorableCount >= MIN_EVIDENCE_SAMPLES
    && rec.continuation_count != null && rec.reversal_count != null;
  const completeCapture = (rec.incomplete_recording_days ?? 0) === 0;

  return (
    <div className="card aic-evidence">
      <div className="aic-card-header">
        <span className="panel-title">Historical Evidence</span>
        <span className="aic-scope-badge aic-scope-badge--market">Market-wide</span>
      </div>
      {rec.summary && <p className="aic-note">{rec.summary}</p>}

      <div className="aic-pair-stats">
        <div className="aic-stat">
          <span className="aic-stat-label">10s Avg Range</span>
          <span className="aic-stat-value">{fmtPoints(rec.avg_range_10s_points)}</span>
        </div>
        <div className="aic-stat">
          <span className="aic-stat-label">1m Avg Range</span>
          <span className="aic-stat-value">{fmtPoints(rec.avg_range_1m_points)}</span>
        </div>
      </div>

      <div className="aic-section">
        <span className="aic-section-label">Continuation vs. Reversal</span>
        {hasEnoughForBar ? (
          <ProportionBar
            leftLabel="Continuation" leftCount={rec.continuation_count}
            rightLabel="Reversal" rightCount={rec.reversal_count}
            total={favorableCount}
          />
        ) : (
          <p className="aic-note aic-note--muted">
            {favorableCount} of {favorableCount} favorable move{favorableCount === 1 ? '' : 's'} recorded —
            insufficient evidence to compare continuation vs. reversal yet (need at least {MIN_EVIDENCE_SAMPLES}).
          </p>
        )}
      </div>

      {(rec.high_first_count != null || rec.low_first_count != null) && (
        <div className="aic-section">
          <span className="aic-section-label">High First vs. Low First</span>
          <div className="aic-count-split">
            <span><b>{rec.high_first_count ?? '—'}</b> days high first</span>
            <span><b>{rec.low_first_count ?? '—'}</b> days low first</span>
          </div>
        </div>
      )}

      <div className="aic-section">
        <span className="aic-section-label">Data Quality</span>
        <div className="aic-quality-row">
          <span className={`aic-quality-badge${completeCapture ? ' aic-quality-badge--ok' : ' aic-quality-badge--warn'}`}>
            {completeCapture ? 'Complete tick capture' : `${rec.incomplete_recording_days} partial recording(s)`}
          </span>
          <span className="aic-note aic-note--muted">
            {fmtSessionCount(rec.sample_count)} recorded · {fmtSessionCount(rec.comparable_day_count)} usable for
            tick-level replay evidence.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── One weekday card. Sparse days are shown honestly, not styled to
// resemble a statistically established pattern. ─────────────────────────
function WeekdayCard({ card }) {
  const conf = confidenceLabel(card.confidence);
  const isToday = card.weekday === new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const insufficient = card.insufficient_evidence && card.sample_days > 0;

  return (
    <div className={`card aic-card${isToday ? ' aic-card--today' : ''}${insufficient ? ' aic-card--sparse' : ''}`}>
      <div className="aic-card-header">
        <span className="aic-weekday">{card.weekday}</span>
        {isToday && <span className="aic-today-badge">Today</span>}
        <span className={`aic-confidence ${conf.cls}`}>{conf.label} confidence</span>
      </div>

      {insufficient ? (
        <div className="aic-sparse-note">
          <span className="aic-sparse-count">{fmtCount(card.sample_days)}</span>
          <span>— insufficient evidence for a pattern yet</span>
        </div>
      ) : (
        <div className="aic-headline">
          <span className="aic-headline-value">{fmtPoints(card.avg_range_points)}</span>
          <span className="aic-headline-label">avg opening range · {fmtCount(card.sample_days)} recorded</span>
        </div>
      )}

      <p className="aic-note">{card.note}</p>

      {!insufficient && (
        <>
          <div className="aic-section">
            <span className="aic-section-label">Suggested Parameters</span>
            <div className="aic-grid">
              <div className="aic-stat"><span className="aic-stat-label">Spread</span><span className="aic-stat-value">{fmtPoints(card.recommended_spread_points)}</span></div>
              <div className="aic-stat"><span className="aic-stat-label">Take Profit</span><span className="aic-stat-value">{fmtDollars(card.recommended_tp_dollars)}</span></div>
              <div className="aic-stat"><span className="aic-stat-label">Stop Loss</span><span className="aic-stat-value">{fmtDollars(card.recommended_sl_dollars)}</span></div>
              <div className="aic-stat"><span className="aic-stat-label">Trailing</span><span className="aic-stat-value">{fmtPoints(card.recommended_trailing_points)}</span></div>
              <div className="aic-stat"><span className="aic-stat-label">Contract Size</span><span className="aic-stat-value">{card.recommended_contract_size ?? '—'}</span></div>
            </div>
          </div>

          <div className="aic-section aic-section--muted">
            <span className="aic-section-label">Context <span className="aic-scope-badge aic-scope-badge--account">Selected account</span></span>
            <div className="aic-grid">
              <div className="aic-stat"><span className="aic-stat-label">Win Rate</span><span className="aic-stat-value">{fmtPct(card.win_rate)}</span></div>
              <div className="aic-stat"><span className="aic-stat-label">Avg VIX</span><span className="aic-stat-value">{fmtVix(card.avg_vix)}</span></div>
            </div>
          </div>

          {card.avg_vix_wins != null && card.avg_vix_losses != null && (
            <div className="aic-vix-split">
              <span className="aic-vix-split-item aic-vix-split-item--win">Wins avg VIX {fmtVix(card.avg_vix_wins)}</span>
              <span className="aic-vix-split-item aic-vix-split-item--loss">Losses avg VIX {fmtVix(card.avg_vix_losses)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── At-a-glance comparison of avg opening range across weekdays that have
// enough evidence to compare meaningfully. A weekday below the threshold
// is left out of the chart entirely (not drawn as a same-weight bar next
// to weekdays with real history) and called out separately underneath.
function WeekdayRangeChart({ cards }) {
  const eligible = cards.filter(c => c.avg_range_points != null && !c.insufficient_evidence);
  const sparse = cards.filter(c => c.insufficient_evidence && c.sample_days > 0);
  if (eligible.length === 0) return null;
  const max = Math.max(...eligible.map(c => c.avg_range_points), 0.01);
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  return (
    <div className="card aic-range-chart">
      <div className="aic-card-header">
        <span className="panel-title">Avg Opening Range by Weekday</span>
      </div>
      <div className="aic-range-chart-body">
        {eligible.map(card => {
          const value = card.avg_range_points;
          const isToday = card.weekday === todayName;
          const pct = Math.max((value / max) * 100, 4);
          return (
            <div key={card.weekday} className="aic-range-chart-row">
              <span className="aic-range-chart-label">{card.weekday.slice(0, 3)}</span>
              <span className="aic-range-chart-track">
                <span
                  className={`aic-range-chart-bar${isToday ? ' aic-range-chart-bar--today' : ''}`}
                  style={{ width: `${pct}%` }}
                  title={`${card.weekday}: ${fmtPoints(value)} avg range (${fmtCount(card.sample_days)})`}
                />
              </span>
              <span className="aic-range-chart-value">{fmtPoints(value)}</span>
            </div>
          );
        })}
      </div>
      {sparse.length > 0 && (
        <p className="aic-note aic-note--muted aic-range-chart-footnote">
          {sparse.map(c => `${c.weekday} (${fmtCount(c.sample_days)})`).join(', ')} not shown — insufficient evidence.
        </p>
      )}
    </div>
  );
}

function MethodologyDrawer({ rec }) {
  const [open, setOpen] = useState(false);
  if (!rec) return null;
  return (
    <div className="card aic-methodology">
      <button type="button" className="aic-methodology-toggle" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span>How this recommendation was calculated</span>
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="aic-methodology-body">
          <p className="aic-note">{rec.evidence_methodology}</p>
          <p className="aic-note">
            Model version <code>{rec.model_version}</code>. This system is currently heuristic/advisory, not a
            trained statistical model — parameters are derived from replaying recorded tick data against simple
            rules, or from real closed-trade outcomes where explicitly labeled. Every value above dated from the
            most recent {rec.sample_count} recorded session(s), excluding today's own (not-yet-complete) candle.
          </p>
          {rec.data_quality_warning && <p className="aic-note">{rec.data_quality_warning}</p>}
        </div>
      )}
    </div>
  );
}

export default function AiInsightsTab() {
  const accountId = useInsightsAccountFilter();
  const [cards, setCards] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [rec, setRec] = useState(null);
  const [todaySummary, setTodaySummary] = useState(null);
  const [todayStatus, setTodayStatus] = useState('loading');

  const load = useCallback(() => {
    setStatus('loading');
    const controller = new AbortController();
    botApi.getWeekdayInsights(accountId, controller.signal)
      .then(result => {
        const weekdays = result?.weekdays;
        if (!Array.isArray(weekdays)) { setStatus('error'); return; }
        setCards(weekdays);
        setStatus('ready');
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        setStatus('error');
      });
    return controller;
  }, [accountId]);

  useEffect(() => {
    const controller = load();
    return () => controller && controller.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    botApi.getMorningStrategyAiRecommendations(controller.signal)
      .then(setRec)
      .catch(err => { if (err.name !== 'AbortError') setRec(null); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setTodayStatus('loading');
    botApi.getMorningStrategyDailySummary(chicagoToday(), controller.signal)
      .then(summary => { setTodaySummary(summary); setTodayStatus('ready'); })
      .catch(err => {
        if (err.name === 'AbortError') return;
        // A 404 (no candle recorded yet, e.g. before the market opens) is
        // an expected, normal state here -- not a fetch failure worth
        // showing an error banner for.
        setTodaySummary(null);
        setTodayStatus('ready');
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="ai-insights-tab">
      <div className="tab-topbar">
        <span className="tab-title">AI Insights</span>
        <TopstepAccountSelector strategy="insights" />
      </div>

      <div className="aic-workspace">
        <div className="aic-intro">
          Candle data reflects the whole market; win rate and VIX reflect{' '}
          {accountId ? 'the single selected account' : 'all selected accounts combined'} — narrow the account
          selector above to scope it further.
        </div>

        <RecommendedSetupCard rec={rec} />

        <TodayCandleSection summary={todaySummary} status={todayStatus} />

        <EvidenceCard rec={rec} />

        {status === 'loading' && !cards && (
          <div className="aic-empty">Analyzing historical candles…</div>
        )}
        {status === 'error' && !cards && (
          <div className="aic-empty aic-empty--error">AI Insights unavailable right now.</div>
        )}

        {cards && cards.length > 0 && <WeekdayRangeChart cards={cards} />}

        {cards && (
          <div className="aic-weekday-section">
            <span className="aic-section-heading">Weekday Breakdown</span>
            <div className="aic-grid-outer">
              {cards.map(card => (
                <WeekdayCard key={card.weekday} card={card} />
              ))}
            </div>
          </div>
        )}

        <MethodologyDrawer rec={rec} />
      </div>
    </div>
  );
}
