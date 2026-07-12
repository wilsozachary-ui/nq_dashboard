import { useEffect, useMemo, useState } from 'react';
import useBotData from '../hooks/useBotData';
import botApi from '../services/botApi';

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Sits under Position Overview -- live price + VIX + overnight range/spread
// at a glance, without needing to look at the ticker panel on the right.
function MarketContextPanel() {
  const { state: botState } = useBotData({ autoInitialize: true, autoRefresh: true, refreshIntervalMs: 5000 });

  // VIX + overnight range -- real values from signals_snapshot (backed by
  // ExternalSignalsEngine). GET /signals bootstraps and covers gaps; the
  // 'strategy' WS stream (carries signals_snapshot) updates live without
  // waiting for the next 5s poll.
  const [signals, setSignals] = useState({ vix: null, overnightHigh: null, overnightLow: null });
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      botApi.getSignals()
        .then(s => {
          if (cancelled) return;
          setSignals({
            vix: numOrNull(s?.vix),
            overnightHigh: numOrNull(s?.overnight_high),
            overnightLow: numOrNull(s?.overnight_low),
          });
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const price = useMemo(() => {
    const snapshot = botState?.testbotSnapshot || {};
    const restMarket = snapshot.market || {};
    const parsed = Number(botState?.price?.price ?? restMarket.price ?? restMarket.lastPrice ?? restMarket.value);
    return Number.isFinite(parsed) ? parsed : null;
  }, [botState]);

  const onHigh = signals.overnightHigh;
  const onLow = signals.overnightLow;
  const onSpread = (onHigh != null && onLow != null) ? onHigh - onLow : null;
  const vixWarn = signals.vix != null && signals.vix > 25;

  const rows = [
    {
      label: 'Live NQ Price',
      value: price != null ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—',
    },
    {
      label: 'VIX',
      value: signals.vix != null ? signals.vix.toFixed(2) : '—',
      warn: vixWarn,
    },
    {
      label: 'Overnight Range',
      value: (onLow != null && onHigh != null) ? `${onLow.toLocaleString()} – ${onHigh.toLocaleString()}` : '—',
    },
    {
      label: 'O/N Spread',
      value: onSpread != null ? `${onSpread.toFixed(2)} pts` : '—',
    },
  ];

  return (
    <div className="card panel">
      <h2 className="panel-title">Market Context</h2>
      {rows.map(({ label, value, warn }) => (
        <div className="info-row" key={label}>
          <span className="info-label">{label}</span>
          <span className={`info-value${warn ? ' value-negative' : ''}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

export default MarketContextPanel;
