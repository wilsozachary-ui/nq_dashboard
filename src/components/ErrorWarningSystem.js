import { useState, useEffect, useRef, useCallback } from 'react';
import { USE_MOCK } from '../api/pnlApi';
import './ErrorWarningSystem.css';

// ── Toast DISMISS_MS ──────────────────────────────────────────────────────────
const TOAST_MS  = 4000;  // auto-dismiss delay
const FADE_MS   = 300;   // fade-out duration before removal

// ── Banner types that persist until explicitly resolved ───────────────────────
const BANNER_TYPES = new Set([
  'websocket_disconnect',
  'websocket_reconnecting',
  'api_degraded',
  'risk_warning',
  'bot_paused',
  'market_open_delay',
]);

// ── Types that, when received, resolve a banner of a different type ───────────
const AUTO_RESOLVES = {
  websocket_reconnect: ['websocket_disconnect', 'websocket_reconnecting'],
  risk_ok:             ['risk_warning'],
  bot_resumed:         ['bot_paused'],
};

// ── Level → icon map ──────────────────────────────────────────────────────────
const ICONS = {
  error:    '✕',
  warning:  '⚠',
  critical: '⛔',
  info:     '●',
};

// ── Critical modal type configs ───────────────────────────────────────────────
const CRITICAL_CFG = {
  risk_limit_hit:      { icon: '⛔', title: 'Risk Limit Hit',           ack: 'ACKNOWLEDGE & RESUME MONITORING' },
  bot_error:           { icon: '⚠', title: 'Bot Error',                 ack: 'ACKNOWLEDGE & REVIEW LOGS' },
  bot_killed:          { icon: '⛔', title: 'Kill Switch Activated',     ack: 'ACKNOWLEDGE — POSITIONS CLOSED' },
  websocket_failure:   { icon: '⚠', title: 'WebSocket Failure',         ack: 'ACKNOWLEDGE' },
  market_open_failure: { icon: '⚠', title: 'Market Open Mode Failure',  ack: 'ACKNOWLEDGE' },
  _default:            { icon: '⚠', title: 'Critical Alert',            ack: 'ACKNOWLEDGE' },
};

// ── Mock demo sequence ────────────────────────────────────────────────────────
// Fires in mock mode to demonstrate all three notification tiers.
const MOCK_DEMO = [
  { delay: 2000,  level: 'info',     type: 'system_ready',        message: 'All feeds connected — monitoring active' },
  { delay: 7000,  level: 'warning',  type: 'websocket_disconnect', message: 'Activity WebSocket delayed — attempting reconnect' },
  { delay: 6000,  level: 'resolve',  type: 'websocket_disconnect', message: '' },
  { delay: 5000,  level: 'error',    type: 'api_latency',          message: 'API latency elevated — 743 ms response time' },
  { delay: 9000,  level: 'warning',  type: 'risk_warning',         message: 'Risk approaching daily limit — 71% of maximum' },
  { delay: 7000,  level: 'resolve',  type: 'risk_warning',         message: '' },
  { delay: 4000,  level: 'warning',  type: 'bot_paused',           message: 'Strategy bot paused — no new positions' },
  { delay: 5000,  level: 'resolve',  type: 'bot_paused',           message: '' },
  { delay: 6000,  level: 'critical', type: 'risk_limit_hit',       message: 'Daily loss limit reached — bot has been auto-paused' },
];

// ── Unique ID ─────────────────────────────────────────────────────────────────
let _seq = 0;
function genId() { return `ews-${Date.now()}-${++_seq}`; }

// ── Toast sub-component ───────────────────────────────────────────────────────
function Toast({ toast, onDismiss }) {
  return (
    <div
      className={`ews-toast ews-toast--${toast.level}${toast.fading ? ' ews-toast--fade' : ''}`}
      role="alert"
      aria-live="assertive"
    >
      <span className="ews-toast-icon" aria-hidden="true">{ICONS[toast.level] ?? '●'}</span>
      <div className="ews-toast-body">
        <span className="ews-toast-msg">{toast.message}</span>
        <span className="ews-toast-type">{toast.type.replace(/_/g, ' ')}</span>
      </div>
      <button
        className="ews-toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >✕</button>
    </div>
  );
}

// ── Banner sub-component ──────────────────────────────────────────────────────
function Banner({ banner, onDismiss }) {
  return (
    <div className={`ews-banner ews-banner--${banner.level}`} role="alert">
      <span className="ews-banner-icon" aria-hidden="true">{ICONS[banner.level]}</span>
      <span className="ews-banner-msg">{banner.message}</span>
      <span className="ews-banner-type">{banner.type.replace(/_/g, ' ')}</span>
      <button
        className="ews-banner-close"
        onClick={() => onDismiss(banner.type)}
        aria-label="Dismiss warning"
      >✕</button>
    </div>
  );
}

