import { useState, useEffect, useRef, useCallback } from 'react';
import botApi from '../services/botApi';
import { restoreAccountToPicker } from './morningStrategyShared';
import { IconRestore } from './TabIcons';
import './RemovedAccountsCard.css';

const POLL_MS = 5000;

function maskAccountId(accountId) {
  const text = String(accountId ?? '');
  return text.length > 4 ? `•••• ${text.slice(-4)}` : text;
}

function fmtRemovedAt(iso) {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function fmtBalance(value) {
  return value == null ? '—' : `$${Number(value).toLocaleString('en-US')}`;
}

// Restoring an account Topstep no longer reports as tradeable (or doesn't
// return at all) can't actually put it back to work -- offering a plain
// "Restore" there would read as "this will make it usable again," which
// isn't true. Same underlying restore-to-picker call either way (the main
// picker's own canTrade/isVisible filter keeps a still-untradeable account
// out regardless), just labeled honestly for what it does: stop tracking
// this removal record rather than bring the account back into service.
function actionLabel(availability) {
  return availability === 'available' ? 'Restore' : 'Dismiss';
}

function availabilityBadge(availability) {
  if (availability === 'unavailable_at_topstep') return 'Unavailable at Topstep';
  if (availability === 'not_returned_by_topstep') return 'No longer available from Topstep';
  return null;
}

export default function RemovedAccountsCard({ pollMs = POLL_MS } = {}) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const busyRef = useRef(false);
  const revisionRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    let timer = null;

    const poll = async () => {
      try {
        const data = await botApi.getRemovedAccounts();
        if (!mounted) return;
        // A restore in flight already knows the outcome it's applying --
        // don't let a poll that started before it finished clobber that.
        if (!busyRef.current) {
          revisionRef.current = Number(data?.revision) || 0;
          setEntries(Array.isArray(data?.removed_accounts) ? data.removed_accounts : []);
        }
        setError(null);
      } catch (err) {
        if (mounted) setError(err.message || 'Removed accounts unavailable');
      } finally {
        if (mounted) {
          setLoading(false);
          timer = setTimeout(poll, pollMs);
        }
      }
    };

    poll();
    return () => { mounted = false; if (timer) clearTimeout(timer); };
  }, [pollMs]);

  const handleRestore = useCallback(async entry => {
    busyRef.current = true;
    setBusyId(entry.account_id);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await restoreAccountToPicker(entry.account_id, revisionRef.current);
      if (result.status === 'error') {
        setError(result.message);
        return;
      }
      revisionRef.current = Number(result.hidden?.revision) || revisionRef.current;
      setEntries(prev => prev.filter(e => e.account_id !== entry.account_id));
      setSuccessMessage(
        result.status === 'already_restored'
          ? `${entry.name || 'Account'} was already restored.`
          : `${entry.name || 'Account'} restored to the picker.`
      );
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  }, []);

  return (
    <section className="card set-card set-card--removed-accounts">
      <div className="set-card-head">
        <span className="set-card-icon"><IconRestore /></span>
        <div>
          <div className="panel-title">Recently Removed Accounts</div>
          <p className="set-card-copy">
            Accounts removed from the Topstep picker can be restored here. Restoring an account does not select
            it or arm Morning Strategy.
          </p>
        </div>
      </div>

      {error && <p className="set-error">{error}</p>}
      {successMessage && <p className="set-success">{successMessage}</p>}

      {loading ? (
        <p className="rac-loading">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="rac-empty">No recently removed accounts.</p>
      ) : (
        <ul className="rac-list">
          {entries.map(entry => {
            const badge = availabilityBadge(entry.availability);
            const busy = busyId === entry.account_id;
            return (
              <li key={entry.account_id} className="rac-item">
                <div className="rac-item-main">
                  <div className="rac-item-head">
                    <span className="rac-name">{entry.name || 'Unknown account'}</span>
                    {entry.type && <span className="rac-type-badge">{entry.type}</span>}
                    {badge && <span className="rac-availability-badge">{badge}</span>}
                  </div>
                  <div className="rac-meta">
                    <span>{maskAccountId(entry.account_id)}</span>
                    <span className="rac-meta-sep">·</span>
                    <span>Balance: {fmtBalance(entry.balance)}</span>
                    <span className="rac-meta-sep">·</span>
                    <span>Removed {fmtRemovedAt(entry.removed_at)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="rac-restore-btn"
                  onClick={() => handleRestore(entry)}
                  disabled={busy}
                >
                  {busy ? 'Working…' : actionLabel(entry.availability)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
