// Calls back to the SaaS control plane (nq-cloud.com) from this container's
// own origin -- a completely different origin, with no access to the
// nq-cloud.com login cookie. Authenticates instead with a dedicated
// long-lived bearer token baked into this container at provision time (see
// nq_control_plane's provisioning/service.py + auth/dependencies.py's
// Bearer-token support), fetched once from /dashboard-config alongside the
// admin-instance flag.

let configPromise = null;

function fetchDashboardConfig() {
  if (!configPromise) {
    configPromise = fetch('/dashboard-config')
      .then(res => res.json())
      .catch(() => ({ is_admin_instance: false, control_plane_url: null, dashboard_token: null }));
  }
  return configPromise;
}

export function getDashboardConfig() {
  return fetchDashboardConfig();
}

async function cpRequest(path, init = {}) {
  const config = await fetchDashboardConfig();
  if (!config.control_plane_url || !config.dashboard_token) {
    throw new Error('Dashboard is not linked to a control-plane account yet.');
  }
  const response = await fetch(`${config.control_plane_url}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.dashboard_token}`,
      ...init.headers,
    },
  });
  const envelope = await response.json().catch(() => ({}));
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
