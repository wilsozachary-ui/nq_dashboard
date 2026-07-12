import { useState, useEffect, useRef } from 'react';
import './MarketOpenBanner.css';

const OPEN_TEXT  = 'MARKET OPEN — LIVE MODE ACTIVE';
const CLOSE_TEXT = 'SESSION CLOSED — MARKET OPEN MODE DISABLED';
const AUTO_HIDE_MS = 10_000;

export default function MarketOpenBanner() {
  const [visible, setVisible] = useState(false);
  const [isOpen,  setIsOpen]  = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    const handler = e => {
      setIsOpen(e.detail.active);
      setVisible(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    };

    window.addEventListener('nq:market-open-mode', handler);
    return () => {
      window.removeEventListener('nq:market-open-mode', handler);
      clearTimeout(timerRef.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`mob-banner mob-banner--${isOpen ? 'open' : 'close'}`}
      role="status"
      aria-live="assertive"
    >
      <span className="mob-banner-dot" aria-hidden="true" />
      <span className="mob-banner-text">
        {isOpen ? OPEN_TEXT : CLOSE_TEXT}
      </span>
      <button
        className="mob-banner-dismiss"
        onClick={() => { clearTimeout(timerRef.current); setVisible(false); }}
        aria-label="Dismiss"
      >✕</button>
    </div>
  );
}
