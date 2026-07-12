import { useState } from 'react';
import './Sidebar.css';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: '📊' },
  { label: 'Sessions', icon: '🕒' },
  { label: 'Logs', icon: '📜' },
  { label: 'Settings', icon: '⚙️' },
];

function Sidebar() {
  const [active, setActive] = useState('Dashboard');

  return (
    <nav className="sidebar card">
      <div className="sidebar-brand">NQ</div>
      <ul className="sidebar-nav">
        {NAV_ITEMS.map(({ label, icon }) => (
          <li
            key={label}
            className={`sidebar-nav-item ${active === label ? 'active' : ''}`}
            onClick={() => setActive(label)}
          >
            <span className="sidebar-nav-icon">{icon}</span>
            <span className="sidebar-nav-label">{label}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default Sidebar;
