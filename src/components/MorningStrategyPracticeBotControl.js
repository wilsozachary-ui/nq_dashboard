import { useState, useRef } from 'react';
import botApi from '../services/botApi';
import {
  StatusPill, PowerToggle, Spinner, fmtPrice, fmtPnl,
  useTestBotSnapshot, useMorningStrategyParams, useSelectedAccounts, resolveSinglePracticeAccount,
} from './morningStrategyShared';
import './MorningStrategyLiveControl.css';

export default function MorningStrategyPracticeBotControl() {
  const [actionBusy, setActionBusy] = useState(null); // null | 'firing' | 'stopping'
  const [message, setMessage] = useState(null); // { text, kind: 'success'|'error'|'info' }

  const snapshot = useTestBotSnapshot('practice');
  const paramsRef = useMorningStrategyParams();
  const { accounts: selectedAccounts } = useSelectedAccounts();
  const practiceSelection = resolveSinglePracticeAccount(selectedAccounts);
  const accountId = practiceSelection.account
    ? practiceSelection.account.account_id ?? practiceSelection.account.id
    : null;
  const isPractice = accountId != null;
  const firingRef = useRef(false);

  // Same reasoning as MorningStrategyLiveControl: don't render a confident
  // OFF/inactive state before the first real fetch has actually landed.
  if (!snapshot._snapshotMeta?.loaded) {
    return (
      <div className="card mstb-panel mstb-panel--practice">
        <div className="mstb-header">
          <h3 className="panel-title">Morning Strategy — Practice</h3>
        </div>
        <div className="mstb-loading">
          <Spinner /> Checking bot status…
        </div>
      </div>
    );
  }

  const status = snapshot.status || 'OFF';
  const position = snapshot.position || null;
  const pending = snapshot.pending_entries || {};
  const hasPendingStops = pending.long_stop_price != null || pending.short_stop_price != null;
  const busy = actionBusy !== null;
  const on = status === 'ARMED' || status === 'ACTIVE';

  const fire = async () => {
    if (firingRef.current) return;
    firingRef.current = true;
    setActionBusy('firing');
    try {
      const p = paramsRef.current || {};
      const result = await botApi.startPracticeBot({
        account_id: accountId,
        contract_size: p.contractSize,
        spread_points: p.spreadPoints,
        tp_dollars: p.takeProfit,
        sl_dollars: p.stopLoss,
        trailing_points: p.trailingDistance,
        trailing_enabled: !!p.trailingStop,
        breakeven_dollars: p.trailingStop && p.breakevenTrigger > 0 ? p.breakevenTrigger : null,
        profit_lock_dollars: p.trailingStop && p.profitLockTrigger > 0 ? p.profitLockTrigger : null,
        profit_lock_retain_pct: p.trailingStop ? p.profitLockRetainPct : null,
      });
      setMessage(result.ok
        ? { text: `Fired at ${new Date().toLocaleTimeString()}`, kind: 'success' }
        : { text: result.error?.message || 'Failed to start', kind: 'error' });
    } catch (err) {
      setMessage({ text: err.message || 'Failed to start', kind: 'error' });
    } finally {
      setActionBusy(null);
      firingRef.current = false;
    }
  };

  // Off cancels all orders + flattens, mirroring TestBotEngine.stop().
  const off = async () => {
    setActionBusy('stopping');
    try {
      const r = await botApi.stopPracticeBot();
      setMessage(r.ok
        ? { text: 'Stopped — orders canceled, position flattened', kind: 'success' }
        : { text: r.error?.message || 'Stop failed', kind: 'error' });
    } catch (err) {
      setMessage({ text: err.message || 'Stop failed', kind: 'error' });
    } finally {
      setActionBusy(null);
    }
  };

  const handleToggle = () => {
    if (on) { off(); return; }
    if (!isPractice) {
      setMessage({
        text: practiceSelection.count > 1
          ? 'Select exactly one practice account to fire'
          : 'Select a practice account to fire',
        kind: 'error',
      });
      return;
    }
    fire();
  };

  const subLabel = (() => {
    if (status === 'ACTIVE') return 'Active — position open';
    if (status === 'ARMED') return 'Armed — waiting for fill';
    if (status === 'CLOSED_TP') return 'Closed — take profit hit';
    if (status === 'CLOSED_SL') return 'Closed — stop loss hit';
    if (practiceSelection.count > 1) return 'Select exactly one practice account';
    return isPractice ? 'Fires immediately · Practice Only' : 'Select a practice account to fire';
  })();

  const toggleDisabled = busy || (!on && !isPractice);

  return (
    <div className="card mstb-panel mstb-panel--practice">
      <div className="mstb-header">
        <h3 className="panel-title">Morning Strategy — Practice</h3>
        <StatusPill status={status} />
      </div>

      <PowerToggle
        on={on}
        busy={busy}
        busyLabel={actionBusy === 'firing' ? 'Firing…' : 'Stopping…'}
        subLabel={subLabel}
        onClick={handleToggle}
        disabled={toggleDisabled}
      />

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
