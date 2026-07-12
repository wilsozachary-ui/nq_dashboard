import { useState, useEffect, useCallback } from 'react';
import botApi from '../services/botApi';
import './TradeLifecyclePanel.css';

// ── Trade Recap: per-trade lifecycle history ─────────────────────────────────
//
// Pure historical REST panel -- no WebSocket, no live subscription. Shown
// below the P&L calendar in TradeRecapTab; click a day there to populate
// this panel. Deliberately does not import from ActivityPanel.js (the
// live/WS-only activity feed) -- that component is explicitly out of scope
// for a recap-only tab, so the small formatting helpers below are local
// rather than a cross-dependency onto an excluded live component.

const EVENT_META = {
  dual_entry_armed: { label: 'Armed',              cls: 'tlp-evt--armed' },
  long_entry:        { label: 'Long Entry',         cls: 'tlp-evt--entry' },
  short_entry:       { label: 'Short Entry',        cls: 'tlp-evt--entry' },
  trail_adjust:      { label: 'Trailing SL Moved',  cls: 'tlp-evt--trail' },
  partial_exit:      { label: 'Partial Exit',       cls: 'tlp-evt--partial' },
  tp_hit:            { label: 'Take Profit Hit',    cls: 'tlp-evt--win' },
  sl_hit:            { label: 'Stop Loss Hit',      cls: 'tlp-evt--loss' },
  long_exit:         { label: 'Long Exit',          cls: 'tlp-evt--exit' },
  short_exit:        { label: 'Short Exit',         cls: 'tlp-evt--exit' },
  manual_exit:       { label: 'Manual Exit',        cls: 'tlp-evt--exit' },
  bracket_failed:    { label: 'Bracket Failed',     cls: 'tlp-evt--fail' },
};

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtPrice(v) {
  return v != null ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
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

function describeEvent(event) {
  const meta = event.meta || {};
  switch (event.type) {
    case 'dual_entry_armed':
      return `Buy stop ${fmtPrice(meta.long_stop_price)} / Sell stop ${fmtPrice(meta.short_stop_price)}`;
    case 'long_entry':
    case 'short_entry':
      return `Filled @ ${fmtPrice(event.price)}${meta.sl != null ? ` · SL ${fmtPrice(meta.sl)}` : ''}${meta.tp != null ? ` · TP ${fmtPrice(meta.tp)}` : ''}`;
    case 'trail_adjust':
      return `${fmtPrice(meta.previous_trailing_sl)} → ${fmtPrice(event.price)}`;
    case 'partial_exit':
      return `@ ${fmtPrice(event.price)}`;
    case 'tp_hit':
    case 'sl_hit':
    case 'long_exit':
    case 'short_exit':
    case 'manual_exit':
      return `Closed @ ${fmtPrice(event.price)}`;
    case 'bracket_failed':
      return meta.entry != null ? `Entry @ ${fmtPrice(meta.entry)}, SL/TP placement failed` : 'SL/TP placement failed';
    default:
      return event.type;
  }
}

function EventRow({ event }) {
  const meta = EVENT_META[event.type] || { label: event.type, cls: '' };
  return (
    <div className={`tlp-event ${meta.cls}`}>
      <span className="tlp-event-time">{fmtTime(event.timestamp)}</span>
      <span className="tlp-event-label">{meta.label}</span>
      <span className="tlp-event-detail">{describeEvent(event)}</span>
      {event.pnl != null && <span className={`tlp-event-pnl ${pnlClass(event.pnl)}`}>{fmtPnl(event.pnl)}</span>}
    </div>
  );
}

const STATUS_LABEL = {
  closed:  'CLOSED',
  open:    'OPEN',
  unknown: 'INCOMPLETE',
  failed:  'FAILED',
};

function TradeCard({ trade }) {
  const sideLabel = trade.side ? trade.side.toUpperCase() : '—';
  return (
    <div className={`tlp-trade tlp-trade--${trade.status}`}>
      <div className="tlp-trade-header">
        <span className={`tlp-side-badge tlp-side-badge--${trade.side || 'unknown'}`}>{sideLabel}</span>
        <span className="tlp-trade-time-range">
          {fmtTime(trade.opened_at)}
          {trade.closed_at ? ` → ${fmtTime(trade.closed_at)}` : ''}
        </span>
        <span className="tlp-trade-prices">
          {fmtPrice(trade.entry_price)}{trade.exit_price != null ? ` → ${fmtPrice(trade.exit_price)}` : ''}
        </span>
        <span className={`tlp-status-badge tlp-status-badge--${trade.status}`}>{STATUS_LABEL[trade.status] || trade.status}</span>
        {trade.realized_pnl != null && (
          <span className={`tlp-trade-pnl ${pnlClass(trade.realized_pnl)}`}>{fmtPnl(trade.realized_pnl)}</span>
        )}
      </div>
      <div className="tlp-events">
        {trade.events.map((event, i) => (
          <EventRow key={i} event={event} />
        ))}
      </div>
    </div>
  );
}

export default function TradeLifecyclePanel({ date, strategy, accountId }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
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

    botApi.getRecapDay(date, strategy, accountId, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setData(result);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        setError(err.message || 'Failed to load trade history.');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [date, strategy, accountId, retryKey]);

  const handleRetry = useCallback(() => setRetryKey(k => k + 1), []);

  const streaks = data?.streaks;
  const trades = data?.trades || [];

  return (
    <div className="card tlp-panel">
      <div className="tlp-header">
        <h3 className="panel-title tlp-title">Trade Lifecycle{date ? ` — ${date}` : ''}</h3>
        {streaks && (
          <div className="tlp-streaks">
            <span className={`tlp-streak-pill${streaks.current.type ? ` tlp-streak-pill--${streaks.current.type}` : ''}`}>
              {streaks.current.type
                ? `${streaks.current.count} ${streaks.current.type === 'win' ? 'win' : 'loss'} streak`
                : 'No active streak'}
            </span>
            <span className="tlp-streak-best">Best win streak: {streaks.best_win_streak}</span>
            <span className="tlp-streak-best">Best loss streak: {streaks.best_loss_streak}</span>
          </div>
        )}
      </div>

      {!date && (
        <div className="tlp-empty">Click a day in the calendar above to see its trade lifecycle.</div>
      )}

      {date && loading && (
        <div className="tlp-status-bar tlp-status-bar--loading" role="status">
          <span className="tlp-spinner" aria-hidden="true" />
          <span>Loading…</span>
        </div>
      )}

      {date && error && !loading && (
        <div className="tlp-status-bar tlp-status-bar--error" role="alert">
          <span>&#9888; {error}</span>
          <button className="tlp-retry-btn" onClick={handleRetry}>Retry</button>
        </div>
      )}

      {date && !loading && !error && trades.length === 0 && (
        <div className="tlp-empty">No trades on {date}.</div>
      )}

      {date && !loading && !error && trades.length > 0 && (
        <div className="tlp-trades">
          {trades.map((trade, i) => (
            <TradeCard key={i} trade={trade} />
          ))}
        </div>
      )}
    </div>
  );
}
