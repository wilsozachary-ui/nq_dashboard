import { useState, useEffect, useCallback } from 'react';
import botApi from '../services/botApi';
import './CandleMetricsPanel.css';

// Trade Recap tab -- shows the opening 7 seconds of NQ price action for
// whatever day is selected in the calendar above, plus the Morning
// Strategy Live parameters/outcome that ran that day (if any), joined
// server-side by date (see /morning_strategy/daily_summary/{date}).
// Pure historical REST read, no WebSocket -- same contract as
// TradeLifecyclePanel, just a different slice of the same selected day.

function fmtPrice(v) {
  return v != null ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}
function fmtPoints(v) {
  return v != null ? `${Number(v).toFixed(2)} pts` : '—';
}
function fmtDollars(v) {
  return v != null ? `$${Math.round(v)}` : '—';
}
function fmtPnl(v) {
  if (v == null) return '—';
  const n = Number(v);
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;
}
function pnlClass(v) {
  if (v == null) return '';
  return Number(v) >= 0 ? 'value-positive' : 'value-negative';
}

function outcomeLabel(trade) {
  if (!trade) return null;
  if (trade.tp_hit) return { label: 'Take Profit', cls: 'cmp-outcome--win' };
  if (trade.trail_hit) return { label: 'Trailing Stop', cls: 'cmp-outcome--win' };
  if (trade.sl_hit) return { label: 'Stop Loss', cls: 'cmp-outcome--loss' };
  if (trade.manual_exit) return { label: 'Manual Exit', cls: 'cmp-outcome--neutral' };
  return { label: 'Open/Unknown', cls: 'cmp-outcome--neutral' };
}

export default function CandleMetricsPanel({ date }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!date) {
      setData(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    botApi.getMorningStrategyDailySummary(date, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setData(result);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        setError(err.message || 'Failed to load candle metrics.');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [date, retryKey]);

  const handleRetry = useCallback(() => setRetryKey(k => k + 1), []);

  const candle = data?.candle;
  const trade = data?.trade;
  const outcome = outcomeLabel(trade);

  return (
    <div className="card cmp-panel">
      <div className="cmp-header">
        <h3 className="panel-title">Opening Candle{date ? ` — ${date}` : ''}</h3>
      </div>

      {!date && <div className="cmp-empty">Click a day in the calendar above to see its opening candle.</div>}

      {date && loading && (
        <div className="cmp-status-bar cmp-status-bar--loading" role="status">
          <span className="cmp-spinner" aria-hidden="true" />
          <span>Loading…</span>
        </div>
      )}

      {date && error && !loading && (
        <div className="cmp-status-bar cmp-status-bar--error" role="alert">
          <span>&#9888; {error}</span>
          <button className="cmp-retry-btn" onClick={handleRetry}>Retry</button>
        </div>
      )}

      {date && !loading && !error && !candle && (
        <div className="cmp-empty">No opening candle recorded for {date}.</div>
      )}

      {date && !loading && !error && candle && (
        <>
          <div className="cmp-grid">
            <div className="cmp-stat"><span className="cmp-stat-label">Open</span><span className="cmp-stat-value">{fmtPrice(candle.open)}</span></div>
            <div className="cmp-stat"><span className="cmp-stat-label">High</span><span className="cmp-stat-value">{fmtPrice(candle.high)}</span></div>
            <div className="cmp-stat"><span className="cmp-stat-label">Low</span><span className="cmp-stat-value">{fmtPrice(candle.low)}</span></div>
            <div className="cmp-stat"><span className="cmp-stat-label">Close</span><span className="cmp-stat-value">{fmtPrice(candle.close)}</span></div>
            <div className="cmp-stat"><span className="cmp-stat-label">Range</span><span className="cmp-stat-value">{fmtPoints(candle.range_points)}</span></div>
            <div className="cmp-stat"><span className="cmp-stat-label">Body</span><span className="cmp-stat-value">{fmtPoints(candle.body_points)}</span></div>
            <div className="cmp-stat"><span className="cmp-stat-label">Upper Wick</span><span className="cmp-stat-value">{fmtPoints(candle.upper_wick_points)}</span></div>
            <div className="cmp-stat"><span className="cmp-stat-label">Lower Wick</span><span className="cmp-stat-value">{fmtPoints(candle.lower_wick_points)}</span></div>
            <div className="cmp-stat"><span className="cmp-stat-label">Tick Speed</span><span className="cmp-stat-value">{candle.tick_speed != null ? `${candle.tick_speed}/s` : '—'}</span></div>
            <div className="cmp-stat"><span className="cmp-stat-label">Ticks Recorded</span><span className="cmp-stat-value">{candle.tick_count ?? '—'}</span></div>
          </div>

          {trade && (
            <div className="cmp-trade">
              <div className="cmp-trade-header">
                <span className="cmp-trade-title">Morning Strategy Live</span>
                {outcome && <span className={`cmp-outcome ${outcome.cls}`}>{outcome.label}</span>}
                {trade.realized_pnl != null && (
                  <span className={`cmp-trade-pnl ${pnlClass(trade.realized_pnl)}`}>{fmtPnl(trade.realized_pnl)}</span>
                )}
              </div>
              <div className="cmp-trade-params">
                <span>Spread {fmtPoints(trade.spread_points)}</span>
                <span>TP {fmtDollars(trade.tp_dollars)}</span>
                <span>SL {fmtDollars(trade.sl_dollars)}</span>
                <span>Trailing {trade.trailing_enabled ? fmtPoints(trade.trailing_points) : 'Off'}</span>
                <span>Size {trade.contract_size ?? '—'}</span>
                <span>VIX at fire {trade.vix_at_fire != null ? Number(trade.vix_at_fire).toFixed(1) : '—'}</span>
              </div>
            </div>
          )}
          {!trade && (
            <div className="cmp-no-trade">No Morning Strategy Live trade recorded for {date}.</div>
          )}
        </>
      )}
    </div>
  );
}
