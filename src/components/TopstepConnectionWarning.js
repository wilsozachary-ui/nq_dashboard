import { useState, useEffect, useRef } from 'react';
import { useTestBotSnapshot } from './morningStrategyShared';
import './TopstepConnectionWarning.css';

// Persistent (not auto-hiding, unlike MarketOpenBanner) -- this is a
// standing safety instruction, not a transient status update. Dismissing
// it only hides it for the current armed session; it reappears the next
// time the bot goes from off to armed/active, same as a fresh reminder
// each time the risk is live again.
export default function TopstepConnectionWarning() {
  const snapshot = useTestBotSnapshot('live');
  const [dismissed, setDismissed] = useState(false);
  const wasOnRef = useRef(false);

  const armed = !!snapshot.armed;
  const status = snapshot.status || 'OFF';
  const on = armed || status === 'ARMED' || status === 'ACTIVE';
  const snapshotError = snapshot._snapshotMeta?.error;
  const snapshotStale = snapshot._snapshotMeta?.stale;

  useEffect(() => {
    if (on && !wasOnRef.current) setDismissed(false);
    wasOnRef.current = on;
  }, [on]);

  // A stale live snapshot is safety-critical regardless of the last known
  // armed value: OFF may simply be cached. Keep this warning global and
  // non-dismissible until a successful poll restores server truth.
  if (snapshotStale) {
    return (
      <div className="tcw-banner tcw-banner--error" role="alert">
        <span className="tcw-icon" aria-hidden="true">âš </span>
        <span className="tcw-text">
          <strong>Bot status is unavailable â€” displayed trading state may be stale.</strong>{' '}
          Reconnect before arming, disarming, or changing live-trading settings.
          {snapshotError && <span className="tcw-detail"> ({snapshotError})</span>}
        </span>
      </div>
    );
  }

  if (!on || dismissed) return null;

  return (
    <div className="tcw-banner" role="alert">
      <span className="tcw-icon" aria-hidden="true">⚠</span>
      <span className="tcw-text">
        <strong>Bot is armed — do not open TopstepX or ProjectX.</strong>{' '}
        Topstep only allows one active connection; signing in there will disarm the bot.
      </span>
      <button className="tcw-dismiss" onClick={() => setDismissed(true)} aria-label="Dismiss">✕</button>
    </div>
  );
}
