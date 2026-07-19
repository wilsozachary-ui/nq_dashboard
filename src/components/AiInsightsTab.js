import { useState, useEffect, useCallback } from 'react';
import botApi from '../services/botApi';
import TopstepAccountSelector from './TopstepAccountSelector';
import './AiInsightsTab.css';

// Read-only analysis of how each Mon-Fri trading weekday has actually
// behaved -- opening candle range/volatility (market-wide, same for every
// account) plus that weekday's win rate for the selected account (trade
// outcomes are the only account-scoped half of this data; see
// app/morning_strategy_ai.py's generate_weekday_insights). Purely
// informational -- unlike the Topstep tab's "AI Suggested Parameters"
// panel, nothing here is ever pushed into Trade Parameters.

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

function confidenceLabel(c) {
  if (c >= 0.7) return { label: 'High', cls: 'aic-confidence--high' };
  if (c >= 0.4) return { label: 'Medium', cls: 'aic-confidence--medium' };
  return { label: 'Low', cls: 'aic-confidence--low' };
}

// ── A single two-way split, e.g. Continuation vs Reversal or High First vs
// Low First -- one proportional bar reads at a glance where two separate
// percentage tiles required doing the comparison in your head. Both
// segments are always direct-labeled (only ever 2 categories), so the
// color pairing is identity, never the only way to tell them apart.
function ProportionBar({ leftLabel, leftValue, rightLabel, rightValue }) {
  if (leftValue == null && rightValue == null) return null;
  const left = leftValue ?? 0;
  const right = rightValue ?? 0;
  const total = left + right;
  const leftPct = total > 0 ? (left / total) * 100 : 50;
  const rightPct = 100 - leftPct;
  return (
    <div className="aic-proportion">
      <div className="aic-proportion-track" role="img" aria-label={`${leftLabel} ${fmtPct(leftValue)}, ${rightLabel} ${fmtPct(rightValue)}`}>
        {leftPct > 0 && (
          <span
            className="aic-proportion-segment aic-proportion-segment--a"
            style={{ width: `${leftPct}%` }}
            title={`${leftLabel}: ${fmtPct(leftValue)}`}
          />
        )}
        {rightPct > 0 && (
          <span
            className="aic-proportion-segment aic-proportion-segment--b"
            style={{ width: `${rightPct}%` }}
            title={`${rightLabel}: ${fmtPct(rightValue)}`}
          />
        )}
      </div>
      <div className="aic-proportion-legend">
        <span className="aic-proportion-legend-item aic-proportion-legend-item--a">
          <span className="aic-proportion-swatch aic-proportion-swatch--a" aria-hidden="true" />
          {leftLabel} <b>{fmtPct(leftValue)}</b>
        </span>
        <span className="aic-proportion-legend-item aic-proportion-legend-item--b">
          <span className="aic-proportion-swatch aic-proportion-swatch--b" aria-hidden="true" />
          {rightLabel} <b>{fmtPct(rightValue)}</b>
        </span>
      </div>
    </div>
  );
}

// ── Overview: aggregate sample size/confidence/continuation-reversal rate ──
function OverviewCard({ rec }) {
  if (!rec) return null;
  const conf = confidenceLabel(rec.confidence);
  return (
    <div className="card aic-overview">
      <div className="aic-card-header">
        <span className="panel-title">Recommendation Evidence Overview</span>
        <span className={`aic-confidence-badge ${conf.cls}`}>{conf.label} confidence</span>
      </div>
      {rec.summary && <p className="aic-note">{rec.summary}</p>}
      {rec.data_quality_warning && (
        <div className="aic-warning">⚠️ {rec.data_quality_warning}</div>
      )}

      <div className="aic-meta-row">
        <span className="aic-meta-item"><span className="aic-meta-label">Confidence</span> {fmtPct(rec.confidence)}</span>
        <span className="aic-meta-item"><span className="aic-meta-label">Sample</span> {fmtCount(rec.sample_count)}</span>
        <span className="aic-meta-item"><span className="aic-meta-label">Comparable</span> {fmtCount(rec.comparable_day_count)}</span>
      </div>

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
        <ProportionBar
          leftLabel="Continuation" leftValue={rec.continuation_rate}
          rightLabel="Reversal" rightValue={rec.reversal_rate}
        />
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
    </div>
  );
}

