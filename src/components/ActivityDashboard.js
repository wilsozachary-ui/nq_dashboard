import { useState, useEffect, useCallback, useRef } from 'react';
import { USE_MOCK } from '../api/pnlApi';
import useWebSocket from '../hooks/useWebSocket';
import './ActivityDashboard.css';
import { integratedFetch } from '../CockpitIntegrator';

// ── Constants ─────────────────────────────────────────────────────────────────
const TICK_SIZE  = 0.25;   // NQ: 1 tick = 0.25 pts
const TICK_VALUE = 5.00;   // NQ: 1 tick = $5/contract
const PT_VALUE   = 20.00;  // NQ: 1 point = $20/contract

const EVENT_CFG = {
  trade_opened:      { label: 'Trade Opened',    variant: 'green',  icon: '●' },
  stop_loss_moved:   { label: 'Stop Loss Moved', variant: 'amber',  icon: '▲' },
  take_profit_moved: { label: 'TP Adjusted',     variant: 'blue',   icon: '◆' },
  partial_exit:      { label: 'Partial Exit',    variant: 'purple', icon: '■' },
  trade_closed:      { label: 'Trade Closed',    variant: 'red',    icon: '○' },
  param_update:      { label: 'Param Update',    variant: 'blue',   icon: '◈' },
};

const BOT_STATUS_LABEL = {
  running:       'RUNNING',
  reconnecting:  'RECONNECTING',
  disconnected:  'DISCONNECTED',
};

// ── Pure helpers ──────────────────────────────────────────────────────────────
function toTicks(pts)  { return pts != null ? Math.round(pts / TICK_SIZE) : null; }
function fmtPrice(v)   { return v != null ? v.toFixed(2) : '—'; }
function fmtDollars(v) { return v != null ? `$${Math.abs(v).toFixed(0)}` : '—'; }

// WS events that carry no `strategy` field (gateway_quote, gateway_trade,
// pnl_monthly, log, ...) must never crash this on .replace() -- render a
// neutral placeholder instead of dropping the event.
const fmtStrategy = s => {
  if (typeof s !== 'string') return 'unknown';
  return s.replace(/_/g, ' ');
};

function fmtPnl(v) {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`;
}

function pnlClass(v) {
  if (v > 0) return 'act-pos';
  if (v < 0) return 'act-neg';
  return '';
}

function latencyClass(ms) {
  if (ms == null) return '';
  if (ms < 50)   return 'act-pos';
  if (ms < 150)  return 'act-amber-val';
  return 'act-neg';
}

function msAgo(ms) {
  if (ms == null) return '—';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

function describeEvent(raw) {
  const sz = raw.positionSize;
  const contracts = sz != null ? `${sz} contract${sz !== 1 ? 's' : ''}` : '';
  switch (raw.type) {
    case 'trade_opened':
      return `Trade Opened  @  ${fmtPrice(raw.entryPrice)}  ·  ${contracts}  ·  SL ${fmtPrice(raw.stopLoss)}  /  TP ${fmtPrice(raw.takeProfit)}`;
    case 'stop_loss_moved':
      return `Stop Loss Moved  →  ${fmtPrice(raw.stopLoss)}`;
    case 'take_profit_moved':
      return `Take Profit Adjusted  →  ${fmtPrice(raw.takeProfit)}`;
    case 'partial_exit':
      return `Partial Exit  @  ${fmtPrice(raw.exitPrice)}  ·  ${fmtPnl(raw.pnl)}`;
    case 'trade_closed':
      return `Trade Closed  @  ${fmtPrice(raw.exitPrice)}  ·  ${fmtPnl(raw.pnl)}`;
    default:
      return raw.type;
  }
}

function normalizeEvent(raw) {
  const ts = raw.timestamp ?? new Date().toISOString();
  return {
    id:           `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    time:         ts.length >= 19 ? ts.slice(11, 19) : new Date().toTimeString().slice(0, 8),
    type:         raw.type,
    pnl:          raw.pnl          ?? 0,
    entryPrice:   raw.entryPrice   ?? null,
    exitPrice:    raw.exitPrice    ?? null,
    stopLoss:     raw.stopLoss     ?? null,
    takeProfit:   raw.takeProfit   ?? null,
    positionSize: raw.positionSize ?? null,
    strategy:     raw.strategy     ?? null,
    note:         raw.note         ?? null,
  };
}

