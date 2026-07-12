import { useState, useEffect, useRef, useCallback } from 'react';
import { USE_MOCK } from '../api/pnlApi';
import './TradeExecutionVisualizer.css';

// ── Event catalogue ───────────────────────────────────────────────────────────
const EVENTS = {
  trade_opened:             { label: 'TRADE OPENED',    icon: '▶', color: 'green',  bodyMs: 300 },
  stop_loss_moved:          { label: 'SL MOVED',         icon: '▲', color: 'amber',  bodyMs: 250 },
  take_profit_moved:        { label: 'TP MOVED',         icon: '◆', color: 'blue',   bodyMs: 250 },
  trailing_stop_activated:  { label: 'TRAILING ACTIVE',  icon: '∞', color: 'purple', bodyMs: 300 },
  partial_exit:             { label: 'PARTIAL EXIT',     icon: '■', color: 'orange', bodyMs: 250 },
  trade_closed:             { label: 'TRADE CLOSED',     icon: '○', color: 'red',    bodyMs: 300 },
};

const OVERLAY_MS = 1500;

// ── Mock demo sequence — plays once, ~60s total ───────────────────────────────
const MOCK_SEQUENCE = [
  { type: 'trade_opened',            delay: 7000,  entryPrice: 20450.25, stopLoss: 20430.00, takeProfit: 20480.00, positionSize: 1,    pnl: 0     },
  { type: 'stop_loss_moved',         delay: 9000,  stopLoss: 20437.50 },
  { type: 'take_profit_moved',       delay: 8000,  takeProfit: 20492.50 },
  { type: 'trailing_stop_activated', delay: 8000 },
  { type: 'partial_exit',            delay: 9000,  positionSize: 0.5,    pnl: 125 },
  { type: 'trade_closed',            delay: 10000, exitPrice: 20488.00,  pnl: 287.50 },
];

// ── WS reconnect helper ───────────────────────────────────────────────────────
// ── Component ─────────────────────────────────────────────────────────────────
export default function TradeExecutionVisualizer() {
  const [overlay,   setOverlay]   = useState(null);
  const bodyTimer   = useRef(null);
  const overlayTimer = useRef(null);

  // ── Core event handler ────────────────────────────────────────────────────
  const handleEvent = useCallback((raw) => {
    const cfg = EVENTS[raw.type];
    if (!cfg) return;

    // 1. Set body data attribute — drives CSS micro-animations on all elements
    clearTimeout(bodyTimer.current);
    document.body.setAttribute('data-tev', raw.type);
    bodyTimer.current = setTimeout(
      () => document.body.removeAttribute('data-tev'),
      cfg.bodyMs + 50
    );

    // 2. Pulse StrategyControlBar heartbeat indicator
    window.dispatchEvent(new CustomEvent('nq:heartbeat'));

    // 3. In mock mode, push event to ActivityDashboard timeline
    if (USE_MOCK) {
      window.dispatchEvent(new CustomEvent('nq:param-update', {
        detail: {
          type:         raw.type,
          timestamp:    raw.timestamp || new Date().toISOString(),
          pnl:          raw.pnl          ?? null,
          entryPrice:   raw.entryPrice   ?? null,
          exitPrice:    raw.exitPrice    ?? null,
          stopLoss:     raw.stopLoss     ?? null,
          takeProfit:   raw.takeProfit   ?? null,
          positionSize: raw.positionSize ?? null,
        },
      }));
    }

    // 4. Show overlay notification
    clearTimeout(overlayTimer.current);
    setOverlay({ ...cfg, key: Date.now() });
    overlayTimer.current = setTimeout(() => setOverlay(null), OVERLAY_MS + 100);
  }, []);

  // ── Mock: play demo sequence once after short delay ───────────────────────
  useEffect(() => {
    if (!USE_MOCK) return;
    const timers = [];
    let acc = 0;
    MOCK_SEQUENCE.forEach(event => {
      acc += event.delay;
      timers.push(setTimeout(() => handleEvent({
        ...event,
        timestamp: new Date().toISOString(),
      }), acc));
    });
    return () => timers.forEach(clearTimeout);
  }, [handleEvent]);

  // ── Real mode: own WS connection to /ws/activity ──────────────────────────
  useEffect(() => {
    if (USE_MOCK) return;
    const handler = event => { if (EVENTS[event.detail.type]) handleEvent(event.detail); };
    window.addEventListener('nq:integrated-activity', handler);
    return () => window.removeEventListener('nq:integrated-activity', handler);
  }, [handleEvent]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      document.body.removeAttribute('data-tev');
      clearTimeout(bodyTimer.current);
      clearTimeout(overlayTimer.current);
    };
  }, []);

  // ── Overlay notification ──────────────────────────────────────────────────
  if (!overlay) return null;

  return (
    <div
      key={overlay.key}
      className={`tev-overlay tev-overlay--${overlay.color}`}
      aria-live="assertive"
      role="status"
    >
      <span className="tev-overlay-icon" aria-hidden="true">{overlay.icon}</span>
      <span className="tev-overlay-text">{overlay.label}</span>
    </div>
  );
}
