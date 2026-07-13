import { useEffect, useState } from 'react';
import { cpGet, cpPost, cpDelete } from '../services/controlPlaneApi';
import './AdminTab.css';

function compactNumber(n) {
  return new Intl.NumberFormat(undefined, { notation: n >= 10000 ? 'compact' : 'standard' }).format(n);
}

function displayName(entry) {
  const name = [entry.first_name, entry.last_name].filter(Boolean).join(' ');
  return name || '—';
}

export default function AdminTab() {
  const [metrics, setMetrics] = useState(null);
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState(null);
  const [rosterError, setRosterError] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    cpGet('/admin/metrics').then(setMetrics).catch(err => setError(err.message));
    cpGet('/admin/users').then(data => setRoster(data.users)).catch(err => setRosterError(err.message));
  }, []);

  async function toggleFreeAccess(entry) {
    const nextValue = !entry.free_access;
    setTogglingId(entry.id);
    setRosterError(null);
    try {
      await cpPost(`/admin/users/${entry.id}/free-access`, { free_access: nextValue });
      setRoster(current => current.map(row => (row.id === entry.id ? { ...row, free_access: nextValue } : row)));
    } catch (err) {
      setRosterError(err.message);
    } finally {
      setTogglingId(null);
    }
  }

  async function deleteUser(entry) {
    setDeletingId(entry.id);
    setRosterError(null);
    try {
      await cpDelete(`/admin/users/${entry.id}`);
      setRoster(current => current.filter(row => row.id !== entry.id));
    } catch (err) {
      setRosterError(err.message);
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  }

  if (error) {
    return (
      <div className="tab-single-col adm-tab">
        <div className="card"><p className="set-error">{error}</p></div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="tab-single-col adm-tab">
        <div className="card"><p className="panel-placeholder">Loading…</p></div>
      </div>
    );
  }

  const containersUnhealthy = metrics.containers_total - metrics.containers_healthy;

  return (
    <div className="tab-single-col adm-tab">
      <div className="card adm-card">
        <div className="panel-title">Monthly recurring revenue</div>
        <p className="adm-hero">
          ${compactNumber(metrics.mrr_usd)}
          <span className="adm-hero-unit">/mo</span>
        </p>
        <p className="panel-placeholder">{metrics.active_subscriptions} active subscription(s)</p>
      </div>

      <div className="adm-grid">
        <div className="card adm-tile">
          <p className="adm-tile-label">Total customers</p>
          <p className="adm-tile-value">{compactNumber(metrics.total_customers)}</p>
        </div>
        <div className="card adm-tile">
          <p className="adm-tile-label">Signups, last 30 days</p>
          <p className="adm-tile-value">{compactNumber(metrics.signups_last_30d)}</p>
        </div>
        <div className="card adm-tile">
          <p className="adm-tile-label">Churned, last 30 days</p>
          <p className="adm-tile-value">{compactNumber(metrics.churned_last_30d)}</p>
        </div>
        <div className="card adm-tile">
          <p className="adm-tile-label">Churn rate, last 30 days</p>
          <p className="adm-tile-value">{(metrics.churn_rate * 100).toFixed(1)}%</p>
        </div>
      </div>

      <div className="card adm-card">
        <div className="adm-card-header">
          <div className="panel-title">Bot containers</div>
          {metrics.containers_total === 0 ? (
            <span className="adm-badge">None deployed</span>
          ) : containersUnhealthy === 0 ? (
            <span className="adm-badge adm-badge-green">All healthy</span>
          ) : (
            <span className="adm-badge adm-badge-amber">{containersUnhealthy} unhealthy</span>
          )}
        </div>
        <p className="panel-placeholder">
          {metrics.containers_healthy} of {metrics.containers_total} deployed container(s) reporting healthy.
        </p>
      </div>

      <div className="card adm-card adm-card--roster">
        <div className="panel-title">Signups</div>
        {rosterError && <p className="set-error">{rosterError}</p>}
        {!roster && !rosterError && <p className="panel-placeholder">Loading…</p>}
        {roster && roster.length === 0 && <p className="panel-placeholder">No signups yet.</p>}
        {roster && roster.length > 0 && (
          <div className="adm-roster-scroll">
            <table className="adm-roster">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Subscription</th>
                  <th>Free access</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {roster.map(entry => (
                  <tr key={entry.id}>
                    <td>
                      {displayName(entry)}
                      <span
                        className={`adm-disclaimer-dot ${entry.disclaimer_signed ? 'adm-disclaimer-dot--signed' : ''}`}
                        title={entry.disclaimer_signed ? 'Disclaimer signed' : 'Disclaimer not yet signed'}
                        aria-label={entry.disclaimer_signed ? 'Disclaimer signed' : 'Disclaimer not yet signed'}
                      >
                        {entry.disclaimer_signed ? '✓' : '—'}
                      </span>
                    </td>
                    <td className="adm-roster-email">{entry.email}</td>
                    <td>
                      {entry.free_access ? (
                        <span className="adm-badge adm-badge-green">Family</span>
                      ) : entry.subscription_active ? (
                        <span className="adm-badge adm-badge-green">Active</span>
                      ) : (
                        <span className="adm-badge">Inactive</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`adm-toggle ${entry.free_access ? 'adm-toggle--on' : ''}`}
                        role="switch"
                        aria-checked={entry.free_access}
                        aria-label={`Free access for ${entry.email}`}
                        disabled={togglingId === entry.id}
                        onClick={() => toggleFreeAccess(entry)}
                      >
                        <span className="adm-toggle-knob" />
                      </button>
                    </td>
                    <td className="adm-roster-delete-cell">
                      {confirmingId === entry.id ? (
                        <span className="adm-confirm-row">
                          <span className="adm-confirm-label">Delete?</span>
                          <button
                            type="button"
                            className="adm-confirm-btn adm-confirm-btn--yes"
                            disabled={deletingId === entry.id}
                            onClick={() => deleteUser(entry)}
                          >
                            {deletingId === entry.id ? '…' : 'Yes'}
                          </button>
                          <button
                            type="button"
                            className="adm-confirm-btn"
                            disabled={deletingId === entry.id}
                            onClick={() => setConfirmingId(null)}
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="adm-delete-btn"
                          aria-label={`Delete account for ${entry.email}`}
                          onClick={() => setConfirmingId(entry.id)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
