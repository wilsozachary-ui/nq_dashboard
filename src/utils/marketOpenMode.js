/**
 * marketOpenMode.js — Singleton module managing market-hours awareness.
 *
 * Market session: 08:30–15:00 America/Chicago (CST/CDT auto-handled by Intl).
 * All components subscribe via subscribeToMarketOpenMode() or listen to the
 * browser event `nq:market-open-mode` — no React context required.
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
const FRI_CLOSE_MINS = 16 * 60;      // Friday 16:00 CT
const SUN_OPEN_MINS  = 17 * 60;      // Sunday 17:00 CT
const DAILY_HALT_START_MINS = 16 * 60;
const DAILY_HALT_END_MINS   = 17 * 60;

// ── Helpers ───────────────────────────────────────────────────────────────────
function _getCSTParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday:  'short',
    hour:     'numeric',
    minute:   'numeric',
    hour12:   false,
  }).formatToParts(new Date());

  const h = Number(parts.find(p => p.type === 'hour')?.value   ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value  ?? 0);
  // Intl reports hour 24 for midnight in some locales/environments instead
  // of 0 -- normalize so minutes-since-midnight math below stays correct.
  const mins = (h % 24) * 60 + m;
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? 'Mon'; // 'Sun'..'Sat'
  return { mins, weekday };
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
