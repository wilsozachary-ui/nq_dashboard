import { useState, useEffect, useRef, useCallback } from 'react';
import botApi from '../services/botApi';
import { isPracticeAccountName, useTestBotSnapshot } from './morningStrategyShared';
import './TopstepAccountSelector.css';

const ACCOUNTS = [];
// In the packaged desktop app, the frontend and backend both start in the
// same process at the same instant -- a fresh launch can genuinely have
// zero accounts loaded yet (platform.start()'s refresh_accounts() hasn't
// finished) when this component's first fetch fires. A one-shot fetch with
// no retry left the account count stuck at 0/0 forever once that race was
// lost, even after the backend caught up seconds later.
const POLL_MS = 5000;

// ── LocalStorage helpers ──────────────────────────────────────────────────────
const LS_SEL  = 'topstep_selected_accounts';
const LS_APLY = 'topstep_apply_to_all';

function loadSelected() {
  try { const r = localStorage.getItem(LS_SEL); return r ? JSON.parse(r) : []; }
  catch { return []; }
}

// Distinguishes "this key has never been written" (genuinely first launch,
// a sensible default of "select everything" applies) from "this key was
// written and happens to be []" (the user explicitly cleared every account
// via the None button, and that choice must stick). loadSelected() alone
// can't tell these apart since both read back as an empty array.
function hasSavedSelection() {
  try { return localStorage.getItem(LS_SEL) !== null; }
  catch { return false; }
}

