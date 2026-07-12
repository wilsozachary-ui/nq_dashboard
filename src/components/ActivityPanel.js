import { useLayoutEffect, useRef, useState } from 'react';
import useBotData from '../hooks/useBotData';
import './ActivityPanel.css';

// ── Classification for our own bot's trade lifecycle (strategy_event) ────────
// This panel shows ONLY trades this bot placed (Morning Strategy / ORB) --
// never raw market tape (gateway_trade prints from other participants).
const STRATEGY_EVENT_META = {
  dual_entry_armed: { label: 'ENTRIES ARMED',    cls: 'ap-trail' },
  long_entry:   { label: 'ORDER PLACED — LONG',  cls: 'ap-entry' },
  short_entry:  { label: 'ORDER PLACED — SHORT', cls: 'ap-entry' },
  long_exit:    { label: 'POSITION CLOSED',      cls: 'ap-exit'  },
  short_exit:   { label: 'POSITION CLOSED',      cls: 'ap-exit'  },
  manual_exit:  { label: 'MANUAL CLOSE',         cls: 'ap-exit'  },
  sl_hit:       { label: 'STOP LOSS HIT',        cls: 'ap-exit'  },
  tp_hit:       { label: 'TAKE PROFIT HIT',      cls: 'ap-entry' },
  trail_adjust: { label: 'TRAILING STOP MOVED',  cls: 'ap-trail' },
  partial_exit: { label: 'PARTIAL EXIT',         cls: 'ap-exit'  },
};

const ENTRY_TYPES = new Set(['long_entry', 'short_entry']);
const EXIT_TYPES = new Set(['long_exit', 'short_exit', 'manual_exit', 'sl_hit', 'tp_hit']);

function fmtTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function fmtNum(v) {
  return v != null && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '--';
}

function ActivityRow({ item }) {
  const meta = STRATEGY_EVENT_META[item.type] || { label: String(item.type || 'EVENT').toUpperCase(), cls: 'ap-trail' };
  const m = item.meta || {};

  let detail = null;
  if (item.type === 'dual_entry_armed') {
    detail = (
      <span className="ap-detail">
        Buy stop <b>{fmtNum(m.long_stop_price)}</b> · Sell stop <b>{fmtNum(m.short_stop_price)}</b>
      </span>
    );
  } else if (ENTRY_TYPES.has(item.type)) {
    detail = (
      <span className="ap-detail">
        SL <b>{fmtNum(m.sl)}</b> · TP <b>{fmtNum(m.tp)}</b>
        {m.opposite_order_canceled && <span className="ap-detail-sub"> · opposite order canceled</span>}
      </span>
    );
  } else if (EXIT_TYPES.has(item.type)) {
    detail = (
      <span className="ap-detail">
        Entry was <b>{fmtNum(m.entry)}</b>
        {m.opposite_order_canceled && <span className="ap-detail-sub"> · remaining bracket order canceled</span>}
      </span>
    );
  } else if (item.type === 'trail_adjust') {
    detail = (
      <span className="ap-detail">
        was <b>{fmtNum(m.previous_trailing_sl)}</b>
      </span>
    );
  }

  return (
    <div className={`ap-row ${meta.cls}`}>
      <span className="ap-time">{fmtTime(item.timestamp)}</span>
      <span className={`ap-tag ${meta.cls}`}>{meta.label}</span>
      <span className="ap-price">{fmtNum(item.price)}</span>
      {detail}
      {item.pnl != null && (
        <span className={`ap-pnl ${Number(item.pnl) >= 0 ? 'ap-pnl--pos' : 'ap-pnl--neg'}`}>
          {Number(item.pnl) >= 0 ? '+' : ''}{fmtNum(item.pnl)}
        </span>
      )}
    </div>
  );
}

export default function ActivityPanel() {
  const { state, clearActivityEvents } = useBotData({ autoInitialize: true, autoRefresh: false });
  const events = state.activityEvents || [];

  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef(null);
  const autoScrollRef = useRef(true);

  useLayoutEffect(() => {
    if (autoScrollRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events.length]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 10;
    autoScrollRef.current = atBottom;
    setAutoScroll(atBottom);
  };

  return (
    <div className="card ap-panel">
      <div className="ap-header">
        <h3 className="panel-title ap-title">Activity</h3>
        <div className="ap-header-right">
          <span className="ap-count">{events.length} events</span>
          <button className="ap-clear-btn" onClick={clearActivityEvents} aria-label="Clear activity buffer">
            Clear
          </button>
        </div>
      </div>

      <div
        className="ap-feed"
        ref={listRef}
        onScroll={handleScroll}
        aria-label="Bot trade activity feed"
        role="log"
        aria-live="polite"
      >
        {events.length === 0 ? (
          <div className="ap-empty">Awaiting trade activity…</div>
        ) : (
          events.map((item, i) => <ActivityRow key={`${item.timestamp}-${i}`} item={item} />)
        )}
      </div>

      {!autoScroll && events.length > 0 && (
        <button
          className="ap-scroll-btn"
          onClick={() => {
            if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
            autoScrollRef.current = true;
            setAutoScroll(true);
          }}
          aria-label="Jump to latest"
        >
          ▼ Latest
        </button>
      )}
    </div>
  );
}