// ── CriticalModal sub-component ───────────────────────────────────────────────
function CriticalModal({ critical, onAck }) {
  const cfg = CRITICAL_CFG[critical.type] ?? CRITICAL_CFG._default;

  return (
    <div className="ews-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ews-modal-title">
      <div className="ews-modal">
        <div className="ews-modal-icon" aria-hidden="true">{cfg.icon}</div>
        <h2 className="ews-modal-title" id="ews-modal-title">{cfg.title}</h2>
        <p className="ews-modal-msg">{critical.message}</p>
        {critical.detail && (
          <p className="ews-modal-detail">{critical.detail}</p>
        )}
        <div className="ews-modal-meta">
          <span>{new Date(critical.timestamp).toLocaleTimeString()}</span>
          <span>{critical.type.replace(/_/g, ' ')}</span>
        </div>
        <button className="ews-modal-ack" onClick={onAck} autoFocus>
          {cfg.ack}
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ErrorWarningSystem() {
  const [toasts,   setToasts]   = useState([]);
  const [banners,  setBanners]  = useState([]);
  const [critical, setCritical] = useState(null);
  const watchdogRef = useRef(null);

  // ── Add a toast (auto-dismisses after TOAST_MS) ──────────────────────────
  const addToast = useCallback((level, type, message) => {
    const id = genId();
    setToasts(prev => [...prev.slice(-4), { id, level, type, message, fading: false }]);

    // Start fade-out 300ms before removal
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, fading: true } : t));
    }, TOAST_MS - FADE_MS);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, TOAST_MS);
  }, []);

  // ── Add a persistent banner (dedup by type) ──────────────────────────────
  const addBanner = useCallback((level, type, message) => {
    setBanners(prev => {
      if (prev.some(b => b.type === type)) return prev;
      return [...prev, { id: genId(), level, type, message }];
    });
  }, []);

  // ── Remove a banner by type ───────────────────────────────────────────────
  const removeBanner = useCallback((type) => {
    setBanners(prev => prev.filter(b => b.type !== type));
  }, []);

  // ── Manual toast dismiss ──────────────────────────────────────────────────
  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Critical acknowledgment ───────────────────────────────────────────────
  const ackCritical = useCallback(() => {
    if (!critical) return;
    // Log acknowledgment to ActivityDashboard timeline
    window.dispatchEvent(new CustomEvent('nq:param-update', {
      detail: {
        type:      'param_update',
        timestamp: new Date().toISOString(),
        note:      `⚠ ACKNOWLEDGED: ${critical.type.replace(/_/g, ' ')}`,
      },
    }));
    setCritical(null);
  }, [critical]);

  // ── Route incoming nq:ews-event ───────────────────────────────────────────
  const routeEvent = useCallback((e) => {
    const { level, type, message, detail } = e.detail;

    // Check if this event should auto-resolve any existing banners
    const resolves = AUTO_RESOLVES[type];
    if (resolves) {
      resolves.forEach(removeBanner);
      // Toasts for reconnect resolutions
      if (type === 'websocket_reconnect') addToast('info', type, 'WebSocket reconnected');
      return;
    }

    // Route by level
    if (level === 'critical') {
      setCritical({ type, message, detail: detail?.note ?? null, id: genId(), timestamp: Date.now() });
      window.dispatchEvent(new CustomEvent('nq:param-update', {
        detail: {
          type:      'param_update',
          timestamp: new Date().toISOString(),
          note:      `🚨 CRITICAL: ${message}`,
        },
      }));
      return;
    }

    if (level === 'warning' && BANNER_TYPES.has(type)) {
      addBanner('warning', type, message);
      return;
    }

    if (level === 'error') {
      addToast('error', type, message);
      return;
    }

    // 'info' or unmatched warnings → toast
    addToast(level, type, message);
  }, [addToast, addBanner, removeBanner]);

  // ── Subscribe to global error bus ────────────────────────────────────────
  useEffect(() => {
    window.addEventListener('nq:ews-event', routeEvent);
    return () => window.removeEventListener('nq:ews-event', routeEvent);
  }, [routeEvent]);

  // ── Subscribe to manual resolve events ───────────────────────────────────
  useEffect(() => {
    const handler = e => removeBanner(e.detail.type);
    window.addEventListener('nq:ews-resolve', handler);
    return () => window.removeEventListener('nq:ews-resolve', handler);
  }, [removeBanner]);

  // ── Bot status listener ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = e => {
      const { status, prev } = e.detail;
      if (status === 'paused') {
        addBanner('warning', 'bot_paused', 'Strategy bot paused — no new positions will open');
      } else if (status === 'running' && prev === 'paused') {
        removeBanner('bot_paused');
        addToast('info', 'bot_resumed', 'Bot resumed — strategy active');
      } else if (status === 'error') {
        setCritical({ type: 'bot_error', message: 'Bot has entered an error state. Manual intervention required.', id: genId(), timestamp: Date.now() });
      } else if (status === 'killed') {
        setCritical({ type: 'bot_killed', message: 'Kill switch activated. All open positions have been closed.', id: genId(), timestamp: Date.now() });
      }
    };
    window.addEventListener('nq:bot-status', handler);
    return () => window.removeEventListener('nq:bot-status', handler);
  }, [addBanner, removeBanner, addToast]);

  // ── Risk status listener ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = e => {
      const { riskStatus, prev } = e.detail;
      if (riskStatus === 'warning') {
        addBanner('warning', 'risk_warning', 'Risk approaching daily limit — consider reducing exposure');
      } else if (riskStatus === 'limit') {
        removeBanner('risk_warning');
        setCritical({ type: 'risk_limit_hit', message: 'Daily loss limit reached. Bot has been auto-paused.', id: genId(), timestamp: Date.now() });
      } else if (riskStatus === 'ok' && prev !== 'ok') {
        removeBanner('risk_warning');
        addToast('info', 'risk_ok', 'Risk status normalized');
      }
    };
    window.addEventListener('nq:risk-update', handler);
    return () => window.removeEventListener('nq:risk-update', handler);
  }, [addBanner, removeBanner, addToast]);

  // ── Heartbeat watchdog — detects WS silence in real mode ─────────────────
  useEffect(() => {
    if (USE_MOCK) return;
    const TIMEOUT_MS = 15_000;

    function resetWatchdog() {
      clearTimeout(watchdogRef.current);
      removeBanner('websocket_disconnect');
      watchdogRef.current = setTimeout(() => {
        addBanner('warning', 'websocket_disconnect', 'Activity WebSocket silent — attempting reconnect');
      }, TIMEOUT_MS);
    }

    window.addEventListener('nq:heartbeat', resetWatchdog);
    resetWatchdog();
    return () => {
      clearTimeout(watchdogRef.current);
      window.removeEventListener('nq:heartbeat', resetWatchdog);
    };
  }, [addBanner, removeBanner]);

  // ── Market open mode listener ─────────────────────────────────────────────
  useEffect(() => {
    const handler = e => {
      if (!e.detail.active) {
        // Unexpected deactivation during session hours would be a warning
        // (normal close at 15:00 is not unexpected)
        const h = new Date().getHours();
        if (h >= 8 && h < 14) {
          addBanner('warning', 'market_open_delay', 'Market Open Mode deactivated unexpectedly');
        }
      }
    };
    window.addEventListener('nq:market-open-mode', handler);
    return () => window.removeEventListener('nq:market-open-mode', handler);
  }, [addBanner]);

  // ── Mock demo sequence ────────────────────────────────────────────────────
  useEffect(() => {
    if (!USE_MOCK) return;
    const timers = [];
    let acc = 0;
    MOCK_DEMO.forEach(step => {
      acc += step.delay;
      timers.push(setTimeout(() => {
        if (step.level === 'resolve') {
          removeBanner(step.type);
        } else {
          window.dispatchEvent(new CustomEvent('nq:ews-event', {
            detail: {
              id:        genId(),
              level:     step.level,
              type:      step.type,
              message:   step.message,
              detail:    {},
              timestamp: Date.now(),
            },
          }));
        }
      }, acc));
    });
    return () => timers.forEach(clearTimeout);
  }, [removeBanner]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => clearTimeout(watchdogRef.current), []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Warning Banners (sticky top, stacks below price strip) ───── */}
      {banners.length > 0 && (
        <div className="ews-banner-stack" role="region" aria-label="System warnings">
          {banners.map(b => (
            <Banner key={b.id} banner={b} onDismiss={removeBanner} />
          ))}
        </div>
      )}

      {/* ── Toast Notifications (fixed bottom-right) ──────────────────── */}
      {toasts.length > 0 && (
        <div className="ews-toast-stack" role="log" aria-live="polite" aria-label="System notifications">
          {toasts.map(t => (
            <Toast key={t.id} toast={t} onDismiss={dismissToast} />
          ))}
        </div>
      )}

      {/* ── Critical Alert Modal ──────────────────────────────────────── */}
      {critical && (
        <CriticalModal critical={critical} onAck={ackCritical} />
      )}
    </>
  );
}
