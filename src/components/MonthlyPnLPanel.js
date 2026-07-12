import { useState, useEffect } from 'react';
import { getMonthlyPnL } from '../api/pnlApi';
import { SkeletonCalendar } from './Skeleton';
import './MonthlyPnLPanel.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Pure calendar helpers (no side effects) ───────────────────────────────────

/**
 * Build a padded flat calendar array from raw API rows.
 *
 * Length is always a multiple of 7.  Each slot is:
 *   null                        — padding outside the current month
 *   { date, pnl, trades }       — one calendar day; pnl/trades=0 when no trades
 *
 * Multiple rows with the same date are aggregated (handles "overall" which
 * may return both morning_strategy and orb entries on the same day, and
 * multiple accounts when no account filter is applied).
 */
function buildCalendarGrid(currentMonth, data) {
  const year  = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const firstDow    = (new Date(year, month, 1).getDay() + 6) % 7; // Mon = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDate = {};
  data.forEach(t => {
    if (!byDate[t.date]) byDate[t.date] = { pnl: 0, trades: 0 };
    byDate[t.date].pnl    += t.pnl;
    byDate[t.date].trades += t.trades;
  });

  const days     = [];
  const monthStr = String(month + 1).padStart(2, '0');

  for (let i = 0; i < firstDow; i++) days.push(null);

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
    const entry   = byDate[dateStr];
    days.push({ date: dateStr, pnl: entry?.pnl ?? 0, trades: entry?.trades ?? 0 });
  }

  while (days.length % 7 !== 0) days.push(null);

  return days;
}

function chunkIntoWeeks(flatDays) {
  const weeks = [];
  for (let i = 0; i < flatDays.length; i += 7) {
    weeks.push(flatDays.slice(i, i + 7));
  }
  return weeks;
}

function buildWeeklySummaries(flatDays) {
  const summaries = [];
  for (let i = 0; i < flatDays.length; i += 7) {
    const week   = flatDays.slice(i, i + 7);
    const pnl    = week.reduce((s, d) => s + (d?.pnl    ?? 0), 0);
    const trades = week.reduce((s, d) => s + (d?.trades ?? 0), 0);
    summaries.push({ weekIndex: summaries.length + 1, pnl, trades });
  }
  return summaries;
}

// ── Formatting utilities ──────────────────────────────────────────────────────

function fmt(val) {
  if (val === 0) return '$0.00';
  return `${val > 0 ? '+' : '-'}$${Math.abs(val).toFixed(2)}`;
}

function pnlClass(val) {
  if (val > 0) return 'value-positive';
  if (val < 0) return 'value-negative';
  return 'mpnl-neutral';
}

// ── Component ─────────────────────────────────────────────────────────────────
//
// Historical recap panel: REST-fetch-on-filter-change is still the primary
// load path (month/strategy/account changes), but it also patches in the
// day's real numbers the moment a trade closes, via the existing
// nq:integrated-pnl broadcast the backend already sends after every close.
// No polling, no extra REST calls -- see the listener effect below.

