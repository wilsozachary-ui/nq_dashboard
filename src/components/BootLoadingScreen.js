import { useEffect, useState } from 'react';
import logo from '../assets/logo.png';
import './BootLoadingScreen.css';

// How long to wait before offering a manual way past this screen.
// initializeCockpit()'s own readiness loop retries forever (1s, 2s, 4s...
// capped at 10s) with no attempt limit, so without an escape hatch a
// genuinely down backend would trap the user here indefinitely -- worse
// than just letting them into the (today's existing) partially-broken
// cockpit with its small "Backend connecting" banner.
const ESCAPE_HATCH_MS = 20_000;

// Shown right after a customer lands here from "Open my bot dashboard" in
// NQ Cloud, while the container's API and its live WebSocket/heartbeat
// connection are still catching up -- covers the same window the small
// "Backend connecting" banner already reported, just as a proper full-screen
// state instead of a sliver of text above an otherwise-empty cockpit.
export default function BootLoadingScreen({ missing = [], onContinueAnyway }) {
  const [showEscapeHatch, setShowEscapeHatch] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowEscapeHatch(true), ESCAPE_HATCH_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="boot-loading">
      <div className="boot-loading-card">
        <img src={logo} alt="" className="boot-loading-logo" aria-hidden="true" />
        <span className="boot-loading-spinner" aria-hidden="true" />
        <h1 className="boot-loading-title">Connecting to your bot…</h1>
        <p className="boot-loading-copy">
          Waiting for your bot's API and live connection to come up. This usually takes a few seconds.
        </p>
        {missing.length > 0 && (
          <p className="boot-loading-detail">{missing.join(', ')}</p>
        )}
        {showEscapeHatch && (
          <div className="boot-loading-escape">
            <p className="boot-loading-copy">This is taking longer than usual.</p>
            <button type="button" className="boot-loading-continue-btn" onClick={onContinueAnyway}>
              Continue to dashboard anyway
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
