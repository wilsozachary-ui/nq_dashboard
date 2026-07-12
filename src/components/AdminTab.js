import { useEffect, useState } from 'react';
import { cpGet } from '../services/controlPlaneApi';
import './AdminTab.css';

function compactNumber(n) {
  return new Intl.NumberFormat(undefined, { notation: n >= 10000 ? 'compact' : 'standard' }).format(n);
}

export default function AdminTab() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    cpGet('/admin/metrics').then(setMetrics).catch(err => setError(err.message));
  }, []);

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
    </div>
  );
}
