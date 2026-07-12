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

function fmtPoints(v) {
  return v != null ? `${Number(v).toFixed(0)} pts` : '—';
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

function confidenceLabel(c) {
  if (c >= 0.7) return { label: 'High', cls: 'aic-confidence--high' };
  if (c >= 0.4) return { label: 'Medium', cls: 'aic-confidence--medium' };
  return { label: 'Low', cls: 'aic-confidence--low' };
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

      <div className="aic-grid">
        <div className="aic-stat"><span className="aic-stat-label">Spread</span><span className="aic-stat-value">{fmtPoints(card.recommended_spread_points)}</span></div>
        <div className="aic-stat"><span className="aic-stat-label">Take Profit</span><span className="aic-stat-value">{fmtDollars(card.recommended_tp_dollars)}</span></div>
        <div className="aic-stat"><span className="aic-stat-label">Stop Loss</span><span className="aic-stat-value">{fmtDollars(card.recommended_sl_dollars)}</span></div>
        <div className="aic-stat"><span className="aic-stat-label">Trailing</span><span className="aic-stat-value">{fmtPoints(card.recommended_trailing_points)}</span></div>
        <div className="aic-stat"><span className="aic-stat-label">Contract Size</span><span className="aic-stat-value">{card.recommended_contract_size ?? '—'}</span></div>
        <div className="aic-stat"><span className="aic-stat-label">Win Rate</span><span className="aic-stat-value">{fmtPct(card.win_rate)}</span></div>
        <div className="aic-stat"><span className="aic-stat-label">Avg VIX</span><span className="aic-stat-value">{fmtVix(card.avg_vix)}</span></div>
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

  return (
    <div className="ai-insights-tab">
      <div className="tab-topbar">
        <span className="tab-title">AI Insights</span>
        <TopstepAccountSelector strategy="insights" />
      </div>

      <div className="aic-intro">
        Read-only analysis of how each weekday's opening NQ candle has actually behaved, and what that implies for
        Morning Strategy parameters — now also tracking VIX at the moment each trade fired, split by win/loss, to
        help surface whether volatility regime actually correlates with outcome. Candle data reflects the whole
        market; win rate and VIX reflect{' '}
        {accountId ? 'the single selected account' : 'all selected accounts combined'} — narrow the account selector
        above to one account to scope it further. Nothing here is applied automatically — review and adjust Trade
        Parameters by hand.
      </div>

      {status === 'loading' && !cards && (
        <div className="aic-empty">Analyzing historical candles…</div>
      )}
      {status === 'error' && !cards && (
        <div className="aic-empty aic-empty--error">AI Insights unavailable right now.</div>
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
