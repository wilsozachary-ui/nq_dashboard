import './MarketOverviewStrip.css';

// Live NQ price, O/N Range, and VIX moved into LiveTicker.js / MarketContextPanel.js;
// Bid/Ask/Spread and Tick removed entirely -- this strip is now just a
// compact symbol tag, kept because MarketOverviewStrip is reused with
// symbol="MNQ" on the ORB tab and Bid/Ask were the last symbol-specific
// data living here.
export default function MarketOverviewStrip({ symbol = 'NQ' }) {
  return (
    <div className="mos-strip">
      <div className="mos-hero">
        <span className="mos-sym">{symbol}</span>
      </div>
    </div>
  );
}
