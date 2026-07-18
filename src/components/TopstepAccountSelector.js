import { useState, useEffect, useRef, useCallback } from 'react';
import botApi from '../services/botApi';
import { isPracticeAccountName } from './morningStrategyShared';
import './TopstepAccountSelector.css';

const POLL_MS = 5000;

function accountTypeLabel(account) {
  if (account.isPractice) return 'Practice';
  if (account.simulated === true) return 'Combine';
  if (account.simulated === false) return 'Funded';
  const descriptor = `${account.name || ''} ${account.type || ''}`.toUpperCase();
  if (descriptor.includes('COMBINE') || descriptor.includes('EVALUATION')) return 'Combine';
  if (descriptor.includes('FUNDED') || descriptor.includes('LIVE')) return 'Funded';
  return 'Live';
}

export default function TopstepAccountSelector({ strategy = 'morning', pollMs = POLL_MS }) {
  const [allAccounts, setAllAccounts] = useState([]);
  const [open, setOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState([]);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [hiddenIds, setHiddenIds] = useState([]);
  const [hiddenRevision, setHiddenRevision] = useState(0);
  const [hiddenBusy, setHiddenBusy] = useState(false);
  const [accountsError, setAccountsError] = useState('');
  const rootRef = useRef(null);
  const selectionRevisionRef = useRef(0);
  const selectionBusyRef = useRef(false);
  const hiddenRevisionRef = useRef(0);
  const hiddenBusyRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    let timer = null;

    const refresh = async () => {
      const revisionWhenRequested = selectionRevisionRef.current;
      const hiddenRevisionWhenRequested = hiddenRevisionRef.current;
      try {
        const [data, serverSelection, serverHidden] = await Promise.all([
          botApi.getAccounts(),
          botApi.getAccountSelection(),
          botApi.getHiddenAccounts(),
        ]);
        if (!mounted) return;
        const normalized = Array.isArray(data) ? data.map((account, index) => {
          const name = account.name ?? account.account_name ?? `Account ${index + 1}`;
          return {
            id: String(account.id ?? account.account_id ?? `acc-${index + 1}`),
            name,
            isPractice: isPracticeAccountName(name),
            canTrade: account.can_trade !== false && account.canTrade !== false,
            isVisible: account.is_visible !== false && account.isVisible !== false,
            simulated: account.simulated,
            type: account.type,
            balance: Number(account.balance ?? account.cash ?? 0),
          };
        // canTrade comes straight from Topstep's own account record --
        // false for an account that's been cancelled or hit its max loss
        // limit (MLL). Previously these still rendered, just grayed out
        // with a "Not tradeable" badge; hidden entirely now since an
        // account the bot can never actually use has no reason to occupy
        // space in the picker. A trader-dismissed account (hiddenIds,
        // separate state below) is filtered out the same way -- covers a
        // Combine evaluation failure, which Topstep's own app shows but the
        // Gateway API never exposes (canTrade/isVisible stay true).
        }).filter(account => account.isVisible && account.canTrade) : [];
        setAllAccounts(normalized);
        // A poll started before a successful PUT may return afterward. Do
        // not let that stale GET roll the browser back to the old account
        // set; the next poll will still pick up genuine cross-device edits.
        if (!selectionBusyRef.current && selectionRevisionRef.current === revisionWhenRequested) {
          const serverRevision = Number(serverSelection?.revision) || 0;
          selectionRevisionRef.current = serverRevision;
          setSelected(Array.isArray(serverSelection?.account_ids)
            ? serverSelection.account_ids.map(String)
            : []);
          setSelectionRevision(serverRevision);
        }
        if (!hiddenBusyRef.current && hiddenRevisionRef.current === hiddenRevisionWhenRequested) {
          const serverHiddenRevision = Number(serverHidden?.revision) || 0;
          hiddenRevisionRef.current = serverHiddenRevision;
          setHiddenIds(Array.isArray(serverHidden?.account_ids)
            ? serverHidden.account_ids.map(String)
            : []);
          setHiddenRevision(serverHiddenRevision);
        }
        setAccountsError('');
      } catch (error) {
        if (mounted) setAccountsError(`Account list unavailable: ${error.message || 'request failed'}`);
      } finally {
        if (mounted) timer = setTimeout(refresh, pollMs);
      }
    };

    refresh();
    return () => { mounted = false; if (timer) clearTimeout(timer); };
  }, [pollMs]);

  const accounts = allAccounts.filter(account => !hiddenIds.includes(account.id));
  const hiddenAccounts = allAccounts.filter(account => hiddenIds.includes(account.id));

  useEffect(() => {
    window.topstepAccountsSelected = selected;
    window.dispatchEvent(new CustomEvent('nq:accounts-changed', {
      detail: { selected, revision: selectionRevision, applyAll: true, strategy },
    }));
  }, [selected, selectionRevision, strategy]);

  useEffect(() => {
    if (!open) return undefined;
    const close = event => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const saveSelection = useCallback(async next => {
    if (selectionBusy) return;
    setSelectionBusy(true);
    selectionBusyRef.current = true;
    try {
      const saved = await botApi.saveAccountSelection(next, selectionRevision);
      setSelected((saved.account_ids || []).map(String));
      const savedRevision = Number(saved.revision) || 0;
      selectionRevisionRef.current = savedRevision;
      setSelectionRevision(savedRevision);
      setAccountsError('');
    } catch (error) {
      if (error.status === 409 && error.detail) {
        setSelected((error.detail.account_ids || []).map(String));
        const currentRevision = Number(error.detail.revision) || 0;
        selectionRevisionRef.current = currentRevision;
        setSelectionRevision(currentRevision);
      }
      setAccountsError(error.message || 'Account selection could not be saved');
    } finally {
      selectionBusyRef.current = false;
      setSelectionBusy(false);
    }
  }, [selectionBusy, selectionRevision]);

  const toggle = useCallback(id => {
    const next = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
    saveSelection(next);
  }, [selected, saveSelection]);

  const selectAll = () => saveSelection(accounts.map(account => account.id));
  const clearAll = () => saveSelection([]);
  const fmtBal = value => `$${value.toLocaleString('en-US')}`;

  const saveHidden = useCallback(async next => {
    if (hiddenBusy) return;
    setHiddenBusy(true);
    hiddenBusyRef.current = true;
    try {
      const saved = await botApi.saveHiddenAccounts(next, hiddenRevision);
      setHiddenIds((saved.account_ids || []).map(String));
      const savedRevision = Number(saved.revision) || 0;
      hiddenRevisionRef.current = savedRevision;
      setHiddenRevision(savedRevision);
      setAccountsError('');
    } catch (error) {
      if (error.status === 409 && error.detail) {
        setHiddenIds((error.detail.account_ids || []).map(String));
        const currentRevision = Number(error.detail.revision) || 0;
        hiddenRevisionRef.current = currentRevision;
        setHiddenRevision(currentRevision);
      }
      setAccountsError(error.message || 'Hidden accounts could not be saved');
    } finally {
      hiddenBusyRef.current = false;
      setHiddenBusy(false);
    }
  }, [hiddenBusy, hiddenRevision]);

  const hideAccount = id => {
    // A hidden account can't also stay selected -- nothing enforces that
    // server-side (hiding is deliberately independent of tradeability), so
    // drop it from the live selection here to avoid a dismissed account
    // silently remaining armed.
    if (selected.includes(id)) saveSelection(selected.filter(value => value !== id));
    saveHidden([...hiddenIds, id]);
  };
  const unhideAccount = id => saveHidden(hiddenIds.filter(value => value !== id));

  return (
    <div className="tsa-root" ref={rootRef}>
      {accountsError && <span className="tsa-fetch-error" role="alert">{accountsError}</span>}
      <button
        className={`tsa-trigger${open ? ' tsa-trigger--open' : ''}`}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Select Topstep accounts"
      >
        <span className="tsa-trigger-icon" aria-hidden="true">⊟</span>
        <span className="tsa-trigger-label">Topstep Accounts</span>
        <span className="tsa-trigger-count">{selected.length}/{accounts.length}</span>
        <span className="tsa-trigger-caret" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="tsa-panel" role="dialog" aria-label="Account selection">
          <div className="tsa-panel-header">
            <span className="tsa-panel-heading">{showHidden ? 'Hidden Accounts' : 'Active Accounts'}</span>
            <div className="tsa-header-actions">
              {!showHidden && (
                <>
                  <button className="tsa-link-btn" onClick={selectAll} disabled={selectionBusy}>All</button>
                  <span className="tsa-sep">·</span>
                  <button className="tsa-link-btn" onClick={clearAll} disabled={selectionBusy}>None</button>
                </>
              )}
              {hiddenAccounts.length > 0 && (
                <>
                  {!showHidden && <span className="tsa-sep">·</span>}
                  <button className="tsa-link-btn" onClick={() => setShowHidden(value => !value)}>
                    {showHidden ? 'Back' : `Hidden (${hiddenAccounts.length})`}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="tsa-list" role="listbox" aria-multiselectable={!showHidden}>
            {showHidden ? (
              hiddenAccounts.length === 0 ? (
                <p className="tsa-empty-hint">No hidden accounts.</p>
              ) : hiddenAccounts.map(account => (
                <div key={account.id} className="tsa-item tsa-item--hidden-row">
                  <div className="tsa-acc-info">
                    <span className="tsa-acc-name">{account.name}</span>
                    <span className="tsa-acc-meta">
                      <span className={`tsa-type-badge${account.isPractice ? ' tsa-type-badge--practice' : ' tsa-type-badge--live'}`}>
                        {accountTypeLabel(account)}
                      </span>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="tsa-link-btn"
                    onClick={() => unhideAccount(account.id)}
                    disabled={hiddenBusy}
                  >
                    Unhide
                  </button>
                </div>
              ))
            ) : accounts.map(account => {
              const checked = selected.includes(account.id);
              const typeLabel = accountTypeLabel(account);
              return (
                <label
                  key={account.id}
                  className={`tsa-item${checked ? ' tsa-item--checked' : ''}`}
                  role="option"
                  aria-selected={checked}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(account.id)}
                    disabled={selectionBusy}
                    className="tsa-checkbox-input"
                  />
                  <span className={`tsa-check${checked ? ' tsa-check--on' : ''}`} aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="10" height="10">
                      <path d="M3 8.5L6.2 11.5L13 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <div className="tsa-acc-info">
                    <span className="tsa-acc-name">{account.name}</span>
                    <span className="tsa-acc-meta">
                      <span className={`tsa-type-badge${account.isPractice ? ' tsa-type-badge--practice' : ' tsa-type-badge--live'}`}>
                        {typeLabel}
                      </span>
                    </span>
                  </div>
                  <span className={`tsa-acc-balance${account.balance < 50_000 ? ' tsa-acc-balance--low' : ''}`}>
                    {fmtBal(account.balance)}
                  </span>
                  <button
                    type="button"
                    className="tsa-hide-btn"
                    title={`Hide ${account.name} from this picker`}
                    aria-label={`Hide ${account.name}`}
                    onClick={event => { event.preventDefault(); event.stopPropagation(); hideAccount(account.id); }}
                    disabled={selectionBusy || hiddenBusy}
                  >
                    ×
                  </button>
                </label>
              );
            })}
          </div>

          <div className="tsa-panel-footer">
            <span className="tsa-apply-label">
              {showHidden
                ? 'Hidden accounts never appear in the picker or count toward selection.'
                : 'Selection applies to all strategies and devices'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
