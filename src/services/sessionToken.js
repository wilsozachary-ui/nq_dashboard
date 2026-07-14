// Captures the short-lived per-login session token nq_control_plane's
// POST /container/launch delivers via a URL fragment (see session_auth.py
// on the nq_bot side) -- never a query string, since fragments are never
// sent to any server, only readable by this page's own JS after the
// browser lands here. Replaces the old NQ_DASHBOARD_TOKEN-baked-into-the-
// container-forever approach (2026-07-14 audit, Critical #1): this token
// only exists because a real nq-cloud.com login just happened, and expires
// on its own (see nq_control_plane's dashboard_token_ttl_days).
const KEY = 'nq:sessionToken';

export function captureSessionTokenFromUrl() {
  const hash = window.location.hash;
  const match = hash.match(/(?:^#|&)dashboard_token=([^&]+)/);
  if (!match) return;
  try {
    localStorage.setItem(KEY, decodeURIComponent(match[1]));
  } catch {
    // Storage disabled -- nothing else to fall back to; API calls this
    // session will just 401 and the app shows the "not authenticated" gate.
  }
  // Strip the token out of the visible URL/history immediately so it
  // doesn't linger in browser history or get shared via a copied link.
  const stripped = hash.replace(/(?:^#|&)dashboard_token=[^&]*/, '').replace(/^&/, '');
  const url = window.location.pathname + window.location.search + (stripped ? `#${stripped.replace(/^#/, '')}` : '');
  window.history.replaceState(null, '', url);
}

export function getSessionToken() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearSessionToken() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do -- absence of storage access means there's nothing to clear.
  }
}
