import { useState, useEffect } from 'react';
import './App.css';
import { ThemeProvider } from './theme/ThemeContext';
import { ToastProvider } from './hooks/useToast';
import { ToastContainer } from './components/Toast';
import { MultiStrategyProvider } from './MultiStrategyFramework';
import { getCockpitStatus, initializeCockpit } from './CockpitIntegrator';

// ── Global overlays (always rendered, above everything) ───────────────────────
import MarketOpenBanner from './components/MarketOpenBanner';
import TopstepConnectionWarning from './components/TopstepConnectionWarning';
import ErrorWarningSystem from './components/ErrorWarningSystem';
import TradeExecutionVisualizer from './components/TradeExecutionVisualizer';
import BootLoadingScreen from './components/BootLoadingScreen';

// ── Tab shell ─────────────────────────────────────────────────────────────────
import TabsLayout, { TabPanel } from './components/TabsLayout';

// ── Tab content ───────────────────────────────────────────────────────────────
import MorningStrategyTab from './components/MorningStrategyTab';
import TradovateStrategyTab from './components/TradovateStrategyTab';
import SystemHealthTab from './components/SystemHealthTab';
import TradeRecapTab from './components/TradeRecapTab';
import AiInsightsTab from './components/AiInsightsTab';
import ChecklistTab from './components/ChecklistTab';
import GetStartedTab from './components/GetStartedTab';
import SubscriptionTab from './components/SubscriptionTab';
import SettingsTab from './components/SettingsTab';
import AdminTab from './components/AdminTab';
import { getDashboardConfig, cpGet } from './services/controlPlaneApi';
import { captureSessionTokenFromUrl, getSessionToken } from './services/sessionToken';

// Force full live mode — all WS + REST feeds are required.
window.cockpitLiveMode = true;
if (window.cockpitLiveMode) console.log('[Cockpit] Running in FULL LIVE MODE');

// Runs at module load, before anything mounts or fetches -- every API call
// this app makes (bot API + control-plane calls) needs the token in place
// first. See services/sessionToken.js.
captureSessionTokenFromUrl();

// Matches CockpitIntegrator.js's own BYPASS_LIVE_VALIDATION -- the test
// environment never goes through a real nq-cloud.com login, so the auth
// gate below would otherwise block every test that renders <App />.
const BYPASS_AUTH_GATE = process.env.NODE_ENV === 'test';

// BootLoadingScreen's own staged reveal (greeting, cycling status lines,
// progress fill) is choreographed to land around 7s -- held here rather
// than in that component so the same "don't cut the moment short" gate
// also covers a from-scratch page load, not just a state transition
// inside it. If the backend answers ready sooner, the screen still holds
// until this elapses; if it's slower, this alone never forces the
// dashboard open early -- integration.ready below still gates that.
const MIN_BOOT_DISPLAY_MS = 7_000;