// ── Today's completed opening candle, once recorded ─────────────────────
function TodayCandleCard({ summary, status }) {
  const candle = summary?.candle;
  const oneMinute = candle?.one_minute;

  return (
    <div className="card aic-today-candle">
      <div className="aic-card-header">
        <span className="panel-title">Today's Opening Candle</span>
      </div>

      {status === 'loading' && <p className="aic-note">Loading…</p>}

      {status !== 'loading' && !candle && (
        <p className="aic-note">Not recorded yet — the opening candle is built live during the 08:30–08:31 CT window.</p>
      )}

      {candle && (
        <>
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
              <div className="aic-pair-stats aic-pair-stats--wrap">
                <div className="aic-stat"><span className="aic-stat-label">Entry</span><span className="aic-stat-value">{summary.trade.entry_price ?? '—'}</span></div>
                <div className="aic-stat"><span className="aic-stat-label">Exit</span><span className="aic-stat-value">{summary.trade.exit_price ?? '—'}</span></div>
                <div className="aic-stat"><span className="aic-stat-label">Realized P&amp;L</span><span className="aic-stat-value">{fmtDollars(summary.realized_pnl)}</span></div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── At-a-glance comparison of avg opening range across the 5 trading
// weekdays -- previously this comparison only existed in your head, by
// scanning five separate card headlines scattered across a grid. One hue
// (range is a magnitude, not an identity); today's bar is the one
// identity worth calling out, so it alone gets the accent treatment.
function WeekdayRangeChart({ cards }) {
  const withRange = cards.filter(c => c.avg_range_points != null);
  if (withRange.length === 0) return null;
  const max = Math.max(...withRange.map(c => c.avg_range_points), 0.01);
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  return (
    <div className="card aic-range-chart">
      <div className="aic-card-header">
        <span className="panel-title">Avg Opening Range by Weekday</span>
      </div>
      <div className="aic-range-chart-body">
        {cards.map(card => {
          const value = card.avg_range_points;
          const isToday = card.weekday === todayName;
          const pct = value != null ? Math.max((value / max) * 100, 4) : 0;
          return (
            <div key={card.weekday} className="aic-range-chart-row">
              <span className="aic-range-chart-label">{card.weekday.slice(0, 3)}</span>
              <span className="aic-range-chart-track">
                {value != null && (
                  <span
                    className={`aic-range-chart-bar${isToday ? ' aic-range-chart-bar--today' : ''}`}
                    style={{ width: `${pct}%` }}
                    title={`${card.weekday}: ${fmtPoints(value)} avg range`}
                  />
                )}
              </span>
              <span className="aic-range-chart-value">{value != null ? fmtPoints(value) : '—'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekdayCard({ card }) {
  const conf = confidenceLabel(card.confidence);
  const isToday = card.weekday === new Date().toLocaleDateString('en-US', { weekday: 'long' });
  return (
    <div className={`card aic-card${isToday ? ' aic-card--today' : ''}`}>
      <div className="aic-card-header">
        <span className="aic-weekday">{card.weekday}</span>
        {isToday && <span className="aic-today-badge">Today</span>}
        <span className={`aic-confidence ${conf.cls}`}>{conf.label} confidence</span>
      </div>

      <div className="aic-headline">
        <span className="aic-headline-value">{fmtPoints(card.avg_range_points)}</span>
        <span className="aic-headline-label">avg opening range · {card.sample_days} day{card.sample_days === 1 ? '' : 's'} recorded</span>
      </div>

      <p className="aic-note">{card.note}</p>

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
        <span className="aic-section-label">Context</span>
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

      <div className="aic-intro">
        Read-only analysis of how the NQ opening candle has actually behaved, and what that implies for Morning
        Strategy parameters. Candle data reflects the whole market; win rate and VIX reflect{' '}
        {accountId ? 'the single selected account' : 'all selected accounts combined'} — narrow the account selector
        above to one account to scope it further. Nothing here is applied automatically — review and adjust Trade
        Parameters by hand.
      </div>

      <div className="aic-top-cards">
        <TodayCandleCard summary={todaySummary} status={todayStatus} />
        <OverviewCard rec={rec} />
      </div>

      {status === 'loading' && !cards && (
        <div className="aic-empty">Analyzing historical candles…</div>
      )}
      {status === 'error' && !cards && (
        <div className="aic-empty aic-empty--error">AI Insights unavailable right now.</div>
      )}

      {cards && cards.length > 0 && (
        <div className="aic-chart-row">
          <WeekdayRangeChart cards={cards} />
        </div>
      )}

      {cards && (
        <div className="aic-grid-outer">
          {cards.map(card => (
            <WeekdayCard key={card.weekday} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