export default function MonthlyPnLPanel({
  strategy: controlledStrategy, accountId, selectedDate, onSelectDate,
} = {}) {
  const today = new Date();

  // ── Navigation / filter state ──────────────────────────────────────────────
  const [currentMonth,     setCurrentMonth]     = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  // When a parent (TradeRecapTab) supplies `strategy`, it owns the filter and
  // this component's own dropdown is hidden -- avoids two conflicting
  // strategy pickers on the same page.
  const [selectedStrategy, setSelectedStrategy] = useState(controlledStrategy ?? 'overall');
  const [selectedWeek,     setSelectedWeek]     = useState(0);

  useEffect(() => {
    if (controlledStrategy != null) setSelectedStrategy(controlledStrategy);
  }, [controlledStrategy]);

  // ── Fetch state ────────────────────────────────────────────────────────────
  const [rawData,  setRawData]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [retryKey, setRetryKey] = useState(0);

  // ── Computed display state ─────────────────────────────────────────────────
  const [calendarWeeks,   setCalendarWeeks]   = useState([]);
  const [weeklySummaries, setWeeklySummaries] = useState([]);
  const [monthlyTotal,    setMonthlyTotal]    = useState(0);

  // ── Animation state ────────────────────────────────────────────────────────
  const [fadeClass, setFadeClass] = useState('mpnl-fade-in');

  // ── Fade animation ─────────────────────────────────────────────────────────
  function triggerFadeAnimation() {
    setFadeClass('mpnl-fade-out');
    setTimeout(() => setFadeClass('mpnl-fade-in'), 150);
  }

  // ── Unified recompute effect ───────────────────────────────────────────────
  // Runs after every rawData change (i.e. after each REST fetch completes).
  // Using rawData-only deps is intentional: currentMonth is captured by closure
  // at effect-run time, which is always the latest value after React batches.
  useEffect(() => {
    const flatDays = buildCalendarGrid(currentMonth, rawData);
    setCalendarWeeks(chunkIntoWeeks(flatDays));
    setWeeklySummaries(buildWeeklySummaries(flatDays));
    setMonthlyTotal(rawData.reduce((s, t) => s + t.pnl, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawData]);

  // ── Data fetching ──────────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    const month = currentMonth.getMonth() + 1;
    const year  = currentMonth.getFullYear();

    setLoading(true);
    setError(null);

    getMonthlyPnL(month, year, selectedStrategy, accountId, controller.signal)
      .then(rows => {
        if (controller.signal.aborted) return;
        const data = (Array.isArray(rows) ? rows : []).map(r => ({
          date: r.date,
          pnl: Number(r.net ?? 0),
          trades: Number(r.trades ?? 0),
          strategy: r.strategy || 'orb',
        }));
        setRawData(data);
        triggerFadeAnimation();
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        setError(err.message || 'Failed to load data. Check your connection.');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, selectedStrategy, accountId, retryKey]);

  // ── Live patch-in on trade close ───────────────────────────────────────────
  // Upserts just the affected day rather than re-fetching the whole month --
  // matched by date *and* strategy so a live update for one strategy never
  // clobbers another strategy's row for the same day under "Overall".
  useEffect(() => {
    function handlePnlUpdate(event) {
      const payload = event.detail;
      if (!payload || payload.type !== 'pnl_monthly' || !payload.date) return;

      const [y, m] = payload.date.split('-').map(Number);
      if (y !== currentMonth.getFullYear() || m !== currentMonth.getMonth() + 1) return;
      if (selectedStrategy !== 'overall' && payload.strategy !== selectedStrategy) return;
      if (accountId != null && String(payload.account_id) !== String(accountId)) return;

      const nextRow = {
        date: payload.date,
        pnl: Number(payload.net ?? 0),
        trades: Number(payload.trades ?? 0),
        strategy: payload.strategy || 'orb',
      };
      setRawData(prev => {
        const idx = prev.findIndex(r => r.date === nextRow.date && r.strategy === nextRow.strategy);
        if (idx === -1) return [...prev, nextRow];
        const next = [...prev];
        next[idx] = nextRow;
        return next;
      });
      triggerFadeAnimation();
    }
    window.addEventListener('nq:integrated-pnl', handlePnlUpdate);
    return () => window.removeEventListener('nq:integrated-pnl', handlePnlUpdate);
  }, [currentMonth, selectedStrategy, accountId]);

  const handleRetry = () => setRetryKey(k => k + 1);

  // ── Month navigation ───────────────────────────────────────────────────────
  // Clears the selected day too -- a date from the previous month is no
  // longer visible on this calendar, so a sibling panel driven by
  // selectedDate must not keep querying a day the user can't even see.
  const goToPreviousMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    setSelectedWeek(0);
    onSelectDate?.(null);
  };

  const goToNextMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    setSelectedWeek(0);
    onSelectDate?.(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const year  = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const sel   = weeklySummaries[selectedWeek] ?? { weekIndex: selectedWeek + 1, pnl: 0, trades: 0 };

  return (
    <div className="card mpnl-panel">

      {/* ── Header: navigation + monthly total ── */}
      <div className="mpnl-header">
        <div className="mpnl-nav">
          <button
            className="mpnl-nav-btn"
            onClick={goToPreviousMonth}
            disabled={loading}
            aria-label="Previous month"
          >
            &#8249;
          </button>
          <span className="mpnl-month-label">{MONTH_NAMES[month]} {year}</span>
          <button
            className="mpnl-nav-btn"
            onClick={goToNextMonth}
            disabled={loading}
            aria-label="Next month"
          >
            &#8250;
          </button>
        </div>

        <div className={`mpnl-monthly-total ${pnlClass(monthlyTotal)}`}>
          {loading
            ? <span className="mpnl-total-placeholder">Monthly P/L: —</span>
            : <>Monthly P/L:&nbsp;{fmt(monthlyTotal)}</>
          }
        </div>
      </div>

      {/* ── Strategy filter ── */}
      {controlledStrategy == null && (
        <div className="mpnl-filter-row">
          <select
            className="mpnl-filter-select"
            value={selectedStrategy}
            onChange={e => setSelectedStrategy(e.target.value)}
            disabled={loading}
          >
            <option value="overall">Overall P&amp;L</option>
            <option value="morning_strategy">Morning Strategy</option>
            <option value="orb">ORB</option>
          </select>
        </div>
      )}

      {/* ── Inline status bar: loading or error ── */}
      {loading && (
        <div className="mpnl-status-bar mpnl-status-bar--loading" role="status">
          <span className="mpnl-spinner" aria-hidden="true" />
          <span className="mpnl-status-text">Loading…</span>
        </div>
      )}
      {error && !loading && (
        <div className="mpnl-status-bar mpnl-status-bar--error" role="alert">
          <span className="mpnl-status-text">&#9888; {error}</span>
          <button className="mpnl-retry-btn" onClick={handleRetry}>Retry</button>
        </div>
      )}

      {/* ── Calendar body: fades in after each data load ── */}
      <div className={`mpnl-body ${fadeClass}`}>

        {/* Skeleton calendar on first load (before any data has arrived) */}
        {loading && calendarWeeks.length === 0 && (
          <div className="mpnl-skeleton-wrapper">
            <SkeletonCalendar weeks={5} />
          </div>
        )}

        <div className={`mpnl-grid-wrapper${loading && calendarWeeks.length > 0 ? ' mpnl-grid--busy' : ''}${loading && calendarWeeks.length === 0 ? ' mpnl-sr-only' : ''}`}>

          {/* Day-of-week headers */}
          <div className="mpnl-grid-header">
            {DAY_HEADERS.map(d => (
              <div key={d} className="mpnl-col-header">{d}</div>
            ))}
            <div className="mpnl-col-header mpnl-col-header--week">Week</div>
          </div>

          {/* One row per calendar week */}
          {calendarWeeks.map((week, wi) => {
            const summary = weeklySummaries[wi] ?? { weekIndex: wi + 1, pnl: 0, trades: 0 };

            return (
              <div
                key={wi}
                className={`mpnl-week-row${selectedWeek === wi ? ' mpnl-week-row--selected' : ''}`}
                onClick={() => !loading && setSelectedWeek(wi)}
              >
                {/* 7 day cells */}
                {week.map((day, di) => {
                  const hasTrades = day !== null && day.trades > 0;
                  const tileClass = hasTrades
                    ? (day.pnl >= 0 ? 'mpnl-tile mpnl-tile--profit' : 'mpnl-tile mpnl-tile--loss')
                    : 'mpnl-tile';
                  const dayNum = day ? parseInt(day.date.slice(8), 10) : null;
                  const isSelected = day !== null && selectedDate === day.date;

                  return (
                    <div
                      key={di}
                      className={`mpnl-day-cell${day === null ? ' mpnl-day-cell--empty' : ''}${isSelected ? ' mpnl-day-cell--selected' : ''}`}
                      onClick={e => {
                        if (day === null || loading) return;
                        e.stopPropagation();
                        setSelectedWeek(wi);
                        onSelectDate?.(day.date === selectedDate ? null : day.date);
                      }}
                    >
                      {day !== null && (
                        <div className={tileClass}>
                          <span className="mpnl-day-num">{dayNum}</span>
                          {hasTrades && (
                            <>
                              <span className="mpnl-tile-pnl">{fmt(day.pnl)}</span>
                              <span className="mpnl-tile-trades">
                                {day.trades} trade{day.trades !== 1 ? 's' : ''}
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Weekly sidebar */}
                <div className="mpnl-week-cell">
                  <span className="mpnl-week-num">Week {summary.weekIndex}</span>
                  <span className={`mpnl-week-pnl ${pnlClass(summary.pnl)}`}>
                    {fmt(summary.pnl)}
                  </span>
                  <span className="mpnl-week-trade-ct">
                    {summary.trades} trade{summary.trades !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            );
          })}

        </div>
      </div>

      {/* ── Bottom bar: selected-week summary ── */}
      <div className="mpnl-bottom-bar">
        <span className="mpnl-bottom-label">Week {sel.weekIndex}:</span>
        <span className={`mpnl-bottom-pnl ${pnlClass(sel.pnl)}`}>{fmt(sel.pnl)}</span>
        <span className="mpnl-bottom-trades">
          {sel.trades} trade{sel.trades !== 1 ? 's' : ''}
        </span>
      </div>

    </div>
  );
}
