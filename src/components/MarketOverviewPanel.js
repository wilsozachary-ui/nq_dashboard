import { useMemo } from 'react';
import useBotData from '../hooks/useBotData';

const fmtPrice = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '—';
};

function MarketOverviewPanel() {
  const { state: botState } = useBotData({ autoInitialize: true, autoRefresh: true, refreshIntervalMs: 5000 });

  const rows = useMemo(() => {
    const snapshot = botState?.testbotSnapshot || {};
    const market = snapshot.market || botState?.market || botState?.price || {};
    const feed = snapshot.feed || botState?.feed || botState?.feedLatency || {};
    const latency = feed.latency_ms ?? feed.wsLatency ?? feed.latency ?? botState?.feedLatency?.latency ?? botState?.feedLatency?.wsLatency;

    return [
      { label: 'Last', value: fmtPrice(market.price ?? market.lastPrice ?? market.value ?? botState?.price?.price) },
      { label: 'Bid', value: fmtPrice(market.bid ?? botState?.bidAsk?.bid ?? botState?.price?.bid) },
      { label: 'Ask', value: fmtPrice(market.ask ?? botState?.bidAsk?.ask ?? botState?.price?.ask) },
      { label: 'Feed Latency', value: Number.isFinite(Number(latency)) ? `${Number(latency).toFixed(0)}ms` : '—' },
    ];
  }, [botState]);

  return (
    <div className="card panel">
      <h2 className="panel-title">Market Overview</h2>
      {rows.map(({ label, value }) => (
        <div className="info-row" key={label}>
          <span className="info-label">{label}</span>
          <span className="info-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

export default MarketOverviewPanel;
