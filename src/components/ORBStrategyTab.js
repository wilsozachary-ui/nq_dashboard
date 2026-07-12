import { useMemo } from 'react';
import LiveTicker from './LiveTicker';
import ActivityPanel from './ActivityPanel';
import OrbControls from './OrbControls';
import MarketOverviewStrip from './MarketOverviewStrip';
import TopstepAccountSelector from './TopstepAccountSelector';
import RiskPanel from './RiskPanel';
import PracticeBotStatus from './PracticeBotStatus';
import useBotData from '../hooks/useBotData';
import './ORBStrategyTab.css';

function ORBRangeCard() {
  const { state: botState } = useBotData({ autoInitialize: true, autoRefresh: false });
  const orb = useMemo(() => {
    const snapshot = botState?.testbotSnapshot || {};
    return snapshot.orb_snapshot || botState?.orb_snapshot || botState?.orbRange || botState?.orbState || {};
  }, [botState]);

  const high = Number(orb.high ?? orb.rangeHigh);
  const low = Number(orb.low ?? orb.rangeLow);
  const hasHigh = Number.isFinite(high);
  const hasLow = Number.isFinite(low);
  const status = String(orb.status ?? orb.state ?? 'Waiting for range');
  const size = hasHigh && hasLow ? (high - low).toFixed(2) : '0.00';

  return (
    <div className="card orb-range-card">
      <span className="panel-title">Open Range · MNQ (9:30–9:45 ET)</span>
      <div className="orb-range-body">
        <div className="orb-range-row">
          <span className="orb-range-lbl">Range High</span>
          <span className="orb-range-val orb-val--up">{hasHigh ? high.toFixed(2) : '—'}</span>
        </div>
        <div className="orb-range-row">
          <span className="orb-range-lbl">Range Low</span>
          <span className="orb-range-val orb-val--down">{hasLow ? low.toFixed(2) : '—'}</span>
        </div>
        <div className="orb-range-row">
          <span className="orb-range-lbl">Range Size</span>
          <span className="orb-range-val">{size} pts</span>
        </div>
        <div className="orb-range-row">
          <span className="orb-range-lbl">Status</span>
          <span className="orb-range-val orb-range-status">{status}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ORBStrategyTab() {
  return (
    <div className="orb-tab">

      {/* Top bar: MNQ market overview + account selector */}
      <div className="tab-topbar">
        <MarketOverviewStrip symbol="MNQ" />
        <TopstepAccountSelector strategy="orb" />
      </div>

      {/* ORB strategy note */}
      <div className="orb-strategy-banner">
        <span className="orb-banner-icon" aria-hidden="true">◈</span>
        <span className="orb-banner-text">
          ORB Strategy — Open Range Breakout on MNQ · separate from Morning Strategy risk limits
        </span>
      </div>

      {/* 3-column dashboard */}
      <div className="dashboard">

        <div className="column column-left">
          <RiskPanel apiPrefix="/orb" />
          <PracticeBotStatus apiPrefix="/orb" />
        </div>

        <div className="column column-center">
          <ORBRangeCard />
          <OrbControls />
        </div>

        <div className="column column-right">
          <LiveTicker />
          <ActivityPanel />
        </div>

      </div>
    </div>
  );
}
