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

  useEffect(() => {
    if (on && !wasOnRef.current) setDismissed(false);
    wasOnRef.current = on;
  }, [on]);

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