// ── Initial state ─────────────────────────────────────────────────────────────
const INIT_POSITION = {
  direction: 'FLAT', entryPrice: null, positionSize: 0,
  stopLoss: null, takeProfit: null, isOpen: false,
};
const INIT_PNL      = { tradePnl: 0, sessionPnl: 0, dailyPnl: 0 };
const INIT_METRICS  = { tradesCount: 0, slAdjustments: 0, tpAdjustments: 0, partialExits: 0 };
const INIT_SESSION  = { wins: 0, losses: 0, largestWin: 0, largestLoss: 0 };
const INIT_HEALTH   = { wsLatencyMs: null, apiLatencyMs: null, lastUpdateMs: null };

// ── Mock sequence ─────────────────────────────────────────────────────────────
const MOCK_SEQ = [
  { delay: 600,  type: 'heartbeat' },
  { delay: 1100, type: 'trade_opened',     entryPrice: 20450.25, stopLoss: 20430.00, takeProfit: 20485.00, positionSize: 1,   pnl: 0,      strategy: 'morning_strategy' },
  { delay: 3800, type: 'stop_loss_moved',  stopLoss: 20438.00,   positionSize: 1,    pnl: 0 },
  { delay: 6500, type: 'take_profit_moved',takeProfit: 20492.00, positionSize: 1,    pnl: 0 },
  { delay: 9200, type: 'stop_loss_moved',  stopLoss: 20445.00,   positionSize: 1,    pnl: 0 },
  { delay: 12500,type: 'partial_exit',     exitPrice: 20468.50,  positionSize: 0.5,  pnl: 365.00, strategy: 'morning_strategy' },
  { delay: 14800,type: 'stop_loss_moved',  stopLoss: 20450.00,   positionSize: 0.5,  pnl: 0 },
  { delay: 18000,type: 'trade_closed',     exitPrice: 20483.75,  positionSize: 0,    pnl: 668.75, strategy: 'morning_strategy' },
  { delay: 21000,type: 'heartbeat' },
  { delay: 27000,type: 'trade_opened',     entryPrice: 20472.00, stopLoss: 20455.00, takeProfit: 20505.00, positionSize: 2,   pnl: 0, strategy: 'morning_strategy' },
  { delay: 30500,type: 'stop_loss_moved',  stopLoss: 20462.00,   positionSize: 2,    pnl: 0 },
  { delay: 34000,type: 'take_profit_moved',takeProfit: 20510.00, positionSize: 2,    pnl: 0 },
];

