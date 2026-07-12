import { useState, createContext, useContext } from 'react';
import { IconTrend, IconLink, IconPulse, IconCalendar, IconInsights, IconChecklist, IconHelp } from './TabIcons';
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
export default function TabsLayout({ children }) {
  const [activeTab, setActiveTab] = useState('morning');

  return (
    <TabContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="tbl-root">
        <nav className="sidebar" role="tablist" aria-label="Cockpit sections">
          {TABS.map(t => (
            <button
              key={t.id}
              id={`tbl-tab-${t.id}`}
              role="tab"
              aria-selected={activeTab === t.id}
              aria-controls={`tbl-panel-${t.id}`}
              className={`sidebar-tab${activeTab === t.id ? ' sidebar-tab--active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              <span className="sidebar-tab-icon" aria-hidden="true"><t.icon /></span>
              <span className="sidebar-tab-label">{t.label}</span>
              {t.badge && <span className="sidebar-tab-badge">{t.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="main-content">
          {children}
        </div>
      </div>
    </TabContext.Provider>
  );
}
