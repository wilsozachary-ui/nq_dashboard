import { useMemo } from 'react';
import useBotData from '../hooks/useBotData';
import './PositionOverviewPanel.css';

function PositionOverviewPanel() {
  const { state: botState } = useBotData({ autoInitialize: true, autoRefresh: true, refreshIntervalMs: 5000 });

  const activeTrade = useMemo(() => {
    const snapshot = botState?.testbotSnapshot || {};
    const normalized = snapshot.active_trade || botState?.active_trade;
    if (normalized && typeof normalized === 'object') return normalized;

    const position = Array.isArray(botState?.positions) ? botState.positions[0] : botState?.positions;
    const trailing = botState?.trailingStop || {};

    return {
      direction: position?.direction ?? position?.side ?? 'flat',
      entry_price: position?.entryPrice ?? position?.avgEntry,
      stop_loss: position?.stopLoss ?? trailing?.stopLoss,
      take_profit: position?.takeProfit ?? trailing?.takeProfit,
      qty: position?.qty ?? position?.size ?? position?.positionSize,
      unrealized_pnl: position?.unrealizedPnl ?? position?.pnl,
      status: position ? 'open' : 'flat',
    };
  }, [botState]);

  const rows = useMemo(() => {
    const directionRaw = activeTrade?.direction ?? activeTrade?.side ?? 'FLAT';
    const direction = String(directionRaw).toUpperCase();
    const entry = Number(activeTrade?.entry_price ?? activeTrade?.entryPrice ?? activeTrade?.avgEntry ?? 0);
    const stop = Number(activeTrade?.stop_loss ?? activeTrade?.stopLoss ?? 0);
    const tp = Number(activeTrade?.take_profit ?? activeTrade?.takeProfit ?? 0);
    const qty = Number(activeTrade?.qty ?? activeTrade?.quantity ?? activeTrade?.contracts ?? 0);
    const upnl = Number(activeTrade?.unrealized_pnl ?? activeTrade?.unrealizedPnl ?? activeTrade?.pnl ?? 0);
    const status = String(activeTrade?.status ?? (qty > 0 ? 'open' : 'flat'));
    const upnlClass = Number.isFinite(upnl) && upnl !== 0 ? (upnl > 0 ? 'value-positive' : 'value-negative') : '';
    return [
      { label: 'Direction', value: direction },
      { label: 'Entry', value: entry ? entry.toFixed(2) : '—' },
      { label: 'Stop Loss', value: stop ? stop.toFixed(2) : '—' },
      { label: 'Take Profit', value: tp ? tp.toFixed(2) : '—' },
      { label: 'Quantity', value: qty ? qty.toString() : '—' },
      { label: 'Unrealized P&L', value: Number.isFinite(upnl) ? `$${upnl.toFixed(2)}` : '—', valueClass: upnlClass },
      { label: 'Status', value: status.toUpperCase() },
    ];
  }, [activeTrade]);

  // Drives the panel-level emphasis below -- a genuinely open position is
  // the single most important thing on this tab, so it gets a visual
  // presence the same way an "armed" strategy panel already does, rather
  // than looking identical to the idle/flat state. Reuses the same
  // direction value already computed into rows[0], not recomputed.
  const direction = rows[0]?.value;
  const emphasisClass =
    direction === 'LONG' ? ' pop-panel--long' :
    direction === 'SHORT' ? ' pop-panel--short' : '';

  const bracket = useMemo(() => {
    const entry = Number(activeTrade?.entry_price ?? activeTrade?.entryPrice ?? activeTrade?.avgEntry ?? 0);
    const stop = Number(activeTrade?.stop_loss ?? activeTrade?.stopLoss ?? 0);
    const tp = Number(activeTrade?.take_profit ?? activeTrade?.takeProfit ?? 0);
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(tp - entry);
    const total = risk + reward;
    const riskPct = total > 0 ? (risk / total) * 100 : 33;
    const rewardPct = total > 0 ? (reward / total) * 100 : 67;
    return { riskPct, rewardPct };
  }, [activeTrade]);

  return (
    <div className={`card panel${emphasisClass}`}>
      <h2 className="panel-title">Position Overview</h2>
      {rows.map(({ label, value, valueClass }) => (
        <div className="info-row" key={label}>
          <span className="info-label">{label}</span>
          <span className={`info-value${valueClass ? ' ' + valueClass : ''}`}>{value}</span>
        </div>
      ))}

      <div className="bracket">
        <div className="bracket-track">
          <div className="bracket-segment bracket-risk" style={{ width: `${bracket.riskPct}%` }} />
          <div className="bracket-segment bracket-reward" style={{ width: `${bracket.rewardPct}%` }} />
          <div className="bracket-marker" style={{ left: `${bracket.riskPct}%` }} />
        </div>
        <div className="bracket-labels">
          <span className="bracket-label bracket-label-sl">SL</span>
          <span className="bracket-label bracket-label-entry">Entry</span>
          <span className="bracket-label bracket-label-tp">TP</span>
        </div>
      </div>
    </div>
  );
}

export default PositionOverviewPanel;
