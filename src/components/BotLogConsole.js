import {
  useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, memo,
} from 'react';
import useWebSocket from '../hooks/useWebSocket';
import './BotLogConsole.css';

// ── Consolidated real log/activity console ───────────────────────────────────
//
// Replaces the previous BotLogConsole + SessionRecorder split. Real data
// only, from two confirmed-working sources:
//   1. useWebSocket({ autoConnect: true }) -- the same raw multiplexed /ws
//      connection LiveTicker.js already uses successfully. Backend log/
//      trade_log/orb_log broadcasts arrive as { type: 'activity', log: {...} }
//      (see services/websocket.js's topic normalization) -- the previous
//      version listened for a browser event named 'cockpit:ws:logs' that
//      nothing in the app ever dispatches, so it never received anything.
//   2. nq:strategy-event / nq:session-status -- already-real browser events
//      confirmed working elsewhere this session.
//
// The backend's structured `level` field is currently always "INFO"
// regardless of actual severity (log_to_dashboard's callback only ever
// receives a flattened string, see app/logging_manager.py) -- the real
// level is still recoverable as text at the front of that string
// ("[14:32:01] WARNING ..."), so severity is parsed from there instead of
// trusting the always-"INFO" structured field.

const LOG_BUFFER = 500;
const SOURCES = ['system', 'trade', 'strategy', 'checklist'];
const DEFAULT_SOURCES = Object.fromEntries(SOURCES.map(source => [source, true]));
const LEVEL_PATTERN = /^\[\d{2}:\d{2}:\d{2}\]\s+(\w+)\s+/;

function parseSeverity(message, fallbackLevel) {
  const match = LEVEL_PATTERN.exec(message || '');
  const word = (match ? match[1] : fallbackLevel || 'INFO').toUpperCase();
  if (word === 'ERROR' || word === 'CRITICAL') return 'error';
  if (word === 'WARNING' || word === 'WARN') return 'warn';
  if (word === 'TRADE') return 'trade';
  if (word === 'DEBUG') return 'debug';
  return 'info';
}

// ── JSON syntax highlighter (safe — input is backend-generated) ───────────────
function highlightJson(obj) {
  const esc = JSON.stringify(obj, null, 2)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/"([^"\\]+)"(\s*:)/g,  '<span class="blc-k">"$1"</span>$2')
    .replace(/"([^"\\]*)"(?!\s*:)/g,'<span class="blc-s">"$1"</span>')
    .replace(/((?:[:,]|\[)\s*)(-?\d+\.?\d*)/g, '$1<span class="blc-n">$2</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="blc-b">$1</span>');
}

function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString('en-US', { hour12: false }); }
  catch { return '--:--:--'; }
}

let _seq = 0;
const genId = () => `log-${Date.now()}-${++_seq}`;

const LogEntry = memo(function LogEntry({ log, expanded, onToggle }) {
  return (
    <div className={`blc-entry blc-entry--${log.severity}`}>
      <div className="blc-entry-line">
        <span className="blc-time">[{fmtTime(log.timestamp)}]</span>
        <span className={`blc-sev blc-sev--${log.severity}`}>[{log.severity.toUpperCase().padEnd(5)}]</span>
        <span className="blc-msg">{log.message}</span>
        {log.context && (
          <button
            className="blc-expand-btn"
            onClick={() => onToggle(log.id)}
            aria-expanded={expanded}
          >
            {expanded ? '▾' : '▸'} Details
          </button>
        )}
      </div>
      {expanded && log.context && (
        <div className="blc-details">
          <pre className="blc-json" dangerouslySetInnerHTML={{ __html: highlightJson(log.context) }} />
        </div>
      )}
    </div>
  );
});

