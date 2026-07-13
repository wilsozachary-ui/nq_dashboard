import { useEffect, useState } from 'react';
import { cpGet, cpPost } from '../services/controlPlaneApi';
import './SubscriptionTab.css';

export default function SubscriptionTab() {
  const [sub, setSub] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    return cpGet('/billing/subscription')
      .then(setSub)
      .catch(err => setError(err.message));
  }

  useEffect(() => { refresh(); }, []);

  async function handleSubscribe() {
    setBusy(true);
    setError(null);
    try {
      const { checkout_url } = await cpPost('/billing/checkout');
      window.location.href = checkout_url;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleCancel() {
    setBusy(true);
    setError(null);
    try {
      await cpPost('/billing/cancel-subscription');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    setBusy(true);
    setError(null);
    try {
      await cpPost('/billing/resume-subscription');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const isActive = sub?.status === 'active';
  // has_access without an active paid subscription means either the
  // account-owner bypass or an admin-granted free-access grant (see
  // nq_control_plane's billing/service.py has_access) -- is_admin
  // distinguishes which, so the two aren't both labeled "Admin access".
  const isFreeAccess = sub?.has_access && !isActive;

  return (
    <div className="tab-single-col sub-tab">
      <div className="card sub-card">
        <div className="panel-title">Subscription</div>

        {!sub && !error && <p className="panel-placeholder">Loading…</p>}
        {error && <p className="sub-error">{error}</p>}

        {sub && isFreeAccess && (
          <div className="sub-status-row">
            <span className="sub-badge sub-badge-gold">{sub.is_admin ? 'Admin access' : 'Free access'}</span>
            <p className="sub-detail">
              {sub.is_admin
                ? 'Free access as the account owner — no subscription needed.'
                : 'Free access granted — no subscription needed.'}
            </p>
          </div>
        )}

        {sub && isActive && !isFreeAccess && (
          <div className="sub-status-row">
            <span className="sub-badge sub-badge-green">Active</span>
            <p className="sub-detail">
              {sub.cancel_at_period_end
                ? <>Cancels on {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'the end of this period'}.</>
                : <>Renews {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'soon'}.</>}
            </p>
            {sub.cancel_at_period_end ? (
              <button className="sub-btn sub-btn-primary" onClick={handleResume} disabled={busy}>
                {busy ? 'Working…' : 'Resume subscription'}
              </button>
            ) : (
              <button className="sub-btn sub-btn-danger" onClick={handleCancel} disabled={busy}>
                {busy ? 'Working…' : 'Cancel subscription'}
              </button>
            )}
          </div>
        )}

        {sub && !isActive && !isFreeAccess && (
          <div className="sub-status-row">
            <span className="sub-badge sub-badge-amber">Inactive</span>
            <p className="sub-detail">Subscribe to keep your bot running.</p>
            <button className="sub-btn sub-btn-primary" onClick={handleSubscribe} disabled={busy}>
              {busy ? 'Working…' : 'Subscribe — $250/mo'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
