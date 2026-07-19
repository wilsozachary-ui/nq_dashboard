/**
 * marketOpenMode.js — Singleton module managing market-hours awareness.
 *
 * Market session: 08:30–15:00 America/Chicago (CST/CDT auto-handled by Intl).
 * All components subscribe via subscribeToMarketOpenMode() or listen to the
 * browser event `nq:market-open-mode` — no React context required.
 *
 * This module is also the ONE shared place that turns "is the futures market
 * open" plus raw feed telemetry into a single `session_state` classification
 * (see computeSessionState() below). SystemHealthPanel and
 * SessionStartChecklist both consume it instead of each re-deriving their own
 * weekend/holiday logic -- two independently-drifting copies of this exact
 * boundary math is what caused the Pre-Flight Checklist to report a stale
 * feed alarm during a routine market closure.
 */

// ── State ─────────────────────────────────────────────────────────────────────
let _active      = false;
let _futuresOpen = true; // corrected on the first _tick() before anything renders
let _timerHandle = null;
const _subscribers = new Set();

// ── Schedule constants ────────────────────────────────────────────────────────
const OPEN_H  = 8;  const OPEN_M  = 30; // 08:30 CST
const CLOSE_H = 15; const CLOSE_M = 0;  // 15:00 CST

const OPEN_MINS  = OPEN_H  * 60 + OPEN_M;
const CLOSE_MINS = CLOSE_H * 60 + CLOSE_M;

// NQ's weekly close: Friday 4:00pm CT through Sunday 5:00pm CT, plus the
// regular Monday-Thursday 4:00-5:00pm CT maintenance halt. Separate
// from the daily OPEN_MINS/CLOSE_MINS window above -- that's this bot's own
// morning-strategy trading window (weekdays only), this is whether the
// underlying futures market is in session at all. Conflating the two
// previously showed "MARKET OPEN" on Saturday afternoon, since the daily
// window's hour check never looked at the day of week.
//
// Kept deliberately in lockstep with the bot's own
// `_market_feed_expected_now()` in app/adapter_api/adapters/engine_bridge.py
// -- same Sun 17:00 / Fri 16:00 / daily 16:00-17:00 boundaries. Exchange
// holidays and shortened sessions are NOT modeled here (neither side of the
// system has a holiday calendar yet); a holiday close will display as a
// stale/awaiting-tick state rather than "Market Closed" until one is added.
const FRI_CLOSE_MINS = 16 * 60;      // Friday 16:00 CT
const SUN_OPEN_MINS  = 17 * 60;      // Sunday 17:00 CT
const DAILY_HALT_START_MINS = 16 * 60;
const DAILY_HALT_END_MINS   = 17 * 60;

// How long after the session reopens (weekly or from the daily maintenance
// halt) a missing tick is treated as an expected startup lag rather than a
// genuine stale-feed failure. Comfortably longer than the backend's own
// FEED_STALE_SECONDS (30s) threshold that flips telemetry's feed.stale flag,
// so a normal post-reopen reconnect doesn't get flagged red before it's had
// a fair chance to receive its first tick.
export const FIRST_TICK_GRACE_SECONDS = 90;

export const SESSION_STATES = {
  OPEN_FRESH: 'open_fresh',
  OPEN_AWAITING_FIRST_TICK: 'open_awaiting_first_tick',
  OPEN_STALE: 'open_stale',
  CLOSED: 'closed',
  UNKNOWN: 'unknown',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function _chicagoNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date());

  const get = type => parts.find(p => p.type === type)?.value;
  const h = Number(get('hour') ?? 0);
  const m = Number(get('minute') ?? 0);
  // Intl reports hour 24 for midnight in some locales/environments instead
  // of 0 -- normalize so minutes-since-midnight math below stays correct.
  const mins = (h % 24) * 60 + m;
  return {
    weekday: get('weekday') ?? 'Mon', // 'Sun'..'Sat'
    year: Number(get('year')),
    month: Number(get('month')),      // 1-12
    day: Number(get('day')),
    mins,
  };
}

function _getCSTParts() {
  const { weekday, mins } = _chicagoNow();
  return { weekday, mins };
}

// Returns the America/Chicago UTC offset (in minutes, e.g. -300 for CDT) in
// effect at the given UTC instant -- i.e. chicago_wall_ms = utc_ms +
// offsetMinutes*60000. Reads the real IANA tzdata via Intl, so this is
// correct across DST transitions without a date library.
function _chicagoOffsetMinutes(utcDate) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(utcDate);
  const get = type => Number(parts.find(p => p.type === type)?.value ?? 0);
  const asUtcMs = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second'),
  );
  return Math.round((asUtcMs - utcDate.getTime()) / 60000);
}