export default function BotLogConsole() {
  const [rawLogs,       setRawLogs]       = useState([]);
  const [showInfo,      setShowInfo]      = useState(true);
  const [showDebug,     setShowDebug]     = useState(false);
  const [sourceFilters, setSourceFilters] = useState(DEFAULT_SOURCES);
  const [search,        setSearch]        = useState('');
  const [autoScroll,    setAutoScroll]    = useState(true);
  const [expandedIds,   setExpandedIds]   = useState(new Set());
  const [collapsed,     setCollapsed]     = useState(false);

  const windowRef   = useRef(null);
  const suppressRef = useRef(false);
  const incomingRef = useRef([]);

  const { status: wsStatus, lastMessage } = useWebSocket({ autoConnect: true });

  const appendLog = useCallback((raw) => {
    incomingRef.current.push({
      id:        genId(),
      timestamp: raw.timestamp ?? new Date().toISOString(),
      severity:  raw.severity  ?? 'info',
      message:   String(raw.message ?? ''),
      context:   raw.context   ?? null,
      source:    SOURCES.includes(raw.source) ? raw.source : 'system',
    });
  }, []);

  // Bound React updates during bursty feeds.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!incomingRef.current.length) return;
      const batch = incomingRef.current.splice(0, 20);
      setRawLogs(prev => [...prev, ...batch].slice(-LOG_BUFFER));
    }, 250);
    return () => clearInterval(timer);
  }, []);

  // ── Real system/trade log broadcasts, via the raw /ws connection ─────────
  useEffect(() => {
    if (!lastMessage || lastMessage.type !== 'activity' || !lastMessage.log) return;
    const log = lastMessage.log;
    const message = String(log.message ?? '');
    appendLog({
      timestamp: lastMessage.timestamp,
      severity:  parseSeverity(message, log.level),
      source:    log.channel === 'trade' ? 'trade' : 'system',
      message,
    });
  }, [lastMessage, appendLog]);

  // ── Real strategy lifecycle events (long_entry, sl_hit, trail_adjust, ...) ─
  useEffect(() => {
    const handler = e => {
      const d = e.detail || {};
      appendLog({
        timestamp: d.timestamp ?? new Date().toISOString(),
        severity:  'info',
        source:    'strategy',
        message:   `[${d.strategy || 'strategy'}] ${d.type || d.message || d.note || 'event'}`,
        context:   d.meta || null,
      });
    };
    window.addEventListener('nq:strategy-event', handler);
    return () => window.removeEventListener('nq:strategy-event', handler);
  }, [appendLog]);

  // ── Real Pre-Flight checklist result ──────────────────────────────────────
  useEffect(() => {
    const handler = e => {
      const { status } = e.detail;
      appendLog({
        timestamp: new Date().toISOString(),
        severity:  status === 'fail' ? 'error' : status === 'warn' ? 'warn' : 'info',
        source:    'checklist',
        message:   `Pre-Flight checklist completed — result: ${status.toUpperCase()}`,
      });
    };
    window.addEventListener('nq:session-status', handler);
    return () => window.removeEventListener('nq:session-status', handler);
  }, [appendLog]);

  // ── Filtered view ─────────────────────────────────────────────────────────
  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawLogs.filter(l => {
      if (!sourceFilters[l.source]) return false;
      if (l.severity === 'info' && !showInfo) return false;
      if (l.severity === 'debug' && !showDebug) return false;
      if (q && !l.message.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rawLogs, showInfo, showDebug, sourceFilters, search]);

  // ── Auto-scroll after DOM paint ───────────────────────────────────────────
  useLayoutEffect(() => {
    if (!autoScroll || !windowRef.current) return;
    suppressRef.current = true;
    windowRef.current.scrollTop = windowRef.current.scrollHeight;
    setTimeout(() => { suppressRef.current = false; }, 50);
  }, [filteredLogs.length, autoScroll]);

  const handleScroll = useCallback((e) => {
    if (suppressRef.current) return;
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
    if (!atBottom) setAutoScroll(false);
  }, []);

  const toggleSource = useCallback(source =>
    setSourceFilters(previous => ({ ...previous, [source]: !previous[source] })), []);

  const toggleExpand = useCallback(id =>
    setExpandedIds(p => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    }), []);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(rawLogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nq-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rawLogs]);

  const counts = useMemo(() => {
    const c = { debug: 0, info: 0, warn: 0, error: 0, trade: 0 };
    rawLogs.forEach(l => { if (l.severity in c) c[l.severity]++; });
    return c;
  }, [rawLogs]);

  return (
    <div className={`card blc-panel${collapsed ? ' blc-panel--collapsed' : ''}`}>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="blc-header">
        <div className="blc-header-left">
          <span className="blc-icon" aria-hidden="true">⌨</span>
          <h3 className="panel-title blc-title">Activity Log</h3>
        </div>
        <div className="blc-header-right">
          <span className={`blc-ws blc-ws--${wsStatus}`}>
            <span className="blc-ws-dot" />
            {wsStatus === 'connected' ? 'Connected' : 'Connecting…'}
          </span>
          <span className="blc-buf-count">{rawLogs.length}/{LOG_BUFFER}</span>
          <button className="blc-btn" onClick={handleExport} disabled={rawLogs.length === 0}>
            Export
          </button>
          <button
            className="blc-btn blc-btn--clear"
            onClick={() => { incomingRef.current = []; setRawLogs([]); setExpandedIds(new Set()); }}
          >Clear</button>
          <button
            className="blc-btn blc-btn--collapse"
            onClick={() => setCollapsed(c => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand console' : 'Collapse console'}
          >{collapsed ? '▲' : '▼'}</button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* ── Filter bar ────────────────────────────────────────────── */}
          <div className="blc-filterbar">
            <div className="blc-filters" role="group" aria-label="Log filters">
              <button className={`blc-flt blc-flt--info${showInfo ? ' blc-flt--on' : ''}`} onClick={() => setShowInfo(v => !v)} aria-pressed={showInfo}>INFO <span className="blc-flt-n">{counts.info}</span></button>
              <button className={`blc-flt blc-flt--debug${showDebug ? ' blc-flt--on' : ''}`} onClick={() => setShowDebug(v => !v)} aria-pressed={showDebug}>DEBUG <span className="blc-flt-n">{counts.debug}</span></button>
              {SOURCES.map(source => (
                <label key={source} className={`blc-source${sourceFilters[source] ? ' blc-source--on' : ''}`}>
                  <input type="checkbox" checked={sourceFilters[source]} onChange={() => toggleSource(source)} />
                  {source[0].toUpperCase() + source.slice(1)}
                </label>
              ))}
            </div>

            <div className="blc-search-wrap">
              <span className="blc-search-icon" aria-hidden="true">⌕</span>
              <input
                className="blc-search"
                type="text"
                placeholder="Filter by keyword…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                spellCheck="false"
                aria-label="Search log messages"
              />
              {search && (
                <button className="blc-search-x" onClick={() => setSearch('')} aria-label="Clear search">✕</button>
              )}
            </div>
          </div>

          {/* ── Log window ────────────────────────────────────────────── */}
          <div
            ref={windowRef}
            className="blc-window"
            onScroll={handleScroll}
            role="log"
            aria-live="off"
            aria-label="Log stream"
          >
            {filteredLogs.length === 0 ? (
              <div className="blc-empty">
                {rawLogs.length === 0
                  ? <><span className="blc-empty-icon">⌨</span><span>Waiting for log activity…</span></>
                  : <><span className="blc-empty-icon">⌕</span><span>No entries match current filters</span></>
                }
              </div>
            ) : (
              filteredLogs.map(log => (
                <LogEntry
                  key={log.id}
                  log={log}
                  expanded={expandedIds.has(log.id)}
                  onToggle={toggleExpand}
                />
              ))
            )}
          </div>

          {/* ── Footer ────────────────────────────────────────────────── */}
          <div className="blc-footer">
            <span className="blc-footer-count">
              Showing {filteredLogs.length} of {rawLogs.length} entries
            </span>
            {!autoScroll && (
              <button
                className="blc-scroll-btn"
                onClick={() => {
                  setAutoScroll(true);
                  suppressRef.current = true;
                  if (windowRef.current) windowRef.current.scrollTop = windowRef.current.scrollHeight;
                  setTimeout(() => { suppressRef.current = false; }, 50);
                }}
              >↓ Jump to latest</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
