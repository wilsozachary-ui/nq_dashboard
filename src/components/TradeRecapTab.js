import { useState } from 'react';
import MonthlyPnLPanel from './MonthlyPnLPanel';
import TradeLifecyclePanel from './TradeLifecyclePanel';
import CandleMetricsPanel from './CandleMetricsPanel';
import TopstepAccountSelector from './TopstepAccountSelector';
import { useSelectedAccount } from './morningStrategyShared';
import './TradeRecapTab.css';

// Values match /pnl/monthly's real `strategy` query param (see
// app/adapter_api/main.py's pnl_monthly route) -- 'orb' is deliberate,
// not 'orb_strategy', to match what the backend actually accepts.
const STRATEGY_FILTERS = [
  { key: 'overall',          label: 'All Strategies' },
  { key: 'morning_strategy', label: 'Morning Strategy' },
  { key: 'orb',              label: 'ORB Strategy' },
];

export default function TradeRecapTab() {
  const [strategy, setStrategy] = useState('overall');
  const [selectedDate, setSelectedDate] = useState(null);
  const { accountId } = useSelectedAccount();
  const activeLabel = STRATEGY_FILTERS.find(f => f.key === strategy)?.label ?? 'All Strategies';

  return (
    <div className="trt-tab">

      {/* Top bar: account selector, same as Morning Strategy / ORB tabs */}
      <div className="tab-topbar">
        <TopstepAccountSelector strategy="recap" />
      </div>

      {/* Filter bar -- the single strategy filter driving every money panel
          below (Monthly P&L). */}
      <div className="trt-filter-bar">
        <span className="trt-filter-label">Strategy</span>
        <div className="trt-filter-pills">
          {STRATEGY_FILTERS.map(f => (
            <button
              key={f.key}
              className={`trt-pill${strategy === f.key ? ' trt-pill--active' : ''}`}
              onClick={() => setStrategy(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="trt-filter-note">
          Showing data for: <strong>{activeLabel}</strong>
        </span>
      </div>

      <div className="tab-single-col">
        <MonthlyPnLPanel
          strategy={strategy}
          accountId={accountId}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
        <TradeLifecyclePanel date={selectedDate} strategy={strategy} accountId={accountId} />
        <CandleMetricsPanel date={selectedDate} />
      </div>
    </div>
  );
}
