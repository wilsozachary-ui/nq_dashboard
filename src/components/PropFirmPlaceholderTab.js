import './PropFirmPlaceholderTab.css';

// Foundation-only placeholder for a prop firm/platform whose integration
// hasn't been built yet (currently: Tradovate, which will surface Apex,
// Lucid, UProfit, Leeloo, Bulenox, and personal accounts once real OAuth
// wiring exists -- see the tradovate-integration-plan memory). Deliberately
// makes zero network calls and imports nothing from services/botApi --
// this must not be able to read from or act on the real Topstep-connected
// backend under any circumstance. Mirrors MorningStrategyTab's panel
// layout/titles so the real integration can slot in later without a
// layout redesign.
export default function PropFirmPlaceholderTab({ firmName }) {
  return (
    <div className="ms-tab">

      <div className="tab-topbar">
        <span className="tab-title">{firmName} Morning Strategy</span>
        <span className="pfp-status-badge">Not Yet Connected</span>
        {/* Static placeholder for the eventual multi-account selector (pick
            which of the firm's accounts to arm) -- disabled, no dropdown,
            no data source. Visually reserves the spot the real
            TopstepAccountSelector occupies on the Topstep tab. */}
        <button className="pfp-accounts-pill" disabled>
          <span aria-hidden="true">⊟</span>
          <span>{firmName} Accounts</span>
          <span className="pfp-accounts-count">—/—</span>
        </button>
      </div>

      <div className="dashboard">

        <div className="column column-left">
          <div className="card pfp-card">
            <div className="pfp-card-header">
              <span className="panel-title">Bot Health</span>
              <span className="pfp-pill">PENDING</span>
            </div>
            <div className="pfp-stat-row">
              <div className="pfp-stat"><span className="pfp-stat-label">API</span><span className="pfp-stat-value">—</span></div>
              <div className="pfp-stat"><span className="pfp-stat-label">♥</span><span className="pfp-stat-value">—</span></div>
              <div className="pfp-stat"><span className="pfp-stat-label">↻</span><span className="pfp-stat-value">—</span></div>
            </div>
            <div className="pfp-dot-row">
              <span className="pfp-dot-item"><span className="pfp-dot" />Strategy</span>
              <span className="pfp-dot-item"><span className="pfp-dot" />Risk</span>
              <span className="pfp-dot-item"><span className="pfp-dot" />Exec</span>
              <span className="pfp-dot-item"><span className="pfp-dot" />Pos. Mgr</span>
            </div>
          </div>

          <div className="card pfp-card">
            <div className="panel-title">Position Overview</div>
            <div className="pfp-row"><span>Direction</span><span>—</span></div>
            <div className="pfp-row"><span>Entry</span><span>—</span></div>
            <div className="pfp-row"><span>Stop Loss</span><span>—</span></div>
            <div className="pfp-row"><span>Take Profit</span><span>—</span></div>
            <div className="pfp-row"><span>Quantity</span><span>—</span></div>
            <div className="pfp-row"><span>Unrealized P&amp;L</span><span>—</span></div>
            <div className="pfp-row"><span>Status</span><span>—</span></div>
          </div>

          <div className="card pfp-card">
            <div className="panel-title">Market Context</div>
            <div className="pfp-row"><span>Live NQ Price</span><span>—</span></div>
            <div className="pfp-row"><span>VIX</span><span>—</span></div>
            <div className="pfp-row"><span>Overnight Range</span><span>—</span></div>
          </div>
        </div>

        <div className="column column-center">
          <div className="card pfp-card">
            <div className="pfp-card-header">
              <span className="panel-title">{firmName} — Morning Strategy</span>
              <button className="pfp-off-btn" disabled>OFF</button>
            </div>
            <div className="pfp-empty-state">
              <p>{firmName} integration is planned but not yet connected.</p>
              <p className="pfp-empty-sub">
                This tab reserves the layout for the {firmName} adapter — there is no live
                connection, no account access, and nothing here can place or affect any trade.
              </p>
            </div>
          </div>

          <div className="card pfp-card">
            <div className="panel-title">Trade Parameters</div>
            <div className="pfp-empty-state pfp-empty-state--small">
              <p>Parameters will appear here once {firmName} is connected.</p>
            </div>
          </div>
        </div>

        <div className="column column-right">
          <div className="card pfp-card">
            <div className="panel-title">NQ Live Ticker</div>
            <div className="pfp-row"><span>Price</span><span>—</span></div>
          </div>

          <div className="card pfp-card">
            <div className="panel-title">Activity</div>
            <div className="pfp-empty-state pfp-empty-state--small">
              <p>Awaiting {firmName} connection...</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
