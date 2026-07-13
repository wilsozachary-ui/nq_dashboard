import { useState, useEffect } from 'react';
import './App.css';
import { ToastProvider } from './hooks/useToast';
import { ToastContainer } from './components/Toast';
import { MultiStrategyProvider } from './MultiStrategyFramework';
import { getCockpitStatus, initializeCockpit } from './CockpitIntegrator';

// ── Global overlays (always rendered, above everything) ───────────────────────
import MarketOpenBanner from './components/MarketOpenBanner';
import TopstepConnectionWarning from './components/TopstepConnectionWarning';
import ErrorWarningSystem from './components/ErrorWarningSystem';
import TradeExecutionVisualizer from './components/TradeExecutionVisualizer';

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
import { getDashboardConfig } from './services/controlPlaneApi';

// Force full live mode — all WS + REST feeds are required.
window.cockpitLiveMode = true;
if (window.cockpitLiveMode) console.log('[Cockpit] Running in FULL LIVE MODE');

function App() {
  const [isLive, setIsLive] = useState(false);
  const [integration, setIntegration] = useState(() => getCockpitStatus());
  const [isAdminInstance, setIsAdminInstance] = useState(false);

  useEffect(() => {
    // One-time check, not part of the live WS/telemetry integration above --
    // this container has no user/role concept at all, so visibility of the
    // Admin tab is gated purely by whether NQ_IS_ADMIN_INSTANCE was set on
    // this specific container at provision time (see nq_control_plane).
    getDashboardConfig().then(config => setIsAdminInstance(Boolean(config.is_admin_instance)));
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

  return (
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
  );
}

export default App;