// Constructs a real UTC Date for a given America/Chicago wall-clock moment.
// year/month/day/hour/minute may overflow (e.g. day=32) -- Date.UTC()
// normalizes that, which is how the "next open" helpers below roll forward
// across day/month boundaries without their own calendar arithmetic.
function _chicagoWallToUtc(year, month, day, hour, minute) {
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetMin = _chicagoOffsetMinutes(new Date(guessUtcMs));
  return new Date(guessUtcMs - offsetMin * 60000);
}

function _shouldBeActive() {
  const { mins, weekday } = _getCSTParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return mins >= OPEN_MINS && mins < CLOSE_MINS;
}

function _isFuturesMarketOpen() {
  const { mins, weekday } = _getCSTParts();
  if (weekday === 'Sat') return false;
  if (weekday === 'Fri') return mins < FRI_CLOSE_MINS;
  if (weekday === 'Sun') return mins >= SUN_OPEN_MINS;
  return mins < DAILY_HALT_START_MINS || mins >= DAILY_HALT_END_MINS;
}

// The next moment the regular CME NQ session becomes active, or null if the
// market is open right now. Used to render "Reopening in Xh Ym" and to power
// the live countdown.
function _nextFuturesOpenAt() {
  const c = _chicagoNow();
  if (c.weekday === 'Sat') {
    return _chicagoWallToUtc(c.year, c.month, c.day + 1, 17, 0); // Sunday 17:00 CT
  }
  if (c.weekday === 'Sun' && c.mins < SUN_OPEN_MINS) {
    return _chicagoWallToUtc(c.year, c.month, c.day, 17, 0);
  }
  if (c.weekday === 'Fri' && c.mins >= FRI_CLOSE_MINS) {
    return _chicagoWallToUtc(c.year, c.month, c.day + 2, 17, 0); // Sunday, two days out
  }
  if (c.mins >= DAILY_HALT_START_MINS && c.mins < DAILY_HALT_END_MINS) {
    return _chicagoWallToUtc(c.year, c.month, c.day, 17, 0); // today's maintenance halt ends 17:00
  }
  return null; // market is open right now
}

// When the session currently in progress began (the most recent 17:00 CT
// reopen -- either today's, if we're past it, or yesterday's daily halt
// end otherwise). Every calendar day carries the same 16:00-17:00 CT halt,
// so this single rule covers both the weekly Sunday reopen and every daily
// reopen without a special case. Returns null if the market isn't open.
function _currentSessionOpenedAt() {
  if (!_isFuturesMarketOpen()) return null;
  const c = _chicagoNow();
  if (c.mins >= DAILY_HALT_END_MINS) {
    return _chicagoWallToUtc(c.year, c.month, c.day, 17, 0);
  }
  return _chicagoWallToUtc(c.year, c.month, c.day - 1, 17, 0);
}

function _notify() {
  const detail = { active: _active, timestamp: new Date().toISOString() };
  _subscribers.forEach(cb => { try { cb(detail); } catch {} });
  window.dispatchEvent(new CustomEvent('nq:market-open-mode', { detail }));
}

function _notifyFutures() {
  const detail = { open: _futuresOpen, timestamp: new Date().toISOString() };
  window.dispatchEvent(new CustomEvent('nq:futures-market-mode', { detail }));
}

