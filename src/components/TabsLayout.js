import { useState, createContext, useContext } from 'react';
import {
  IconTrend, IconLink, IconPulse, IconCalendar, IconInsights, IconChecklist, IconHelp,
  IconSubscription, IconSettings, IconAdmin,
} from './TabIcons';
import ThemeToggle from './ThemeToggle';
import logo from '../assets/logo.png';
import './TabsLayout.css';

// ── Tab registry ──────────────────────────────────────────────────────────────
// ORB Strategy tab intentionally not registered here -- planned for later
// development. The underlying ORBStrategyTab component, ORBEngine, and all
// backend ORB routes are untouched and still fully functional; this just
// removes it from the visible navigation. Re-add the tab entry (and the
// matching <TabPanel> in App.js) to bring it back.
export const TABS = [
  { id: 'morning',   label: 'Topstep',          icon: IconTrend,     badge: null   },
  { id: 'tradovate', label: 'Tradovate',        icon: IconLink,      badge: 'SOON' },
  { id: 'health',    label: 'System Health',     icon: IconPulse,     badge: null   },
  { id: 'recap',     label: 'Trade Recap',       icon: IconCalendar,  badge: null   },
  { id: 'insights',  label: 'AI Insights',       icon: IconInsights,  badge: null   },
  { id: 'checklist', label: 'Pre-Flight',        icon: IconChecklist, badge: null   },
  { id: 'help',      label: 'Get Started',       icon: IconHelp,      badge: null   },
];

// Account-management tabs -- call back to the SaaS control plane
// (nq-cloud.com) via the dashboard bearer token (see services/controlPlaneApi.js),
// not the local adapter API. Always visible: every customer has a
// subscription and login to manage, right from their own bot dashboard.
export const ACCOUNT_TABS = [
  { id: 'subscription', label: 'Subscription', icon: IconSubscription, badge: null },
  { id: 'settings',     label: 'Settings',      icon: IconSettings,     badge: null },
];

// Not a normal customer tab -- this container has no concept of users/roles
// at all (every customer runs the identical bundled build), so visibility is
// gated entirely by NQ_IS_ADMIN_INSTANCE, an env var only ever set on the
// owner's own container at provision time (see nq_control_plane's
// provisioning/service.py). A real in-app tab like any other (no new window,
// no external navigation) -- its content calls back to the control plane's
// /admin/metrics via the same bearer token as the other account tabs.
export const ADMIN_TAB = { id: 'admin', label: 'Admin', icon: IconAdmin, badge: null };

export const TabContext = createContext({ activeTab: 'morning', setActiveTab: () => {} });
export const useTabContext = () => useContext(TabContext);

// ── TabPanel — invisible when not active (components remain mounted) ───────────
export function TabPanel({ tabId, children, className = '' }) {
  const { activeTab } = useContext(TabContext);
  return (
    <div
      id={`tbl-panel-${tabId}`}
      role="tabpanel"
      aria-labelledby={`tbl-tab-${tabId}`}
      aria-hidden={activeTab !== tabId}
      className={`tbl-panel${activeTab === tabId ? ' tbl-panel--active' : ''}${className ? ' ' + className : ''}`}
    >
      {children}
    </div>
  );
}

// ── TabsLayout — shell with left-side vertical navigation ────────────────────
function TabButton({ t, activeTab, setActiveTab, extraClass = '' }) {
  return (
    <button
      key={t.id}
      id={`tbl-tab-${t.id}`}
      role="tab"
      aria-selected={activeTab === t.id}
      aria-controls={`tbl-panel-${t.id}`}
      className={`sidebar-tab${activeTab === t.id ? ' sidebar-tab--active' : ''}${extraClass ? ' ' + extraClass : ''}`}
      onClick={() => setActiveTab(t.id)}
    >
      <span className="sidebar-tab-icon" aria-hidden="true"><t.icon /></span>
      <span className="sidebar-tab-label">{t.label}</span>
      {t.badge && <span className="sidebar-tab-badge">{t.badge}</span>}
    </button>
  );
}

export default function TabsLayout({ children, isAdminInstance = false }) {
  const [activeTab, setActiveTab] = useState('morning');

  return (
    <TabContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="tbl-root">
        <nav className="sidebar" role="tablist" aria-label="Cockpit sections">
          <div className="sidebar-brand">
            <img src={logo} alt="" className="sidebar-brand-mark" />
            <span className="sidebar-brand-word">NQ <span className="sidebar-brand-word-accent">Cloud</span></span>
          </div>

          {TABS.map(t => (
            <TabButton key={t.id} t={t} activeTab={activeTab} setActiveTab={setActiveTab} />
          ))}

          <div className="sidebar-divider" />
          {ACCOUNT_TABS.map(t => (
            <TabButton key={t.id} t={t} activeTab={activeTab} setActiveTab={setActiveTab} />
          ))}

          <div className="sidebar-footer">
            <ThemeToggle />
          </div>

          {isAdminInstance && (
            <TabButton t={ADMIN_TAB} activeTab={activeTab} setActiveTab={setActiveTab} extraClass="sidebar-tab--admin" />
          )}
        </nav>

        <div className="main-content">
          {children}
        </div>
      </div>
    </TabContext.Provider>
  );
}