function loadApplyAll() {
  try { return localStorage.getItem(LS_APLY) !== 'false'; }
  catch { return true; }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function TopstepAccountSelector({ strategy = 'morning' }) {
  const [accounts, setAccounts] = useState(ACCOUNTS);
  const [open,     setOpen]    = useState(false);
  const [selected, setSelected] = useState(loadSelected);
  const [applyAll, setApplyAll] = useState(loadApplyAll);
  const [accountsError, setAccountsError] = useState('');
  const rootRef = useRef(null);
  // Seeded once at mount; flips permanently to true the one time (if ever)
  // the "default to all" fallback below actually fires, so a later prune
  // that empties the list (accounts removed, or the user clearing them)
  // never gets reinterpreted as "still first launch" on the next poll tick.
  const everHadSavedSelection = useRef(hasSavedSelection());

  useEffect(() => {
    let mounted = true;

    const fetchAccounts = () => {
      botApi.getAccounts()
        .then(data => {
          const normalized = Array.isArray(data)
            ? data.map((a, i) => {
              const name = a.name ?? a.account_name ?? `Account ${i + 1}`;
              return {
                id: String(a.id ?? a.account_id ?? `acc-${i + 1}`),
                name,
                isPractice: isPracticeAccountName(name),
                enabled: a.enabled !== false,
                balance: Number(a.balance ?? a.cash ?? 0),
              };
            })
            : [];
          if (!mounted) return;
          setAccountsError('');
          setAccounts(normalized);
          setSelected(prev => {
            // filter() only ever removes entries and preserves order, so
            // equal lengths means nothing was actually pruned -- return the
            // exact same reference in that case so React bails out of the
            // update entirely (no re-render, no nq:accounts-changed
            // dispatch every single 5s tick when nothing changed).
            const pruned = prev.filter(id => normalized.some(a => String(a.id) === String(id)));
            if (pruned.length === prev.length) return prev;
            if (pruned.length > 0 || everHadSavedSelection.current) return pruned;
            // Truly first-ever load (localStorage key never written) --
            // fires at most once per component lifetime, see the ref above.
            everHadSavedSelection.current = true;
            return normalized.map(a => a.id);
          });
        })
        .catch(error => {
          if (mounted) setAccountsError(`Account list unavailable: ${error.message || 'request failed'}`);
        });
    };

    fetchAccounts();
    // Keep polling rather than fetching once -- on a fresh launch the
    // backend's account list can genuinely still be empty at the moment
    // this first fires (platform.start() hasn't finished refresh_accounts()
    // yet), and a one-shot fetch had no way to recover from that once lost.
    const id = setInterval(fetchAccounts, POLL_MS);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Expose globally + persist
  useEffect(() => {
    window.topstepAccountsSelected = selected;
    try { localStorage.setItem(LS_SEL, JSON.stringify(selected)); } catch {}
    window.dispatchEvent(new CustomEvent('nq:accounts-changed', {
      detail: { selected, applyAll, strategy },
    }));
  }, [selected, applyAll, strategy]);

  useEffect(() => {
    try { localStorage.setItem(LS_APLY, String(applyAll)); } catch {}
  }, [applyAll]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = e => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Listen for cross-strategy sync (apply-to-all)
  useEffect(() => {
    const h = e => {
      if (e.detail.strategy !== strategy && e.detail.applyAll) {
        setSelected(e.detail.selected);
      }
    };
    window.addEventListener('nq:accounts-changed', h);
    return () => window.removeEventListener('nq:accounts-changed', h);
  }, [strategy]);

  // ── Sync to server-truth armed account, once (morning/Live only) ────────
  // Same root cause and same fix shape as TradeParameterPanel.js's armed-
  // params sync: `selected` above is per-device localStorage, with no
  // connection to which account is actually armed. Arming only ever uses
  // selected[0] (see useSelectedAccount()/MorningStrategyLiveControl.js),
  // and that account_id is already part of GET /testbot/live's
  // armed_params -- the same server truth already wired up for the
  // parameters fix -- so this needs no new backend work. Scoped to the
  // "morning" instance specifically since that's the one whose selection
  // actually drives live arming; the "recap" instance is a view filter
  // with no real "currently armed" concept to sync to.
  const liveSnapshot = useTestBotSnapshot(strategy === 'morning' ? 'live' : null);
  const armedAccountSyncedRef = useRef(false);
  useEffect(() => {
    if (strategy !== 'morning') return;
    if (armedAccountSyncedRef.current) return;
    const armedAccountId = liveSnapshot.armed_params?.account_id;
    if (!liveSnapshot.armed || armedAccountId == null) return;
    armedAccountSyncedRef.current = true;
    setSelected([String(armedAccountId)]);
  }, [strategy, liveSnapshot.armed, liveSnapshot.armed_params]);

  const toggle    = useCallback(id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]), []);
  const selectAll = () => setSelected(accounts.map(a => a.id));
  const clearAll  = () => setSelected([]);

  const fmtBal = n => `$${n.toLocaleString('en-US')}`;

  return (
    <div className="tsa-root" ref={rootRef}>
      {accountsError && <span className="tsa-fetch-error" role="alert">{accountsError}</span>}

      {/* Trigger button */}
      <button
        className={`tsa-trigger${open ? ' tsa-trigger--open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Select Topstep accounts"
      >
        <span className="tsa-trigger-icon" aria-hidden="true">⊟</span>
        <span className="tsa-trigger-label">Topstep Accounts</span>
        <span className="tsa-trigger-count">{selected.length}/{accounts.length}</span>
        <span className="tsa-trigger-caret" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="tsa-panel" role="dialog" aria-label="Account selection">

          <div className="tsa-panel-header">
            <span className="tsa-panel-heading">Active Accounts</span>
            <div className="tsa-header-actions">
              <button className="tsa-link-btn" onClick={selectAll}>All</button>
              <span className="tsa-sep">·</span>
              <button className="tsa-link-btn" onClick={clearAll}>None</button>
            </div>
          </div>

          <div className="tsa-list" role="listbox" aria-multiselectable="true">
            {accounts.map(acc => {
              const checked = selected.includes(acc.id);
              return (
                <label
                  key={acc.id}
                  className={`tsa-item${checked ? ' tsa-item--checked' : ''}${acc.enabled ? '' : ' tsa-item--disabled'}`}
                  role="option"
                  aria-selected={checked}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(acc.id)}
                    className="tsa-checkbox-input"
                  />
                  <span className={`tsa-check${checked ? ' tsa-check--on' : ''}`} aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="10" height="10">
                      <path d="M3 8.5L6.2 11.5L13 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <div className="tsa-acc-info">
                    <span className="tsa-acc-name">{acc.name}</span>
                    <span className="tsa-acc-meta">
                      <span className={`tsa-type-badge${acc.isPractice ? ' tsa-type-badge--practice' : ' tsa-type-badge--live'}`}>
                        {acc.isPractice ? 'Practice' : 'Live'}
                      </span>
                      {!acc.enabled && <span className="tsa-disabled-badge">Disabled</span>}
                    </span>
                  </div>
                  <span className={`tsa-acc-balance${acc.balance < 50_000 ? ' tsa-acc-balance--low' : ''}`}>
                    {fmtBal(acc.balance)}
                  </span>
                </label>
              );
            })}
          </div>

          <div className="tsa-panel-footer">
            <label className="tsa-apply-row">
              <input
                type="checkbox"
                checked={applyAll}
                onChange={e => setApplyAll(e.target.checked)}
                className="tsa-checkbox"
              />
              <span className="tsa-apply-label">Apply selection to all strategies</span>
            </label>
          </div>

        </div>
      )}
    </div>
  );
}
