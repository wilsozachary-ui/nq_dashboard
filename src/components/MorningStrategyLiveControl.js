import { useState, useEffect } from 'react';
import botApi from '../services/botApi';
import {
  StatusPill, PowerToggle, fmtPrice, fmtPnl,
  useTestBotSnapshot, useMorningStrategyParams, useSelectedAccount,
} from './morningStrategyShared';
import './MorningStrategyLiveControl.css';

function fmtCountdown(ms) {
  if (ms == null || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function MorningStrategyLiveControl() {
  const [now, setNow] = useState(Date.now());
  const [actionBusy, setActionBusy] = useState(null); // null | 'arming' | 'stopping' | 'flattening'
  const [message, setMessage] = useState(null); // { text, kind: 'success'|'error'|'info' }

  const snapshot = useTestBotSnapshot('live');
  const paramsRef = useMorningStrategyParams();
  const { accountId } = useSelectedAccount();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const status = snapshot.status || 'OFF';
  const armed = !!snapshot.armed;
  // Server truth (set by whichever device actually armed it -- see
  // MorningStrategyScheduler.params on the backend), not this device's own
  // local panel state -- so arming from your PC and then checking from
  // your phone (or nq-cloud.com) shows the same real parameters instead of
  // whatever that other device's panel happens to have showing.
  const armedParams = snapshot.armed_params || null;
  const position = snapshot.position || null;
  const pending = snapshot.pending_entries || {};
  const hasPendingStops = pending.long_stop_price != null || pending.short_stop_price != null;
  const nextFireAtMs = snapshot.next_fire_at ? new Date(snapshot.next_fire_at).getTime() : null;
  const countdownMs = nextFireAtMs != null ? nextFireAtMs - now : null;

  // ON covers the whole standing instruction: waiting to fire, orders
  // placed and waiting for a fill, or an active position -- all one
  // continuous "on" state from the user's point of view. Backend owns all
  // of it (see MorningStrategyScheduler), so there's no local state here
  // to reconcile -- this component only reflects what the backend reports.
  const on = armed || status === 'ARMED' || status === 'ACTIVE';
  const busy = actionBusy !== null;

  const handleToggle = async () => {
    if (on) {
      setActionBusy('stopping');
      try {
        const r = await botApi.offLiveBot({ expected_arm_revision: snapshot.arm_revision ?? 0 });
        setMessage(r.ok ? { text: 'Turned off', kind: 'success' } : { text: r.error?.message || 'Failed to turn off', kind: 'error' });
      } catch (err) {
        setMessage({ text: err.message || 'Failed to turn off', kind: 'error' });
      } finally {
        setActionBusy(null);
      }
      return;
    }

    if (!accountId) { setMessage({ text: 'Select an account first', kind: 'error' }); return; }

    setActionBusy('arming');
    try {
      const p = paramsRef.current || {};
      const r = await botApi.armLiveBot({
        expected_arm_revision: snapshot.arm_revision ?? 0,
        account_id: accountId,
        contract_size: p.contractSize,
        spread_points: p.spreadPoints,
        tp_dollars: p.takeProfit,
        sl_dollars: p.stopLoss,
        trailing_points: p.trailingDistance,
        trailing_enabled: !!p.trailingStop,
        breakeven_dollars: p.trailingStop && p.breakevenTrigger > 0 ? p.breakevenTrigger : null,
        profit_lock_dollars: p.trailingStop && p.profitLockTrigger > 0 ? p.profitLockTrigger : null,
        // Gated on trailingStop only, not also > 0 -- a deliberate 0%
        // retain setting (pure breakeven-style tier 2) is legitimate,
        // unlike the trigger fields where 0/off is the natural default.
        profit_lock_retain_pct: p.trailingStop ? p.profitLockRetainPct : null,
      });
      setMessage(r.ok ? { text: 'Armed', kind: 'success' } : { text: r.error?.message || 'Failed to arm', kind: 'error' });
    } catch (err) {
      setMessage({ text: err.message || 'Failed to arm', kind: 'error' });
    } finally {
      setActionBusy(null);
    }
  };

  const flatten = async () => {
    setActionBusy('flattening');
    try {
      const r = await botApi.flattenLiveBot();
      setMessage(r.ok ? { text: 'Flattened', kind: 'success' } : { text: r.error?.message || 'Flatten failed', kind: 'error' });
    } catch (err) {
      setMessage({ text: err.message || 'Flatten failed', kind: 'error' });
    } finally {
      setActionBusy(null);
    }
  };

  // Engine activity takes priority in the caption; "armed" (the standing
  // daily instruction) is folded in alongside a close reason so "waits
  // until tomorrow regardless of outcome" is visible without a separate
  // control.
  const subLabel = (() => {
    if (status === 'ACTIVE') return 'Active — position open';
    if (status === 'ARMED') return 'Armed — waiting for fill';
    if (status === 'CLOSED_TP') return armed ? 'Closed — take profit hit · armed for tomorrow' : 'Closed — take profit hit';
    if (status === 'CLOSED_SL') return armed ? 'Closed — stop loss hit · armed for tomorrow' : 'Closed — stop loss hit';
    if (armed) return `Armed — firing in ${fmtCountdown(countdownMs)}`;
    return accountId ? 'Arms at 08:29:59 CST' : 'Select an account to arm';
  })();

  const toggleDisabled = busy;

  return (
    <div className={`card mstb-panel mstb-panel--live${armed && status === 'OFF' ? ' mstb-panel--armed' : ''}${status === 'ACTIVE' ? ' mstb-panel--active' : ''}`}>
      <div className="mstb-header">
        <h3 className="panel-title">Morning Strategy — Live</h3>
        <StatusPill status={status} />
      </div>

      <PowerToggle
        on={on}
        busy={busy}
        busyLabel={actionBusy === 'arming' ? 'Arming…' : 'Turning off…'}
        subLabel={subLabel}
        onClick={handleToggle}
        disabled={toggleDisabled}
      />

      {status === 'ACTIVE' && (
        <button className="mstb-flatten-link" onClick={flatten} disabled={busy}>
          {actionBusy === 'flattening' ? 'Flattening…' : 'Flatten position only'}
        </button>
      )}

      {armed && armedParams && (
        <div className="mstb-section">
          <span className="mstb-section-label">Armed With</span>
          <div className="mstb-prices">
            <div className="mstb-price-row">
              <span className="mstb-price-lbl">Take Profit</span>
              <span className="mstb-price-val mstb-price-val--up">{fmtPrice(armedParams.tp_dollars)}</span>
            </div>
            <div className="mstb-price-row">
              <span className="mstb-price-lbl">Stop Loss</span>
              <span className="mstb-price-val mstb-price-val--down">{fmtPrice(armedParams.sl_dollars)}</span>
            </div>
            <div className="mstb-price-row">
              <span className="mstb-price-lbl">Trailing</span>
              <span className="mstb-price-val">
                {armedParams.trailing_enabled ? `${armedParams.trailing_points ?? '—'} pts` : 'Off'}
              </span>
            </div>
            <div className="mstb-price-row">
              <span className="mstb-price-lbl">Contract Size</span>
              <span className="mstb-price-val">{armedParams.contract_size ?? '—'}</span>
            </div>
          </div>
        </div>
      )}

      <div className="mstb-section">
        <span className="mstb-section-label">Position</span>
        <div className="mstb-prices">
          <div className="mstb-price-row">
            <span className="mstb-price-lbl">Entry</span>
            <span className="mstb-price-val">{fmtPrice(position?.entry_price)}</span>
          </div>
          <div className="mstb-price-row">
            <span className="mstb-price-lbl">Take Profit</span>
            <span className="mstb-price-val mstb-price-val--up">{fmtPrice(position?.tp_price)}</span>
          </div>
          <div className="mstb-price-row">
            <span className="mstb-price-lbl">Stop Loss</span>
            <span className="mstb-price-val mstb-price-val--down">{fmtPrice(position?.sl_price)}</span>
          </div>
          <div className="mstb-price-row">
            <span className="mstb-price-lbl">Trailing SL</span>
            <span className="mstb-price-val">{fmtPrice(position?.trailing_stop)}</span>
          </div>
          {!position && hasPendingStops && (
            <div className="mstb-price-row">
              <span className="mstb-price-lbl">Pending Stops</span>
              <span className="mstb-price-val">{fmtPrice(pending.long_stop_price)} / {fmtPrice(pending.short_stop_price)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mstb-pnl-row">
        <div className="mstb-pnl-item">
          <span className="mstb-pnl-lbl">UPL</span>
          <span className={`mstb-pnl-val${Number(position?.upl) > 0 ? ' mstb-pnl-val--up' : Number(position?.upl) < 0 ? ' mstb-pnl-val--down' : ''}`}>
            {fmtPnl(position?.upl)}
          </span>
        </div>
        <div className="mstb-pnl-item">
          <span className="mstb-pnl-lbl">RPL</span>
          <span className={`mstb-pnl-val${Number(position?.rpl) > 0 ? ' mstb-pnl-val--up' : Number(position?.rpl) < 0 ? ' mstb-pnl-val--down' : ''}`}>
            {fmtPnl(position?.rpl)}
          </span>
        </div>
      </div>

      {message && <div className={`mstb-message mstb-message--${message.kind}`}>{message.text}</div>}
    </div>
  );
}
