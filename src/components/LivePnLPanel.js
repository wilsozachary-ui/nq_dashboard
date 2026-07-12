import { useEffect, useMemo, useState } from 'react';
import botApi from '../services/botApi';

function LivePnLPanel() {
  const [snapshot, setSnapshot] = useState({ realized: 0, unrealized: 0 });
  const [position, setPosition] = useState(null);
  const [lastPrice, setLastPrice] = useState(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      botApi.getOrbPnl().catch(() => ({})),
      botApi.getTestbotSnapshot().catch(() => ({})),
      botApi.getPositions().catch(() => []),
      botApi.getPrice().catch(() => ({})),
    ]).then(([orbPnl, testSnapshot, positions, priceResp]) => {
      if (!mounted) return;
      setSnapshot({
        realized: testSnapshot.realizedToday ?? testSnapshot.realized ?? orbPnl.realized ?? orbPnl.total ?? 0,
        unrealized: testSnapshot.unrealized ?? orbPnl.unrealized ?? 0,
      });
      setPosition(Array.isArray(positions) ? positions[0] : positions);
      setLastPrice(priceResp.price ?? priceResp.lastPrice ?? null);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const priceHandler = e => {
      const p = e.detail?.price ?? e.detail?.lastPrice;
      if (p != null) setLastPrice(p);
    };
    const pnlHandler = e => {
      const d = e.detail || {};
      if (d.realizedToday != null || d.realized != null || d.unrealized != null) {
        setSnapshot(prev => ({
          realized: d.realizedToday ?? d.realized ?? prev.realized,
          unrealized: d.unrealized ?? prev.unrealized,
        }));
      }
      if (d.pnl != null && (d.type === 'trade' || d.type === 'trade_closed')) {
        setSnapshot(prev => ({ ...prev, realized: prev.realized + d.pnl }));
      }
    };
    window.addEventListener('nq:integrated-price', priceHandler);
    window.addEventListener('nq:integrated-pnl', pnlHandler);
    return () => {
      window.removeEventListener('nq:integrated-price', priceHandler);
      window.removeEventListener('nq:integrated-pnl', pnlHandler);
    };
  }, []);

  const rows = useMemo(() => {
    const entry = Number(position?.entryPrice ?? position?.avgEntry ?? 0);
    const stop = Number(position?.stopLoss ?? 0);
    const target = Number(position?.takeProfit ?? 0);
    const current = Number(lastPrice ?? position?.currentPrice ?? 0);
    const slDist = entry && stop ? Math.abs(entry - stop) : 0;
    const tpDist = entry && target ? Math.abs(target - entry) : 0;
    return [
      { label: 'Unrealized P&L', value: `${snapshot.unrealized >= 0 ? '+' : '-'}$${Math.abs(snapshot.unrealized).toFixed(2)}`, positive: snapshot.unrealized >= 0 },
      { label: 'Realized P&L', value: `${snapshot.realized >= 0 ? '+' : '-'}$${Math.abs(snapshot.realized).toFixed(2)}`, positive: snapshot.realized >= 0 },
      { label: 'Entry Price', value: entry ? entry.toFixed(2) : '—' },
      { label: 'Current Price', value: current ? current.toFixed(2) : '—' },
      { label: 'SL Distance', value: `${slDist.toFixed(2)} pts` },
      { label: 'TP Distance', value: `${tpDist.toFixed(2)} pts` },
    ];
  }, [snapshot, position, lastPrice]);

  return (
    <div className="card panel">
      <h2 className="panel-title">Live P&amp;L</h2>
      {rows.map(({ label, value, positive }) => (
        <div className="info-row" key={label}>
          <span className="info-label">{label}</span>
          <span
            className={
              positive === undefined
                ? 'info-value'
                : `info-value ${positive ? 'value-positive' : 'value-negative'}`
            }
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

export default LivePnLPanel;
