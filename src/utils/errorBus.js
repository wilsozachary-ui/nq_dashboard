/**
 * errorBus.js — Global pub/sub error event system.
 * Components import these three functions to publish errors/warnings/critical alerts.
 * ErrorWarningSystem.js subscribes to 'nq:ews-event' and renders the appropriate UI.
 */

let _seq = 0;
function _id() { return `ews-${Date.now()}-${++_seq}`; }

function _emit(level, type, message, detail = {}) {
  window.dispatchEvent(new CustomEvent('nq:ews-event', {
    detail: { id: _id(), level, type, message, detail, timestamp: Date.now() },
  }));
}

/** Short-lived toast notification (auto-dismiss 4s) */
export function emitError(type, message, detail = {}) {
  _emit('error', type, message, detail);
}

/** Warning — persistent banner until resolved, or toast for minor warnings */
export function emitWarning(type, message, detail = {}) {
  _emit('warning', type, message, detail);
}

/** Critical alert — full modal, requires acknowledgment, freezes cockpit */
export function emitCritical(type, message, detail = {}) {
  _emit('critical', type, message, detail);
}

/** Resolve (close) a persistent warning banner by its type */
export function resolveWarning(type) {
  window.dispatchEvent(new CustomEvent('nq:ews-resolve', { detail: { type } }));
}
