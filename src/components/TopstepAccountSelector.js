import { useState, useEffect, useRef, useCallback } from 'react';
import botApi from '../services/botApi';
import { isPracticeAccountName, restoreAccountToPicker } from './morningStrategyShared';
import { useToast } from '../hooks/useToast';
import { IconRemove } from './TabIcons';
import './TopstepAccountSelector.css';

const POLL_MS = 5000;
// How long the lighter (unselected-account) remove confirmation stays
// armed before resetting -- long enough for a deliberate second click,
// short enough that it can't be triggered by two unrelated clicks minutes
// apart.
const ARM_TIMEOUT_MS = 4000;

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
  const [selected, setSelected] = useState([]);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [hiddenIds, setHiddenIds] = useState([]);
  const [hiddenRevision, setHiddenRevision] = useState(0);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [armedRemoveId, setArmedRemoveId] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [accountsError, setAccountsError] = useState('');
  const rootRef = useRef(null);
  const selectionRevisionRef = useRef(0);
  const selectionBusyRef = useRef(false);
  const hiddenRevisionRef = useRef(0);
  const armTimerRef = useRef(null);
  const { show: showToast, dismiss: dismissToast } = useToast();

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
        // space in the picker. A trader-removed account (hiddenIds,
        // separate state below) is filtered out the same way.
        }).filter(account => account.isVisible && account.canTrade) : [];
        setAllAccounts(normalized);
        // A poll started before a successful save may return afterward. Do
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
        // Same staleness guard as selection above: a poll issued before a
        // remove/restore call started, resolving after it already applied
        // the new revision, must not roll the picker back to the
        // pre-removal hidden set.
        if (hiddenRevisionRef.current === hiddenRevisionWhenRequested) {
          const serverHiddenRevision = Number(serverHidden?.revision) || 0;
          hiddenRevisionRef.current = serverHiddenRevision;
          setHiddenIds(Array.isArray(serverHidden?.account_ids) ? serverHidden.account_ids.map(String) : []);
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

  useEffect(() => () => { if (armTimerRef.current) clearTimeout(armTimerRef.current); }, []);

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

  const clearArmed = useCallback(() => {
    if (armTimerRef.current) { clearTimeout(armTimerRef.current); armTimerRef.current = null; }
    setArmedRemoveId(null);
  }, []);

  // Undo re-restores using the exact revision the remove call just handed
  // back, retrying once on a 409 (another device changed removed accounts
  // in between) via the same shared helper the Settings card's Restore
  // button uses -- one conflict-handling code path, not two.
  const undoRemove = useCallback(async (accountId, knownHiddenRevision) => {
    const result = await restoreAccountToPicker(accountId, knownHiddenRevision);
    if (result.status === 'error') {
      showToast(result.message, { type: 'error' });
      return;
    }
    const revision = Number(result.hidden?.revision) || 0;
    hiddenRevisionRef.current = revision;
    setHiddenRevision(revision);
    setHiddenIds((result.hidden?.account_ids || []).map(String));
    showToast(
      result.status === 'already_restored' ? 'Account was already restored.' : 'Account restored to the picker.',
      { type: 'success' },
    );
  }, [showToast]);

  const performRemove = useCallback(async account => {
    if (removeBusy) return;
    setRemoveBusy(true);
    try {
      const result = await botApi.removeAccountFromPicker(account.id, hiddenRevision, selectionRevision);
      const newHiddenRevision = Number(result.hidden.revision) || 0;
      hiddenRevisionRef.current = newHiddenRevision;
      setHiddenRevision(newHiddenRevision);
      setHiddenIds((result.hidden.account_ids || []).map(String));
      if (result.selection_changed) {
        const newSelectionRevision = Number(result.selection.revision) || 0;
        selectionRevisionRef.current = newSelectionRevision;
        setSelectionRevision(newSelectionRevision);
        setSelected((result.selection.account_ids || []).map(String));
      }
      setAccountsError('');
      const toastId = showToast('Account removed from the picker.', {
        type: 'success',
        duration: 8000,
        action: {
          label: 'Undo',
          onClick: () => { dismissToast(toastId); undoRemove(account.id, newHiddenRevision); },
        },
      });
    } catch (error) {
      if (error.status === 409 && error.detail) {
        if (error.detail.code === 'stale_account_selection_revision') {
          setSelected((error.detail.account_ids || []).map(String));
          selectionRevisionRef.current = Number(error.detail.revision) || 0;
          setSelectionRevision(selectionRevisionRef.current);
        } else if (error.detail.code === 'stale_hidden_accounts_revision') {
          setHiddenIds((error.detail.account_ids || []).map(String));
          hiddenRevisionRef.current = Number(error.detail.revision) || 0;
          setHiddenRevision(hiddenRevisionRef.current);
        }
        showToast('This changed on another device. Refreshed -- try removing it again.', { type: 'warning' });
      } else {
        showToast(error.message || 'Account could not be removed', { type: 'error' });
      }
    } finally {
      setRemoveBusy(false);
    }
  }, [removeBusy, hiddenRevision, selectionRevision, showToast, dismissToast, undoRemove]);

  // Selected accounts require an explicit, unambiguous confirmation
  // (a modal) since removing one immediately deselects and disarms it for
  // Morning Strategy. An unselected account gets a lighter "click again to
  // confirm" arm/confirm pattern on the same button -- still prevents an
  // accidental single click from removing it, without a modal for what's
  // normally a low-stakes action.
  const requestRemove = account => {
    if (selected.includes(account.id)) {
      clearArmed();
      setConfirmTarget(account);
      return;
    }
    if (armedRemoveId === account.id) {
      clearArmed();
      performRemove(account);
      return;
    }
    clearArmed();
    setArmedRemoveId(account.id);
    armTimerRef.current = setTimeout(clearArmed, ARM_TIMEOUT_MS);
  };

  const confirmStrongRemove = () => {
    const account = confirmTarget;
    setConfirmTarget(null);
    if (account) performRemove(account);
  };

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
            <span className="tsa-panel-heading">Active Accounts</span>
            <div className="tsa-header-actions">
              <button className="tsa-link-btn" onClick={selectAll} disabled={selectionBusy}>All</button>
              <span className="tsa-sep">·</span>
              <button className="tsa-link-btn" onClick={clearAll} disabled={selectionBusy}>None</button>
            </div>
          </div>

          <div className="tsa-list" role="listbox" aria-multiselectable="true">
            {accounts.map(account => {
              const checked = selected.includes(account.id);
              const typeLabel = accountTypeLabel(account);
              const armed = armedRemoveId === account.id;
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
                    className={`tsa-remove-btn${armed ? ' tsa-remove-btn--armed' : ''}`}
                    title={armed ? 'Click again to confirm' : 'Remove from account picker'}
                    aria-label={armed
                      ? `Confirm remove ${account.name} from account picker`
                      : `Remove ${account.name} from account picker`}
                    onClick={event => { event.preventDefault(); event.stopPropagation(); requestRemove(account); }}
                    disabled={selectionBusy || removeBusy}
                  >
                    {armed ? 'Confirm?' : <IconRemove />}
                  </button>
                </label>
              );
            })}
            {accounts.length === 0 && (
              <p className="tsa-empty-hint">No accounts available.</p>
            )}
          </div>

          <div className="tsa-panel-footer">
            <span className="tsa-apply-label">Selection applies to all strategies and devices</span>
            <span className="tsa-removed-link">Removed accounts can be restored in Settings.</span>
          </div>
        </div>
      )}

      {confirmTarget && (
        <div className="tsa-confirm-overlay" role="presentation" onMouseDown={() => setConfirmTarget(null)}>
          <div
            className="tsa-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="tsa-confirm-title"
            onMouseDown={event => event.stopPropagation()}
          >
            <p id="tsa-confirm-title" className="tsa-confirm-title">
              Remove {confirmTarget.name} from the picker?
            </p>
            <p className="tsa-confirm-body">
              It will be deselected and cannot be used by Morning Strategy until restored.
            </p>
            <div className="tsa-confirm-actions">
              <button type="button" className="tsa-link-btn" onClick={() => setConfirmTarget(null)}>
                Cancel
              </button>
              <button type="button" className="tsa-confirm-remove-btn" onClick={confirmStrongRemove} disabled={removeBusy}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
