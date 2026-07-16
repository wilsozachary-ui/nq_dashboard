import { useEffect, useState } from 'react';
import { cpGet } from '../services/controlPlaneApi';
import MorningStrategyLiveControl from './MorningStrategyLiveControl';
// MorningStrategyPracticeBotControl is intentionally hidden from the tab
// below, not removed -- the component, its CSS, and the backend's
// /testbot/practice/* routes + scheduler logic are all untouched and
// fully functional. Re-add by importing it here and rendering
// <MorningStrategyPracticeBotControl /> in column-right (previous spot:
// right above <LiveTicker />).
import TradeParameterPanel from './TradeParameterPanel';
import AiSuggestedParametersPanel from './AiSuggestedParametersPanel';
// PositionOverviewPanel is intentionally hidden, not removed -- the
// component/CSS are untouched and fully functional. Trades under this
// strategy typically open and close within seconds (see this session's
// trade timing analysis), so a live "current position" readout rarely has
// anything meaningful to show before the trade's already closed. Re-add by
// importing it here and rendering <PositionOverviewPanel /> in column-left
// (previous spot: between PracticeBotStatus and MarketContextPanel).
import MarketContextPanel from './MarketContextPanel';
import LiveTicker from './LiveTicker';
import ActivityPanel from './ActivityPanel';
import DobermanLounge from './DobermanLounge';
import MarketOverviewStrip from './MarketOverviewStrip';
import TopstepAccountSelector from './TopstepAccountSelector';
import PracticeBotStatus from './PracticeBotStatus';

export default function MorningStrategyTab() {
  const [firstName, setFirstName] = useState(null);

  useEffect(() => {
    cpGet('/me').then(me => setFirstName(me.first_name)).catch(() => {});
  }, []);

  return (
    <div className="ms-tab">

      {/* Top bar: firm title + market overview + account selector */}
      <div className="tab-topbar">
        <span className="tab-title">Morning Strategy</span>
        {firstName && <span className="tab-greeting">Hello, {firstName}</span>}
        <MarketOverviewStrip symbol="NQ" />
        <TopstepAccountSelector strategy="morning" />
      </div>

      {/* 3-column dashboard — reuses existing .dashboard / .column CSS */}
      <div className="dashboard">

        <div className="column column-left">
          <PracticeBotStatus />
          <MarketContextPanel />
        </div>

        <div className="column column-center">
          <MorningStrategyLiveControl />
          <TradeParameterPanel />
          <AiSuggestedParametersPanel />
        </div>

        <div className="column column-right">
          <LiveTicker />
          <ActivityPanel />
          <DobermanLounge />
        </div>

      </div>
    </div>
  );
}
