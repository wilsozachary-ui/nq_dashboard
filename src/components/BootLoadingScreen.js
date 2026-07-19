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

// The choreographed reveal below is timed to land around 7s (5 stages x
// STAGE_MS) -- App.js holds this screen up for at least that long even if
// the backend answers ready sooner, so the moment always plays out in
// full rather than sometimes flashing by in half a second. If the backend
// genuinely isn't ready yet, the last stage just holds until it is; only
// ESCAPE_HATCH_MS above is the "something's actually wrong" fallback.
const STAGE_MS = 1400;
const STAGES = [
  'Booting your trading engine…',
  'Linking to the market feed…',
  'Syncing account data…',
  'Arming risk controls…',
  'Almost there…',
];

// Shown right after a customer lands here from "Open my bot dashboard" in
// NQ Cloud, while the container's API and its live WebSocket/heartbeat
// connection are still catching up -- covers the same window the small
// "Backend connecting" banner already reported, just as a proper full-screen
// moment instead of a sliver of text above an otherwise-empty cockpit.
export default function BootLoadingScreen({ missing = [], onContinueAnyway, name }) {
  const [showEscapeHatch, setShowEscapeHatch] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setShowEscapeHatch(true), ESCAPE_HATCH_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Advances through STAGES once and holds on the last one -- not a
    // repeating loop. A loading screen that visibly cycles back to
    // "Booting…" after already saying "Almost there…" reads as broken/
    // stuck, not dramatic.
    if (stageIndex >= STAGES.length - 1) return undefined;
    const timer = setTimeout(() => setStageIndex(i => i + 1), STAGE_MS);
    return () => clearTimeout(timer);
  }, [stageIndex]);

  return (
    <div className="boot-loading">
      <div className="boot-loading-card">
        <img src={logo} alt="" className="boot-loading-logo" aria-hidden="true" />
        <span className="boot-loading-spinner" aria-hidden="true" />
        {/* Omitted entirely (not "Hello, ") while the name hasn't loaded yet
            or the account has none on file (nullable -- see User model) --
            never render a placeholder/undefined greeting. */}
        {name && <p className="boot-loading-greeting">Hello, {name}</p>}
        <h1 className="boot-loading-title">Your trading day is about to begin.</h1>
        <p className="boot-loading-stage" key={stageIndex}>{STAGES[stageIndex]}</p>
        <div className="boot-loading-bar-track" role="img" aria-label="Loading">
          <span className="boot-loading-bar-fill" />
        </div>
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