function App() {
  const [isLive, setIsLive] = useState(false);
  const [integration, setIntegration] = useState(() => getCockpitStatus());
  const [isAdminInstance, setIsAdminInstance] = useState(false);
  const [hasSession] = useState(() => BYPASS_AUTH_GATE || Boolean(getSessionToken()));
  // hasSession above only ever answers "was there a token at mount" --
  // dashboard_token is short-lived by design (1 day) and a tab left open
  // past that point kept polling with an expired token, every call
  // swallowed into an empty {} by its own .catch(), so the cockpit just
  // went quietly blank with no indication anything was wrong (found via a
  // "bot isn't working" report that was actually this -- 2026-07-20).
  // botApi.js's request()/rawGet() dispatch this the moment any call gets
  // a real 401, so the gate below can re-trigger mid-session too, not
  // just at mount.
  // sessionExpired isn't consumed by a render gate yet (separate
  // in-progress work, not part of this change); only silencing the lint
  // error below so this build isn't blocked by unrelated unfinished work.
  // eslint-disable-next-line no-unused-vars
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    const handler = () => setSessionExpired(true);
    window.addEventListener('nq:session-expired', handler);
    return () => window.removeEventListener('nq:session-expired', handler);
  }, []);
  // Manual override for BootLoadingScreen's "Continue to dashboard anyway"
  // escape hatch -- once set, the boot screen never comes back for this
  // session even if integration.ready flickers false again later (that
  // ongoing case is already covered by the small "Backend connecting"
  // banner below, not a reason to re-block the whole cockpit).
  const [bootDismissed, setBootDismissed] = useState(false);
  const [firstName, setFirstName] = useState(null);
  // Same BYPASS_AUTH_GATE reasoning: a real 7s wait inside every test that
  // renders <App /> (most of them, transitively) would make the suite
  // both slow and reliant on fake timers it doesn't otherwise need.
  const [minBootTimeElapsed, setMinBootTimeElapsed] = useState(BYPASS_AUTH_GATE);

  useEffect(() => {
    if (BYPASS_AUTH_GATE) return undefined;
    const timer = setTimeout(() => setMinBootTimeElapsed(true), MIN_BOOT_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // One-time check, not part of the live WS/telemetry integration above --
    // this container has no user/role concept at all, so visibility of the
    // Admin tab is gated purely by whether NQ_IS_ADMIN_INSTANCE was set on
    // this specific container at provision time (see nq_control_plane).
    getDashboardConfig().then(config => setIsAdminInstance(Boolean(config.is_admin_instance)));
  }, []);

  useEffect(() => {
    // Only for BootLoadingScreen's greeting -- best-effort, so a failed or
    // slow /me call (or an old account with no name on file, see the User
    // model's nullable first_name) just means no greeting is shown, never
    // a broken boot screen.
    cpGet('/me').then(data => setFirstName(data?.first_name || null)).catch(() => {});
  }, []);

  useEffect(() => {
    const cockpit = initializeCockpit();
    cockpit.ready.then(next => {
      window.cockpitLiveMode = next.ready;
      setIntegration(current => (
        current.ready === next.ready && JSON.stringify(current.missing) === JSON.stringify(next.missing)
          ? current
          : next
      ));
    });
    const handler = e => setIsLive(e.detail.active);
    const readinessHandler = e => setIntegration(e.detail);
    window.addEventListener('nq:market-open-mode', handler);
    window.addEventListener('cockpit:cockpit:readiness', readinessHandler);
    return () => {
      cockpit.cleanup();
      window.removeEventListener('nq:market-open-mode', handler);
      window.removeEventListener('cockpit:cockpit:readiness', readinessHandler);
    };
  }, []);

  const missing = integration.missing ?? [];

  if (!hasSession) {
    // No valid session token in localStorage -- either this dashboard was
    // opened directly (its bare *.fly.dev URL, no longer sufficient as of
    // the 2026-07-14 audit fix) or the token expired. Nothing below this
    // point can succeed against the now-gated bot API, so show a clear
    // path back instead of a half-broken cockpit full of 401s.
    return (
      <ThemeProvider>
        <div className="auth-gate">
          <div className="auth-gate-card">
            <h1>Not signed in</h1>
            <p>Open your bot dashboard from your NQ Cloud account — not this direct link.</p>
            <a className="auth-gate-link" href="https://nq-cloud.com">Go to NQ Cloud →</a>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  if ((!integration.ready || !minBootTimeElapsed) && !bootDismissed) {
    // Covers the window right after "Open my bot dashboard" in NQ Cloud --
    // the container's API and its live WS/heartbeat connection are still
    // catching up. initializeCockpit()'s readiness promise (driving
    // integration.ready) already retries this with backoff; this just
    // makes the wait a real screen instead of a sliver of banner text
    // above an otherwise-empty cockpit. Never a permanent trap -- the
    // screen's own escape hatch lets the user past it after a while.
    return (
      <ThemeProvider>
        <BootLoadingScreen missing={missing} onContinueAnyway={() => setBootDismissed(true)} name={firstName} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
    <ToastProvider>
      <MultiStrategyProvider>

        {/* Non-blocking backend warning — shown until all services connect */}
        {!integration.ready && missing.length > 0 && (
          <div className="cockpit-readiness-warning" role="alert">
            Backend connecting — waiting for: {missing.join(', ')}
          </div>
        )}

        {/* Cockpit always renders — WS connections retry automatically */}
        <div className={`App${isLive ? ' mkt-open-active' : ''}`}>

          {/* Global overlays — render on top of all content */}
          <MarketOpenBanner />
          <TopstepConnectionWarning />
          <ErrorWarningSystem />
          <TradeExecutionVisualizer />

          {/* Tab-based cockpit — CSS show/hide keeps WS connections alive on all tabs */}
          <TabsLayout isAdminInstance={isAdminInstance}>
            <TabPanel tabId="morning"><MorningStrategyTab /></TabPanel>
            <TabPanel tabId="tradovate"><TradovateStrategyTab /></TabPanel>
            <TabPanel tabId="health"><SystemHealthTab /></TabPanel>
            <TabPanel tabId="recap"><TradeRecapTab /></TabPanel>
            <TabPanel tabId="insights"><AiInsightsTab /></TabPanel>
            <TabPanel tabId="checklist"><ChecklistTab /></TabPanel>
            <TabPanel tabId="help"><GetStartedTab /></TabPanel>
            <TabPanel tabId="subscription"><SubscriptionTab /></TabPanel>
            <TabPanel tabId="settings"><SettingsTab /></TabPanel>
            {isAdminInstance && <TabPanel tabId="admin"><AdminTab /></TabPanel>}
          </TabsLayout>

        </div>

        <ToastContainer />
      </MultiStrategyProvider>
    </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
