import { useState, useEffect, useRef, useCallback } from 'react';
import useBotData from '../hooks/useBotData';
import useWebSocket from '../hooks/useWebSocket';
import { isFuturesMarketOpenNow } from '../utils/marketOpenMode';
import './LiveTicker.css';

// ── Constants ─────────────────────────────────────────────────────────────────
const RENDER_INTERVAL_MS = 50; // throttle price commits to at most 20fps

// ─────────────────────────────────────────────────────────────────────────────
// Main component -- just the live NQ price, kept intentionally minimal.
// VIX/overnight-range context lives in MarketContextPanel.js instead, and
// tick-speed/last-update stats were dropped since nothing on this panel
// needs them anymore.
// ─────────────────────────────────────────────────────────────────────────────

export default function LiveTicker() {
  const { state: botState } = useBotData({ autoInitialize: true, autoRefresh: false });
  const { status: liveStatus, lastMessage } = useWebSocket({ autoConnect: true });

  const [price,      setPrice]      = useState(null);
  const [prevPrice,  setPrevPrice]  = useState(null);
  const [direction,  setDirection]  = useState(null);   // 'up' | 'down' | null
  const [pulsing,    setPulsing]    = useState(false);
  const [isLive,     setIsLive]     = useState(false);
  const [wsStatus,   setWsStatus]   = useState('connecting');
  // Read directly on mount (not just via the change event below) so a page
  // load during the weekend close shows the right state immediately,
  // rather than only correcting itself on the next scheduler tick.
  const [futuresOpen, setFuturesOpen] = useState(() => isFuturesMarketOpenNow());

  const pulseTimer  = useRef(null);
  const pendingRef  = useRef(null); // latest price awaiting the next throttled flush

  const extractPrice = useCallback((msg) => {
    if (!msg || typeof msg !== 'object') return null;
    const p = msg.price ?? msg.lastPrice ?? msg.value ?? msg.last;
    if (p == null || Number.isNaN(Number(p))) return null;
    return Number(p);
  }, []);

  // ── Raw tick arrival ──────────────────────────────────────────────────────
  // Only the latest value is kept for the throttled render flush below.
  const handleTick = useCallback((newPrice) => {
    pendingRef.current = newPrice;
  }, []);

  // ── Throttled render commit (at most 20fps) ──────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      const pending = pendingRef.current;
      if (pending == null) return;
      pendingRef.current = null;

      setPrice(prev => {
        const dir = prev == null ? null : pending > prev ? 'up' : pending < prev ? 'down' : null;
        setDirection(dir);
        setPrevPrice(prev);
        return pending;
      });

      clearTimeout(pulseTimer.current);
      setPulsing(true);
      pulseTimer.current = setTimeout(() => setPulsing(false), 260);
    }, RENDER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // ── Snapshot from bot store ───────────────────────────────────────────────
  useEffect(() => {
    const fromState = extractPrice({
      ...(botState?.price || {}),
      ...(botState?.tick || {}),
    });
    if (fromState != null) handleTick(fromState);
  }, [botState?.price, botState?.tick, extractPrice, handleTick]);

  // ── Realtime updates from useWebSocket ────────────────────────────────────
  useEffect(() => {
    setWsStatus(liveStatus === 'connected' ? 'connected' : liveStatus === 'reconnecting' ? 'connecting' : liveStatus === 'stopped' ? 'disconnected' : liveStatus);
    const parsed = extractPrice(lastMessage);
    if (parsed != null) handleTick(parsed);
  }, [liveStatus, lastMessage, extractPrice, handleTick]);

  // ── Market open mode ──────────────────────────────────────────────────────
  useEffect(() => {
    const h = e => setIsLive(e.detail.active);
    window.addEventListener('nq:market-open-mode', h);
    return () => window.removeEventListener('nq:market-open-mode', h);
  }, []);

  // ── Futures weekly session (Fri 3pm CT - Sun 5pm CT close) ────────────────
  useEffect(() => {
    const h = e => setFuturesOpen(e.detail.open);
    window.addEventListener('nq:futures-market-mode', h);
    return () => window.removeEventListener('nq:futures-market-mode', h);
  }, []);

  // ── Mount flag (checklist DOM/global check) ───────────────────────────────
  useEffect(() => { window.LiveTickerMounted = true; return () => { window.LiveTickerMounted = false; }; }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => clearTimeout(pulseTimer.current), []);

  // ── Derived display values ────────────────────────────────────────────────
  const dir   = direction ?? 'flat';
  const delta = price != null && prevPrice != null ? price - prevPrice : null;

  return (
    <div className={`card ltk-panel live-ticker${isLive ? ' ltk-panel--live' : ''}`}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="ltk-header">
        <div className="ltk-header-left">
          <span className="ltk-icon" aria-hidden="true">◈</span>
          <h3 className="panel-title ltk-title">NQ Live Ticker</h3>
          {isLive && <span className="ltk-live-badge">● LIVE</span>}
        </div>
        {futuresOpen ? (
          <span className={`ltk-ws ltk-ws--${wsStatus}`}>
            <span className="ltk-ws-dot" />
            {wsStatus === 'connected' ? 'Live' : 'Connecting…'}
          </span>
        ) : (
          <span className="ltk-ws ltk-ws--closed">
            <span className="ltk-ws-dot" />
            Closed
          </span>
        )}
      </div>

      {/* ── Price display ────────────────────────────────────────────────── */}
      {!futuresOpen ? (
        <div className="ltk-price-section ltk-closed" aria-live="polite">
          <div className="ltk-closed-text">Market Closed</div>
          <div className="ltk-closed-hint">Reopens Sunday 5:00pm CT</div>
        </div>
      ) : (
      <div className="ltk-price-section" aria-live="polite" aria-label="Current NQ price">
        <div className={`ltk-price-row${pulsing ? ` ltk-price-row--pulse-${dir}` : ''}${isLive ? ' ltk-price-row--live' : ''}`}>

          {/* Direction arrow */}
          <span className={`ltk-arrow ltk-arrow--${dir}`} aria-hidden="true">
            {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '◆'}
          </span>

          {/* Price */}
          <div className={`nq-price-large nq-price-large--${dir}`}>
            {price != null ? price.toFixed(2) : '—'}
          </div>

          {/* Delta */}
          {delta != null && Math.abs(delta) > 0 && (
            <span className={`ltk-delta ltk-delta--${dir}`}>
              {delta > 0 ? '+' : ''}{delta.toFixed(2)}
            </span>
          )}
        </div>
      </div>
      )}

    </div>
  );
}