// ── Sparkline sub-component ───────────────────────────────────────────────────
function Sparkline({ data, width = 80, height = 28 }) {
  if (!data || data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(max - min, 0.25);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="act-sparkline">
      <polyline points={pts} fill="none" strokeWidth="1.5"
                strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ActivityDashboard() {
  // ── Existing state ──────────────────────────────────────────────────────────
  const [position,    setPosition]    = useState(INIT_POSITION);
  const [pnl,         setPnl]         = useState(INIT_PNL);
  const [metrics,     setMetrics]     = useState(INIT_METRICS);
  const [events,      setEvents]      = useState([]);
  const [heartbeatAt, setHeartbeatAt] = useState(null);
  const [wsStatus,    setWsStatus]    = useState(USE_MOCK ? 'mock' : 'connecting');
  // ── New state ────────────────────────────────────────────────────────────────
  const [execStrip,    setExecStrip]    = useState(null);       // { text, type, key }
  const [currentPrice, setCurrentPrice] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [priceDir,     setPriceDir]     = useState(null);
  const [sessionStats, setSessionStats] = useState(INIT_SESSION);
  const [health,       setHealth]       = useState(INIT_HEALTH);
  const [apiReachable, setApiReachable] = useState(USE_MOCK);
  const [slFlash,      setSlFlash]      = useState(false);
  const [tpFlash,      setTpFlash]      = useState(false);
  const [clockStr,     setClockStr]     = useState(() => new Date().toLocaleTimeString());
  const [isLive,       setIsLive]       = useState(false);
  const [strategyName, setStrategyName] = useState('Morning Strategy');
  // ── Refs ─────────────────────────────────────────────────────────────────────
  const prevSlRef     = useRef(null);
  const prevTpRef     = useRef(null);
  const timelineRef   = useRef(null);

  // ── Central event processor ───────────────────────────────────────────────
  const processEvent = useCallback((raw) => {
    if (raw.type === 'heartbeat') {
      setHeartbeatAt(new Date());
      setHealth(prev => ({ ...prev, lastUpdateMs: Date.now() }));
      window.dispatchEvent(new CustomEvent('nq:heartbeat'));
      return;
    }

    window.dispatchEvent(new CustomEvent('nq:activity-event', { detail: raw }));

    const event = normalizeEvent(raw);
    setEvents(prev => [event, ...prev].slice(0, 100));
    setHealth(prev => ({ ...prev, lastUpdateMs: Date.now() }));

    if (raw.type !== 'heartbeat') {
      setExecStrip({ text: describeEvent(raw), type: raw.type, key: Date.now() });
    }

    setPosition(prev => {
      switch (raw.type) {
        case 'trade_opened':
          return {
            direction:    (raw.takeProfit ?? 0) > (raw.entryPrice ?? 0) ? 'LONG' : 'SHORT',
            entryPrice:   raw.entryPrice   ?? prev.entryPrice,
            positionSize: raw.positionSize ?? prev.positionSize,
            stopLoss:     raw.stopLoss     ?? prev.stopLoss,
            takeProfit:   raw.takeProfit   ?? prev.takeProfit,
            isOpen: true,
          };
        case 'stop_loss_moved':
          return { ...prev, stopLoss: raw.stopLoss ?? prev.stopLoss };
        case 'take_profit_moved':
          return { ...prev, takeProfit: raw.takeProfit ?? prev.takeProfit };
        case 'partial_exit':
          return { ...prev, positionSize: raw.positionSize ?? prev.positionSize };
        case 'trade_closed':
          return { ...INIT_POSITION };
        default:
          return prev;
      }
    });

    setPnl(prev => {
      switch (raw.type) {
        case 'trade_opened':  return { ...prev, tradePnl: 0 };
        case 'partial_exit':  return { tradePnl: prev.tradePnl + (raw.pnl ?? 0), sessionPnl: prev.sessionPnl + (raw.pnl ?? 0), dailyPnl: prev.dailyPnl + (raw.pnl ?? 0) };
        case 'trade_closed':  return { tradePnl: 0, sessionPnl: prev.sessionPnl + (raw.pnl ?? 0), dailyPnl: prev.dailyPnl + (raw.pnl ?? 0) };
        default:              return prev;
      }
    });

    setMetrics(prev => {
      switch (raw.type) {
        case 'trade_opened':      return { ...prev, tradesCount:   prev.tradesCount   + 1 };
        case 'stop_loss_moved':   return { ...prev, slAdjustments: prev.slAdjustments + 1 };
        case 'take_profit_moved': return { ...prev, tpAdjustments: prev.tpAdjustments + 1 };
        case 'partial_exit':      return { ...prev, partialExits:  prev.partialExits  + 1 };
        default:                  return prev;
      }
    });

    if (raw.type === 'trade_closed') {
      const tradePnl = raw.pnl ?? 0;
      setSessionStats(prev => ({
        wins:        prev.wins        + (tradePnl > 0 ? 1 : 0),
        losses:      prev.losses      + (tradePnl < 0 ? 1 : 0),
        largestWin:  tradePnl > 0 ? Math.max(prev.largestWin,  tradePnl) : prev.largestWin,
        largestLoss: tradePnl < 0 ? Math.min(prev.largestLoss, tradePnl) : prev.largestLoss,
      }));
    }
  }, []);

  // ── Clock ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setClockStr(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Mock event sequence ───────────────────────────────────────────────────
  useEffect(() => {
    if (!USE_MOCK) return;
    setHeartbeatAt(new Date());
    const timers = MOCK_SEQ.map(({ delay, ...ev }) =>
      setTimeout(() => processEvent({ ...ev, timestamp: new Date().toISOString() }), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [processEvent]);

  // ── Price feed — same live price stream LiveTicker.js consumes ──────────
  const { lastMessage: priceMessage } = useWebSocket({ autoConnect: true });
  const prevPriceRef = useRef(null);
  useEffect(() => {
    const lastPrice = priceMessage?.price;
    if (lastPrice == null) return;
    const prev = prevPriceRef.current;
    const direction = prev == null ? null : lastPrice > prev ? 'up' : lastPrice < prev ? 'down' : null;
    prevPriceRef.current = lastPrice;
    setCurrentPrice(lastPrice);
    setPriceDir(direction);
    setPriceHistory(h => [...h.slice(-29), lastPrice]);
  }, [priceMessage]);

  // ── Mock health simulation ────────────────────────────────────────────────
  useEffect(() => {
    if (!USE_MOCK) return;
    setHealth({ wsLatencyMs: 18, apiLatencyMs: 67, lastUpdateMs: Date.now() });
    const id = setInterval(() => {
      setHealth({
        wsLatencyMs:  10 + Math.floor(Math.random() * 35),
        apiLatencyMs: 40 + Math.floor(Math.random() * 90),
        lastUpdateMs: Date.now(),
      });
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // ── WebSocket connection ──────────────────────────────────────────────────
  useEffect(() => {
    if (USE_MOCK) return;
    const handler = event => { setWsStatus('connected'); setHeartbeatAt(new Date()); processEvent(event.detail); };
    window.addEventListener('nq:integrated-activity', handler);
    return () => window.removeEventListener('nq:integrated-activity', handler);
  }, [processEvent]);

  // ── API health check ──────────────────────────────────────────────────────
  useEffect(() => {
    if (USE_MOCK) return;
    const check = async () => {
      try {
        const t0 = performance.now();
        const r = await integratedFetch('/topstep/health');
        const ms = Math.round(performance.now() - t0);
        setApiReachable(r.ok);
        setHealth(prev => ({ ...prev, apiLatencyMs: ms }));
      } catch { setApiReachable(false); }
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  // ── SL/TP flash effects ───────────────────────────────────────────────────
  useEffect(() => {
    if (prevSlRef.current !== null && position.stopLoss !== prevSlRef.current) {
      setSlFlash(true);
      const t = setTimeout(() => setSlFlash(false), 700);
      prevSlRef.current = position.stopLoss;
      return () => clearTimeout(t);
    }
    prevSlRef.current = position.stopLoss;
  }, [position.stopLoss]);

  useEffect(() => {
    if (prevTpRef.current !== null && position.takeProfit !== prevTpRef.current) {
      setTpFlash(true);
      const t = setTimeout(() => setTpFlash(false), 700);
      prevTpRef.current = position.takeProfit;
      return () => clearTimeout(t);
    }
    prevTpRef.current = position.takeProfit;
  }, [position.takeProfit]);

  // ── Param update events from TradeParameterPanel ──────────────────────────
  useEffect(() => {
    const handler = e => processEvent(e.detail);
    window.addEventListener('nq:param-update', handler);
    return () => window.removeEventListener('nq:param-update', handler);
  }, [processEvent]);

  useEffect(() => {
    const handler = e => {
      const { strategy, config } = e.detail;
      setStrategyName(fmtStrategy(strategy).replace(/\b\w/g, c => c.toUpperCase()));
      setEvents([]);
      setPosition(INIT_POSITION);
      setPnl(INIT_PNL);
      setMetrics(INIT_METRICS);
      setSessionStats(INIT_SESSION);
      (config.events || []).filter(event => !event.strategy || event.strategy === strategy).forEach(processEvent);
      processEvent({ type: 'param_update', strategy, note: `Strategy switched → ${strategy}`, timestamp: new Date().toISOString() });
    };
    window.addEventListener('nq:strategy-change', handler);
    return () => window.removeEventListener('nq:strategy-change', handler);
  }, [processEvent]);

  // ── Market open mode ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = e => setIsLive(e.detail.active);
    window.addEventListener('nq:market-open-mode', handler);
    return () => window.removeEventListener('nq:market-open-mode', handler);
  }, []);

  // ── Auto-scroll timeline to top in live mode when new events arrive ───────
  useEffect(() => {
    if (isLive && timelineRef.current && events.length > 0) {
      timelineRef.current.scrollTop = 0;
    }
  }, [isLive, events]);

  // ── Derived values ────────────────────────────────────────────────────────
  const botAlive = heartbeatAt != null && Date.now() - heartbeatAt.getTime() < 60_000;

  const botStatus =
    wsStatus === 'mock' || wsStatus === 'connected' ? 'running' :
    wsStatus === 'connecting' ? 'reconnecting' : 'disconnected';

  let unrealizedPnl = 0;
  if (position.isOpen && currentPrice && position.entryPrice) {
    const diff = position.direction === 'LONG'
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;
    unrealizedPnl = Math.round(diff * (position.positionSize || 1) * PT_VALUE * 100) / 100;
  }

  const risk = (() => {
    if (!position.isOpen || !position.entryPrice) return null;
    const isLong = position.direction === 'LONG';
    const slDist  = isLong ? position.entryPrice - (position.stopLoss  ?? 0) : (position.stopLoss  ?? 0) - position.entryPrice;
    const tpDist  = isLong ? (position.takeProfit ?? 0) - position.entryPrice : position.entryPrice - (position.takeProfit ?? 0);
    const total   = Math.max(slDist + tpDist, 0.001);
    const slTicks = toTicks(Math.max(0, slDist));
    const tpTicks = toTicks(Math.max(0, tpDist));
    const size    = position.positionSize || 1;
    return {
      slTicks, tpTicks,
      slDollars: slTicks != null ? slTicks * TICK_VALUE * size : null,
      tpDollars: tpTicks != null ? tpTicks * TICK_VALUE * size : null,
      rr:        slDist > 0 ? (tpDist / slDist).toFixed(2) : '—',
      slPct:     (Math.max(0, slDist) / total) * 100,
      tpPct:     (Math.max(0, tpDist) / total) * 100,
    };
  })();

  const totalClosed = sessionStats.wins + sessionStats.losses;
  const winRate     = totalClosed > 0 ? Math.round((sessionStats.wins / totalClosed) * 100) : null;

  const readyChecks = [
    { label: 'WebSocket Connected', ok: wsStatus === 'connected' || wsStatus === 'mock' },
    { label: 'API Reachable',        ok: apiReachable },
    { label: 'Strategy Loaded',      ok: true },
    { label: 'Risk Parameters Set',  ok: true },
    { label: 'SL/TP Rules Loaded',   ok: true },
    { label: 'Bot Heartbeat Active', ok: botAlive },
  ];
  const allReady = readyChecks.every(c => c.ok);

  const priceColor = priceDir === 'up' ? 'act-pos' : priceDir === 'down' ? 'act-neg' : '';

  // Build timeline items with trade separators
  const timelineItems = [];
  events.forEach((ev, i) => {
    if (ev.type === 'trade_opened' && i > 0) {
      timelineItems.push(
        <div key={`sep-${ev.id}`} className="act-trade-sep"><span>new trade</span></div>
      );
    }
    const cfg = EVENT_CFG[ev.type] ?? { label: ev.type, variant: 'dim', icon: '○' };
    timelineItems.push(
      <div key={ev.id} className={`act-evt${i === 0 ? ' act-evt--new' : ''}`}>
        <div className="act-evt-rail">
          <span className={`act-evt-badge act-evt-badge--${cfg.variant}`}>
            <span className="act-evt-icon">{cfg.icon}</span>
            {cfg.label}
          </span>
          {i < events.length - 1 && <div className="act-evt-line" />}
        </div>
        <div className="act-evt-body">
          <div className="act-evt-meta">
            <span className="act-mono act-evt-time">{ev.time}</span>
            <span className="act-evt-strat">{fmtStrategy(ev.strategy)}</span>
          </div>
          <div className="act-evt-details">
            {ev.entryPrice   != null && <span className="act-detail">Entry <b>{fmtPrice(ev.entryPrice)}</b></span>}
            {ev.exitPrice    != null && <span className="act-detail">Exit <b>{fmtPrice(ev.exitPrice)}</b></span>}
            {ev.stopLoss     != null && <span className="act-detail act-detail--sl">SL <b>{fmtPrice(ev.stopLoss)}</b></span>}
            {ev.takeProfit   != null && <span className="act-detail act-detail--tp">TP <b>{fmtPrice(ev.takeProfit)}</b></span>}
            {ev.positionSize != null && <span className="act-detail">Size <b>{ev.positionSize}</b></span>}
            {ev.pnl !== 0 && (
              <span className={`act-detail act-detail--pnl ${pnlClass(ev.pnl)}`}><b>{fmtPnl(ev.pnl)}</b></span>
            )}
            {ev.note != null && <span className="act-detail act-detail--note">{ev.note}</span>}
          </div>
        </div>
      </div>
    );
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="act-root">

      {/* ── 1. Status Bar ────────────────────────────────────────────── */}
      <div className="act-status-bar">
        <div className="act-status-seg">
          <span className="act-status-label">Bot</span>
          <span className={`act-status-value act-bot-status--${botStatus}`}>
            <span className={`act-bot-dot ${botAlive ? 'act-bot-dot--alive' : 'act-bot-dot--idle'}`} />
            {BOT_STATUS_LABEL[botStatus]}
          </span>
        </div>
        <div className="act-status-seg">
          <span className="act-status-label">Connection</span>
          <span className={`act-status-value act-ws-badge act-ws-badge--${wsStatus}`}>
            <span className="act-ws-dot" />
            {wsStatus === 'connected'   ? 'Live'
            : wsStatus === 'mock'       ? 'Mock'
            : wsStatus === 'connecting' ? 'Connecting…'
            : 'Offline'}
          </span>
        </div>
        <div className="act-status-seg act-status-seg--strategy">
          <span className="act-status-label">Strategy</span>
          <span className="act-status-value act-strategy-name">{strategyName}</span>
        </div>
        <div className="act-status-seg act-status-seg--hb">
          <span className="act-status-label">Heartbeat</span>
          <span className="act-status-value act-mono act-hb-ts">
            {heartbeatAt ? heartbeatAt.toLocaleTimeString() : '—'}
          </span>
        </div>
        <div className="act-status-clock">
          <span className="act-clock act-mono">{clockStr}</span>
        </div>
      </div>

      {/* ── 2. Execution Strip ───────────────────────────────────────── */}
      {execStrip ? (
        <div key={execStrip.key}
             className={`act-exec-strip act-exec-strip--${EVENT_CFG[execStrip.type]?.variant ?? 'dim'}`}>
          <span className="act-exec-dot" />
          <span className="act-exec-text">{execStrip.text}</span>
        </div>
      ) : (
        <div className="act-exec-strip act-exec-strip--idle">
          <span className="act-exec-dot" />
          <span className="act-exec-text act-dim">No activity yet — waiting for bot…</span>
        </div>
      )}

      {/* ── 3. Reconnecting banner ───────────────────────────────────── */}
      {wsStatus === 'disconnected' && (
        <div className="act-banner">
          WebSocket disconnected — reconnecting automatically…
        </div>
      )}

      {/* ── 4. Three-column panel grid ───────────────────────────────── */}
      <div className="act-panels">

        {/* ── Left col: Position + Risk ──────────────────────────────── */}
        <div className="act-col">

          <div className="act-card">
            <h3 className="act-card-title">Live Position</h3>

            <div className="act-dir-row">
              <span className={`act-dir-badge act-dir-badge--${position.direction.toLowerCase()}`}>
                {position.direction === 'LONG'  ? '↑ LONG'
                : position.direction === 'SHORT' ? '↓ SHORT'
                : '— FLAT'}
              </span>
              {position.isOpen && <span className="act-open-pill">OPEN</span>}
            </div>

            {/* Hero metrics */}
            {position.isOpen && (
              <div className="act-pos-hero">
                <div className="act-pos-hero-item">
                  <span className="act-pos-hero-label">Entry</span>
                  <span className="act-pos-hero-val act-mono">{fmtPrice(position.entryPrice)}</span>
                </div>
                <div className="act-pos-hero-item">
                  <span className="act-pos-hero-label">Market</span>
                  <span className={`act-pos-hero-val act-mono ${priceColor}`}>
                    {fmtPrice(currentPrice)}
                    {priceDir === 'up' && <span className="act-tick-arrow">▲</span>}
                    {priceDir === 'down' && <span className="act-tick-arrow">▼</span>}
                  </span>
                </div>
                <div className="act-pos-hero-item act-pos-hero-item--pnl">
                  <span className="act-pos-hero-label">Unrealized</span>
                  <span className={`act-pos-hero-pnl act-mono ${pnlClass(unrealizedPnl)}`}>
                    {fmtPnl(unrealizedPnl)}
                  </span>
                </div>
              </div>
            )}

            <div className="act-rows">
              <div className="act-row">
                <span className="act-row-label">Size</span>
                <span className="act-row-value act-mono">
                  {position.positionSize} contract{position.positionSize !== 1 ? 's' : ''}
                </span>
              </div>
              <div className={`act-row${slFlash ? ' act-row--flash-red' : ''}`}>
                <span className="act-row-label">Stop Loss</span>
                <span className="act-row-value act-mono act-sl">{fmtPrice(position.stopLoss)}</span>
              </div>
              <div className={`act-row${tpFlash ? ' act-row--flash-green' : ''}`}>
                <span className="act-row-label">Take Profit</span>
                <span className="act-row-value act-mono act-tp">{fmtPrice(position.takeProfit)}</span>
              </div>
            </div>
          </div>

          <div className="act-card">
            <h3 className="act-card-title">Live Risk</h3>

            <div className="act-rows">
              <div className="act-row">
                <span className="act-row-label">Distance to SL</span>
                <div className="act-row-value-stack">
                  <span className="act-mono act-sl">{risk ? `${risk.slTicks} ticks` : '—'}</span>
                  {risk && <span className="act-row-sub">{fmtDollars(risk.slDollars)} risk</span>}
                </div>
              </div>
              <div className="act-row">
                <span className="act-row-label">Distance to TP</span>
                <div className="act-row-value-stack">
                  <span className="act-mono act-tp">{risk ? `${risk.tpTicks} ticks` : '—'}</span>
                  {risk && <span className="act-row-sub">{fmtDollars(risk.tpDollars)} reward</span>}
                </div>
              </div>
              <div className="act-row">
                <span className="act-row-label">Risk : Reward</span>
                <span className="act-row-value act-mono">
                  {risk ? `1 : ${risk.rr}` : '—'}
                </span>
              </div>
              <div className="act-row">
                <span className="act-row-label">Volatility</span>
                <span className="act-row-value act-dim">— pending</span>
              </div>
              <div className="act-row">
                <span className="act-row-label">ATR</span>
                <span className="act-row-value act-dim">— pending</span>
              </div>
            </div>

            {risk && (
              <div className="act-risk-bar-wrap">
                <div className="act-risk-bar">
                  <div className="act-risk-seg act-risk-seg--sl" style={{ width: `${risk.slPct}%` }} />
                  <div className="act-risk-pin" />
                  <div className="act-risk-seg act-risk-seg--tp" style={{ width: `${risk.tpPct}%` }} />
                </div>
                <div className="act-risk-labels"><span>SL</span><span>Entry</span><span>TP</span></div>
              </div>
            )}
          </div>
        </div>

        {/* ── Center col: PnL + Session Summary ─────────────────────── */}
        <div className="act-col">

          <div className="act-card">
            <h3 className="act-card-title">Live P&L</h3>
            <div className="act-pnl-grid">
              <div className="act-pnl-cell">
                <span className="act-pnl-label">Current Trade</span>
                <span className={`act-pnl-val ${pnlClass(pnl.tradePnl)}`}>{fmtPnl(pnl.tradePnl)}</span>
              </div>
              <div className="act-pnl-cell">
                <span className="act-pnl-label">Session P&L</span>
                <span className={`act-pnl-val ${pnlClass(pnl.sessionPnl)}`}>{fmtPnl(pnl.sessionPnl)}</span>
              </div>
              <div className="act-pnl-cell act-pnl-cell--daily">
                <span className="act-pnl-label">Daily P&L</span>
                <span className={`act-pnl-val act-pnl-val--lg ${pnlClass(pnl.dailyPnl)}`}>{fmtPnl(pnl.dailyPnl)}</span>
              </div>
            </div>
          </div>

          <div className="act-card">
            <h3 className="act-card-title">Session Summary</h3>
            <div className="act-metric-grid">
              <div className="act-metric-cell">
                <span className="act-metric-n">{metrics.tradesCount}</span>
                <span className="act-metric-l">Trades</span>
              </div>
              <div className="act-metric-cell">
                <span className="act-metric-n act-pos">{sessionStats.wins}</span>
                <span className="act-metric-l">Wins</span>
              </div>
              <div className="act-metric-cell">
                <span className="act-metric-n act-neg">{sessionStats.losses}</span>
                <span className="act-metric-l">Losses</span>
              </div>
              <div className="act-metric-cell">
                <span className="act-metric-n act-amber-val">
                  {winRate != null ? `${winRate}%` : '—'}
                </span>
                <span className="act-metric-l">Win Rate</span>
              </div>
            </div>
            <div className="act-rows act-rows--mt">
              <div className="act-row">
                <span className="act-row-label">Largest Win</span>
                <span className={`act-row-value act-mono ${sessionStats.largestWin > 0 ? 'act-pos' : ''}`}>
                  {sessionStats.largestWin > 0 ? fmtPnl(sessionStats.largestWin) : '—'}
                </span>
              </div>
              <div className="act-row">
                <span className="act-row-label">Largest Loss</span>
                <span className={`act-row-value act-mono ${sessionStats.largestLoss < 0 ? 'act-neg' : ''}`}>
                  {sessionStats.largestLoss < 0 ? fmtPnl(sessionStats.largestLoss) : '—'}
                </span>
              </div>
              <div className="act-row">
                <span className="act-row-label">SL Adjustments</span>
                <span className="act-row-value act-mono act-amber-val">{metrics.slAdjustments}</span>
              </div>
              <div className="act-row">
                <span className="act-row-label">TP Adjustments</span>
                <span className="act-row-value act-mono" style={{ color: 'var(--color-blue)' }}>{metrics.tpAdjustments}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right col: Live Price + Bot Health + Ready Check ──────── */}
        <div className="act-col">

          <div className="act-card">
            <h3 className="act-card-title">Live Price  ·  NQ</h3>
            <div className="act-price-display">
              <span className={`act-price-val act-mono ${priceColor}`}>
                {fmtPrice(currentPrice)}
              </span>
              <span className={`act-price-arrow ${priceColor}`}>
                {priceDir === 'up' ? '▲' : priceDir === 'down' ? '▼' : '·'}
              </span>
            </div>
            <div className={`act-sparkline-wrap ${priceColor}`}>
              <Sparkline data={priceHistory} width={200} height={32} />
            </div>
            <div className="act-price-sub">
              <span className="act-dim">NQ Futures  ·  Simulated</span>
            </div>
          </div>

          <div className="act-card">
            <h3 className="act-card-title">Bot Health</h3>
            <div className="act-rows">
              <div className="act-row">
                <span className="act-row-label">WS Latency</span>
                <span className={`act-row-value act-mono ${latencyClass(health.wsLatencyMs)}`}>
                  {health.wsLatencyMs != null ? `${health.wsLatencyMs} ms` : '—'}
                </span>
              </div>
              <div className="act-row">
                <span className="act-row-label">API Latency</span>
                <span className={`act-row-value act-mono ${latencyClass(health.apiLatencyMs)}`}>
                  {health.apiLatencyMs != null ? `${health.apiLatencyMs} ms` : '—'}
                </span>
              </div>
              <div className="act-row">
                <span className="act-row-label">Heartbeat interval</span>
                <span className="act-row-value act-mono">30 s</span>
              </div>
              <div className="act-row">
                <span className="act-row-label">Last update</span>
                <span className={`act-row-value act-mono ${botAlive ? 'act-pos' : 'act-amber-val'}`}>
                  {msAgo(health.lastUpdateMs)}
                </span>
              </div>
            </div>
          </div>

          <div className={`act-card act-ready-card${allReady ? ' act-ready-card--go' : ''}`}>
            <div className="act-ready-header">
              <h3 className="act-card-title">Session Ready Check</h3>
              {allReady && <span className="act-ready-go">✓ READY</span>}
            </div>
            <div className="act-ready-list">
              {readyChecks.map(c => (
                <div key={c.label}
                     className={`act-ready-item${c.ok ? ' act-ready-item--ok' : ' act-ready-item--fail'}`}>
                  <span className="act-ready-icon">{c.ok ? '●' : '○'}</span>
                  <span className="act-ready-label">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── 5. Timeline ──────────────────────────────────────────────── */}
      <div className="act-card act-timeline-card">
        <div className="act-timeline-hdr">
          <h3 className="act-card-title">Live Trade Timeline</h3>
          <span className="act-live-badge">● LIVE</span>
          <span className="act-evt-count">{events.length} event{events.length !== 1 ? 's' : ''}</span>
        </div>

        {events.length === 0 ? (
          <div className="act-empty">
            <span className="act-empty-icon">◎</span>
            <span>Waiting for bot activity…</span>
          </div>
        ) : (
          <div className="act-timeline" ref={timelineRef}>
            {timelineItems}
          </div>
        )}
      </div>

    </section>
  );
}
