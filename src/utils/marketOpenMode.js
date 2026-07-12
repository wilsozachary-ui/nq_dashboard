/**
 * marketOpenMode.js — Singleton module managing market-hours awareness.
 *
 * Market session: 08:30–15:00 America/Chicago (CST/CDT auto-handled by Intl).
 * All components subscribe via subscribeToMarketOpenMode() or listen to the
 * browser event `nq:market-open-mode` — no React context required.
 */

// ── State ─────────────────────────────────────────────────────────────────────
let _active      = false;
let _timerHandle = null;
const _subscribers = new Set();

// ── Schedule constants ────────────────────────────────────────────────────────
const OPEN_H  = 8;  const OPEN_M  = 30; // 08:30 CST
const CLOSE_H = 15; const CLOSE_M = 0;  // 15:00 CST

const OPEN_MINS  = OPEN_H  * 60 + OPEN_M;
const CLOSE_MINS = CLOSE_H * 60 + CLOSE_M;

// ── Helpers ───────────────────────────────────────────────────────────────────
function _getCSTMinutes() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour:     'numeric',
    minute:   'numeric',
    hour12:   false,
  }).formatToParts(new Date());

  const h = Number(parts.find(p => p.type === 'hour')?.value   ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value  ?? 0);
  return h * 60 + m;
}

function _shouldBeActive() {
  const mins = _getCSTMinutes();
  return mins >= OPEN_MINS && mins < CLOSE_MINS;
}

function _notify() {
  const detail = { active: _active, timestamp: new Date().toISOString() };
  _subscribers.forEach(cb => { try { cb(detail); } catch {} });
  window.dispatchEvent(new CustomEvent('nq:market-open-mode', { detail }));
}

function _tick() {
  const should = _shouldBeActive();
  if (should !== _active) {
    _active = should;
    _notify();
    marketOpenSound();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Current market-open mode state. */
export function isMarketOpenModeActive() { return _active; }

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
