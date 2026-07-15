// Calls back to the SaaS control plane (nq-cloud.com) from this container's
// own origin -- a completely different origin, with no access to the
// nq-cloud.com login cookie. Authenticates with the same short-lived
// per-login session token (see services/sessionToken.js) used for this
// container's own API -- delivered via a URL fragment by
// nq_control_plane's POST /container/launch, never fetched from this
// container itself. Until 2026-07-14 this used a long-lived token handed
// out unauthenticated by /dashboard-config -- see that day's audit,
// Critical #1. /dashboard-config still supplies control_plane_url and the
// admin-instance flag, neither of which is sensitive.

import { getSessionToken } from './sessionToken';
import { readJsonResponse, validateEnvelope } from './apiContract';

let configPromise = null;

function fetchDashboardConfig() {
  if (!configPromise) {
    configPromise = fetch('/dashboard-config')
      .then(res => res.json())
      .catch(() => ({ is_admin_instance: false, control_plane_url: null }));
  }
  return configPromise;
}

export function getDashboardConfig() {
  return fetchDashboardConfig();
}

async function cpRequest(path, init = {}) {
  const config = await fetchDashboardConfig();
  const token = getSessionToken();
  if (!config.control_plane_url || !token) {
    throw new Error('Dashboard is not linked to a control-plane account yet.');
  }
  const response = await fetch(`${config.control_plane_url}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  const label = `${init.method || 'GET'} control-plane ${path}`;
  const envelope = validateEnvelope(await readJsonResponse(response, label), label);
  if (!envelope.ok) {
    const message = envelope?.error?.message || `${init.method || 'GET'} ${path} failed (${response.status})`;
    const err = new Error(message);
    err.code = envelope?.error?.code;
    err.status = response.status;
    throw err;
  }
  return envelope.data;
}

export function cpGet(path) {
  return cpRequest(path, { method: 'GET' });
}

export function cpPost(path, body) {
  return cpRequest(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });
}

export function cpDelete(path) {
  return cpRequest(path, { method: 'DELETE' });
}