function _tick() {
  const should = _shouldBeActive();
  if (should !== _active) {
    _active = should;
    _notify();
    marketOpenSound();
  }

  const futuresShould = _isFuturesMarketOpen();
  if (futuresShould !== _futuresOpen) {
    _futuresOpen = futuresShould;
    _notifyFutures();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Current market-open mode state. */
export function isMarketOpenModeActive() { return _active; }

/** Whether NQ futures are in their regular session right now
 * (i.e. outside the weekend close and daily maintenance halt). Distinct
 * from isMarketOpenModeActive(), which is this bot's own narrower daily
 * 08:30-15:00 CT strategy window. Read directly (not just via the
 * 'nq:futures-market-mode' event) so a component can get the correct
 * value on its very first render, before any state-change tick has run. */
export function isFuturesMarketOpenNow() { return _isFuturesMarketOpen(); }

/** The next America/Chicago instant the regular CME NQ session opens, as a
 * Date, or null if the futures market is open right now. */
export function getNextFuturesOpenAt() { return _nextFuturesOpenAt(); }

/**
 * The single shared session-state calculation. Combines the CME schedule
 * (weekly close/reopen + daily maintenance halt) with raw feed telemetry to
 * classify the current session into one of SESSION_STATES, matching the
 * shape both the Market Feed status panel and the Pre-Flight Checklist
 * render from.
 *
 * @param {{ tickAgeMs?: number|null, feedStale?: boolean, telemetryAvailable?: boolean }} input
 *   tickAgeMs/feedStale come straight from /telemetry's `feed.last_tick_age_ms`
 *   / `feed.stale` -- this function does not fetch anything itself.
 */
export function computeSessionState({ tickAgeMs = null, feedStale = false, telemetryAvailable = true } = {}) {
  const now = new Date();
  const feedAgeSeconds = tickAgeMs != null ? Math.round(tickAgeMs / 1000) : null;
  const lastTickAt = tickAgeMs != null ? new Date(now.getTime() - tickAgeMs).toISOString() : null;

  if (!telemetryAvailable) {
    return {
      session_state: SESSION_STATES.UNKNOWN,
      session_label: 'Unknown',
      next_open_at: null,
      seconds_until_open: null,
      last_tick_at: lastTickAt,
      feed_age_seconds: feedAgeSeconds,
      freshness_required: false,
    };
  }

  const open = _isFuturesMarketOpen();

  if (!open) {
    const nextOpenAt = _nextFuturesOpenAt();
    return {
      session_state: SESSION_STATES.CLOSED,
      session_label: 'Market Closed',
      next_open_at: nextOpenAt ? nextOpenAt.toISOString() : null,
      seconds_until_open: nextOpenAt ? Math.max(0, Math.round((nextOpenAt.getTime() - now.getTime()) / 1000)) : null,
      last_tick_at: lastTickAt,
      feed_age_seconds: feedAgeSeconds,
      freshness_required: false,
    };
  }

  const openedAt = _currentSessionOpenedAt();
  const secondsSinceOpen = openedAt ? (now.getTime() - openedAt.getTime()) / 1000 : Infinity;
  const inGrace = secondsSinceOpen < FIRST_TICK_GRACE_SECONDS;
  // A leftover tick from before the last closure/halt must not count as a
  // current-session fresh tick just because feed.stale hasn't caught up yet.
  const tickIsCurrentSession = tickAgeMs != null && openedAt
    ? (now.getTime() - tickAgeMs) >= openedAt.getTime()
    : tickAgeMs != null;
  const hasFreshTick = !feedStale && tickIsCurrentSession;

  const common = {
    next_open_at: null,
    seconds_until_open: null,
    last_tick_at: lastTickAt,
    feed_age_seconds: feedAgeSeconds,
    freshness_required: true,
  };

  if (hasFreshTick) {
    return { session_state: SESSION_STATES.OPEN_FRESH, session_label: 'Fresh', ...common };
  }
  if (inGrace) {
    return { session_state: SESSION_STATES.OPEN_AWAITING_FIRST_TICK, session_label: 'Market Open — Awaiting first tick', ...common };
  }
  return { session_state: SESSION_STATES.OPEN_STALE, session_label: 'Feed Stale', ...common };
}

/** Formats a duration in seconds as "Xh YYm" (e.g. "34h 06m"), or null for
 * a missing/invalid input. Shared so the countdown reads identically
 * wherever it's rendered. */
export function formatHoursMinutes(totalSeconds) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/**
 * Subscribe to mode changes. Returns an unsubscribe function.
 * @param {(detail: { active: boolean, timestamp: string }) => void} callback
 * @returns {() => void}
 */
export function subscribeToMarketOpenMode(callback) {
  _subscribers.add(callback);
  return () => _subscribers.delete(callback);
}

/** Force-activate (e.g. manual override or testing). */
export function activateMarketOpenMode() {
  if (!_active) { _active = true; _notify(); }
}

/** Force-deactivate. */
export function deactivateMarketOpenMode() {
  if (_active) { _active = false; _notify(); }
}

/**
 * Start the schedule timer. Call once from App on mount.
 * Safe to call multiple times — only one timer runs at a time.
 */
export function startMarketScheduler() {
  if (_timerHandle) return;
  _tick();                                       // immediate check on load
  _timerHandle = setInterval(_tick, 10_000);     // re-check every 10 s
}

/** Stop the schedule timer. Call from App on unmount. */
export function stopMarketScheduler() {
  if (_timerHandle) { clearInterval(_timerHandle); _timerHandle = null; }
}

/** Sound hook — audio implementation pending. */
export function marketOpenSound() {
  // Placeholder — wire in a Howler/AudioContext call when audio is ready
}
