import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import botApi from '../services/botApi';
import { normalizeParameterDraft } from './parameterDraft';

// ── Shared helpers/hooks for MorningStrategyLiveControl and
// MorningStrategyPracticeBotControl -- both drive the same real
// TestBotEngine via the same /testbot REST surface, they only differ in
// how/when they fire it (timed arm vs. immediate, live vs. practice gate).

export const STATUS_META = {
  OFF:       { label: 'OFF',         cls: 'mstb-status--off' },
  ARMED:     { label: 'ARMED',       cls: 'mstb-status--armed' },
  ACTIVE:    { label: 'ACTIVE',      cls: 'mstb-status--active' },
  CLOSED_TP: { label: 'CLOSED · TP', cls: 'mstb-status--closed-tp' },
  CLOSED_SL: { label: 'CLOSED · SL', cls: 'mstb-status--closed-sl' },
};

// Shared status pill -- one definition keeps color-coding/labeling
// identical between the Live and Practice panels.
export function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.OFF;
  return <span className={`mstb-status-pill ${meta.cls}`}>{meta.label}</span>;
}

// Shared inline spinner for busy button states.
export function Spinner() {
  return <span className="mstb-spinner" aria-hidden="true" />;
}

// One big, unambiguous ON/OFF switch -- the single control each panel
// exposes for turning the engine on or off. Everything else (countdown,
// fill state, close reason) is supporting text underneath, not a
// separate button, so there is exactly one thing to click.
export function PowerToggle({ on, busy, busyLabel, subLabel, onClick, disabled }) {
  return (
    <button
      className={`mstb-power${on ? ' mstb-power--on' : ''}${busy ? ' mstb-power--busy' : ''}`}
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={on}
    >
      <span className="mstb-power-track" aria-hidden="true">
        <span className="mstb-power-knob" />
      </span>
      <span className="mstb-power-text">
        <span className="mstb-power-main">
          {busy ? <><Spinner /> {busyLabel}</> : (on ? 'ON' : 'OFF')}
        </span>
        {!busy && subLabel && <span className="mstb-power-sub">{subLabel}</span>}
      </span>
    </button>
  );
}

export function fmtPrice(n) {
  return (n === undefined || n === null || Number.isNaN(Number(n))) ? '—' : `$${Number(n).toFixed(2)}`;
}

export function fmtPnl(n) {
  if (n === undefined || n === null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}$${v.toFixed(2)}`;
}

// Topstep account naming convention encodes practice vs. live (no clean API
// field for it) -- e.g. "PRAC-V2-575771-18827017" vs.
// "50KTC-V2-DLL-575771-31859500".
export function isPracticeAccountName(name) {
  return String(name || '').toUpperCase().includes('PRAC');
}

const SNAPSHOT_POLL_MS = 1000;
const EMPTY_SNAPSHOT = {};

function createSnapshotStore(mode) {
  const fetcher = mode === 'live' ? botApi.getLiveBot : botApi.getPracticeBot;
  const listeners = new Set();
  let timer = null;
  let requestInFlight = false;
  let value = {};

  const publish = (data, error = null) => {
    value = {
      ...(data || {}),
      _snapshotMeta: {
        error: error ? String(error.message || error) : null,
        stale: Boolean(error),
        updatedAt: error ? value._snapshotMeta?.updatedAt || null : new Date().toISOString(),
      },
    };
    listeners.forEach(listener => listener());
  };

  const poll = async () => {
    if (requestInFlight) return;
    requestInFlight = true;
    try {
      publish(await fetcher());
    } catch (error) {
      publish(value, error);
    } finally {
      requestInFlight = false;
    }
  };

  const start = () => {
    if (timer !== null) return;
    poll();
    timer = window.setInterval(poll, SNAPSHOT_POLL_MS);
  };

  const stop = () => {
    if (timer === null) return;
    window.clearInterval(timer);
    timer = null;
  };

  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
}

const snapshotStores = {
  live: createSnapshotStore('live'),
  practice: createSnapshotStore('practice'),
};

const emptySnapshotStore = {
  getSnapshot: () => EMPTY_SNAPSHOT,
  subscribe: () => () => {},
};

// Polls GET /testbot/live or /testbot/practice once per mode every 1s --
// matches the adapter's own _periodic_refresh cadence. All mounted consumers
// share the same request, timer, snapshot, and error state. Live and Practice
// remain independent engines/routes and therefore retain separate stores.
// mode: 'live' | 'practice' | null/undefined (disabled -- no fetch, no
// poll, returns {} forever; lets a caller conditionally opt out without
// violating the rules of hooks by skipping the call entirely).
export function useTestBotSnapshot(mode) {
  const store = snapshotStores[mode] || emptySnapshotStore;
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// Reads the live TradeParameterPanel values via the window global +
// CustomEvent bus TradeParameterPanel.js broadcasts on every change --
// avoids a state-lifting refactor between unrelated components.
export function useMorningStrategyParams() {
  const ref = useRef(window.nqMorningStrategyParams || null);
  const [, force] = useState(0);
  useEffect(() => {
    const handler = e => { ref.current = e.detail; force(n => n + 1); };
    window.addEventListener('nq:morning-strategy-params', handler);
    return () => window.removeEventListener('nq:morning-strategy-params', handler);
  }, []);
  return ref;
}

export function useSelectedAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [accountIds, setAccountIds] = useState(() => {
    const sel = window.topstepAccountsSelected;
    return Array.isArray(sel) ? sel.map(String) : [];
  });

  useEffect(() => {
    let alive = true;
    botApi.getAccounts().then(list => {
      if (alive) setAccounts(Array.isArray(list) ? list : []);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const handler = e => {
      const sel = e.detail.selected;
      setAccountIds(Array.isArray(sel) ? sel.map(String) : []);
    };
    window.addEventListener('nq:accounts-changed', handler);
    return () => window.removeEventListener('nq:accounts-changed', handler);
  }, []);

  const selectedAccounts = accounts.filter(a => accountIds.includes(String(a.account_id ?? a.id)));
  return { accountIds, accounts: selectedAccounts };
}

export function resolveSinglePracticeAccount(accounts) {
  const practiceAccounts = (Array.isArray(accounts) ? accounts : []).filter(account =>
    isPracticeAccountName(account?.account_name ?? account?.name)
  );
  if (practiceAccounts.length !== 1) {
    return { account: null, count: practiceAccounts.length };
  }
  return { account: practiceAccounts[0], count: 1 };
}

// ── Morning Strategy AI recommendation formatting/apply -- shared between
// AiSuggestedParametersPanel.js (Topstep tab) and AiInsightsTab.js's
// Recommended Setup card, so the same 9 parameters format and apply
// identically in both places rather than maintaining two copies that could
// drift.
export const fmtPoints     = n => Number.isFinite(n) ? `${n} pt${n === 1 ? '' : 's'}` : '—';
export const fmtDollars    = n => Number.isFinite(n) ? `$${Math.round(n)}` : '—';
export const fmtContracts  = n => Number.isFinite(n) ? `${n}` : '—';
export const fmtPct        = n => Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—';
export const fmtRetainPct  = n => Number.isFinite(n) ? `${Math.round(n)}%` : '—';
export const fmtBool       = v => v == null ? '—' : (v ? 'On' : 'Off');
export const fmtSamples    = n => Number.isFinite(n) ? `${n} day${n === 1 ? '' : 's'}` : '—';

// Every recommended parameter the AI surfaces, in display order. `key`
// matches the API's "recommended_<key>" / parameter_reasons key;
// `currentKey` matches window.nqMorningStrategyParams' own field name (see
// parameterDraft.js's PARAMETER_DEFAULTS) so "current value" reads from the
// exact same source TradeParameterPanel.js itself uses. `section` matches
// TradeParameterPanel.js's own Entry/Risk/Trailing grouping, so the AI
// panel's parameter list reads as the same three familiar groups instead
// of one long undifferentiated list.
export const AI_PARAMETERS = [
  { key: 'contract_size',          currentKey: 'contractSize',        label: 'Contract Size',       fmt: fmtContracts, section: 'Entry' },
  { key: 'spread_points',          currentKey: 'spreadPoints',        label: 'Spread',              fmt: fmtPoints,    section: 'Entry' },
  { key: 'tp_dollars',             currentKey: 'takeProfit',          label: 'Take Profit',         fmt: fmtDollars,   section: 'Risk' },
  { key: 'sl_dollars',             currentKey: 'stopLoss',            label: 'Stop Loss',           fmt: fmtDollars,   section: 'Risk' },
  { key: 'trailing_enabled',       currentKey: 'trailingStop',        label: 'Trailing Enabled',    fmt: fmtBool,      section: 'Trailing' },
  { key: 'trailing_points',        currentKey: 'trailingDistance',    label: 'Trailing Distance',   fmt: fmtPoints,    section: 'Trailing' },
  { key: 'breakeven_dollars',      currentKey: 'breakevenTrigger',    label: 'Breakeven Trigger',   fmt: fmtDollars,   section: 'Trailing' },
  { key: 'profit_lock_dollars',    currentKey: 'profitLockTrigger',   label: 'Profit Lock Trigger', fmt: fmtDollars,   section: 'Trailing' },
  { key: 'profit_lock_retain_pct', currentKey: 'profitLockRetainPct', label: 'Profit Lock Retain',  fmt: fmtRetainPct, section: 'Trailing' },
];

// Maps a recommendation's recommended_* fields onto TradeParameterPanel's
// own draft field names (see parameterDraft.js's PARAMETER_DEFAULTS) --
// the single source of truth for that mapping, used both to build the
// diff shown in the confirmation dialog and the merged draft actually
// persisted.
export function recommendationToDraftPatch(rec) {
  return {
    spreadPoints:        rec.recommended_spread_points,
    takeProfit:          rec.recommended_tp_dollars,
    stopLoss:            rec.recommended_sl_dollars,
    trailingDistance:    rec.recommended_trailing_points,
    trailingStop:        rec.recommended_trailing_enabled,
    contractSize:        rec.recommended_contract_size,
    breakevenTrigger:    rec.recommended_breakeven_dollars,
    profitLockTrigger:   rec.recommended_profit_lock_dollars,
    profitLockRetainPct: rec.recommended_profit_lock_retain_pct,
  };
}

// Per-parameter {label, from, to, changed} rows for the confirmation
// dialog -- computed against the CURRENT server-saved draft (fetched fresh
// when the dialog opens), never against whatever TradeParameterPanel
// happens to have in memory, so the diff always reflects what Confirm
// would actually change.
export function computeParameterDiff(rec, currentDraft) {
  const patch = recommendationToDraftPatch(rec);
  return AI_PARAMETERS.map(config => {
    const from = currentDraft ? currentDraft[config.currentKey] : undefined;
    const to = patch[config.currentKey];
    return { key: config.key, label: config.label, fmt: config.fmt, from, to, changed: from !== to };
  });
}

// Broadcasts the same nq:strategy-params-sync event TradeParameterPanel.js
// already listens for (its "sync from StrategyControlBar quick-
// adjustments" handler) -- called ONLY after a recommendation's values
// have actually been persisted through the server-authoritative parameter
// endpoint (see useApplyRecommendationFlow below), so any mounted
// TradeParameterPanel's displayed "already saved" state stays truthful.
// Never call this directly from a click handler -- it performs no
// confirmation or persistence of its own.
function broadcastAppliedParameters(rec) {
  window.dispatchEvent(new CustomEvent('nq:strategy-params-sync', { detail: recommendationToDraftPatch(rec) }));
}

const ARMED_STATUSES = new Set(['ARMED', 'ACTIVE']);

// The one AI-panel action permitted to touch saved Morning Strategy
// parameters: opening the dialog only reads the current saved draft (a
// GET), and nothing is persisted until the user clicks "Confirm Changes"
// inside it. User-saved parameters remain authoritative at every other
// moment -- loading, refreshing, changing accounts, expanding reasoning,
// or displaying TRADE/SKIP must never call anything in this hook. Shared
// by AiSuggestedParametersPanel.js and AiInsightsTab.js's Recommended
// Setup card so both behave identically rather than maintaining two
// copies that could drift.
export function useApplyRecommendationFlow(rec) {
  const [dialog, setDialog] = useState(null); // null | { diff, revision, currentDraft, loadFailed }
  const [confirming, setConfirming] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');

  const liveSnapshot = useTestBotSnapshot('live');
  const practiceSnapshot = useTestBotSnapshot('practice');
  const isArmed = ARMED_STATUSES.has(liveSnapshot.status) || ARMED_STATUSES.has(practiceSnapshot.status);
  const isSkip = rec?.action === 'skip';

  const openDialog = useCallback(async () => {
    if (!rec || isSkip) return;
    setError('');
    try {
      const saved = await botApi.getMorningStrategyParameters();
      const currentDraft = normalizeParameterDraft(saved?.draft);
      setDialog({ diff: computeParameterDiff(rec, currentDraft), revision: saved?.revision ?? 0, currentDraft });
    } catch (err) {
      // Still show the dialog (with defaults as the "from" side) rather
      // than silently doing nothing -- but flag that the diff may not
      // reflect the true current draft, and that Confirm could be
      // rejected by a stale revision.
      const currentDraft = normalizeParameterDraft(null);
      setDialog({ diff: computeParameterDiff(rec, currentDraft), revision: 0, currentDraft, loadFailed: true });
      setError(`Could not load the current saved parameters (${err.message}).`);
    }
  }, [rec, isSkip]);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setError('');
  }, []);

  const confirmApply = useCallback(async () => {
    if (!dialog || !rec) return;
    setConfirming(true);
    setError('');
    try {
      const merged = { ...dialog.currentDraft, ...recommendationToDraftPatch(rec) };
      await botApi.saveMorningStrategyParameters(merged, dialog.revision);
      // Only now, after a durably confirmed successful save, tell the rest
      // of the UI the saved parameters actually changed.
      broadcastAppliedParameters(rec);
      setDialog(null);
      setApplied(true);
      setTimeout(() => setApplied(false), 2500);
    } catch (err) {
      // Never partially update: nothing above touched the broadcast, so a
      // failed save leaves saved parameters exactly as they were.
      setError(err.message || 'Save failed');
    } finally {
      setConfirming(false);
    }
  }, [dialog, rec]);

  return { isArmed, isSkip, dialog, openDialog, closeDialog, confirmApply, confirming, applied, error };
}

// Restores a removed account to the picker, retrying once on a 409
// revision conflict against freshly-read server state. Shared between the
// account selector's Undo toast and the Settings "Recently Removed
// Accounts" card's Restore button so both handle the exact same
// conflict/already-restored cases identically rather than drifting.
//
// Returns { status: 'restored' | 'already_restored' | 'error', message? }.
// 'already_restored' means someone else (another device, or a second click
// racing this one) already restored it -- the desired end state already
// holds, so this is reported distinctly from 'error' rather than as a
// failure the caller should show as one.
export async function restoreAccountToPicker(accountId, expectedHiddenRevision) {
  try {
    const result = await botApi.restoreAccountToPicker(accountId, expectedHiddenRevision);
    return { status: 'restored', hidden: result.hidden };
  } catch (error) {
    if (error.status !== 409 || !error.detail) {
      return { status: 'error', message: error.message || 'Account could not be restored' };
    }
    const currentIds = (error.detail.account_ids || []).map(String);
    const currentRevision = Number(error.detail.revision) || 0;
    if (!currentIds.includes(String(accountId))) {
      return { status: 'already_restored', hidden: { account_ids: currentIds, revision: currentRevision } };
    }
    try {
      const retried = await botApi.restoreAccountToPicker(accountId, currentRevision);
      return { status: 'restored', hidden: retried.hidden };
    } catch (retryError) {
      return { status: 'error', message: retryError.message || 'Account could not be restored' };
    }
  }
}

// Single-account compatibility for Practice, recap, and view filters.
export function useSelectedAccount() {
  const { accountIds, accounts } = useSelectedAccounts();
  const accountId = accountIds[0] || null;
  const account = accounts.find(a => String(a.account_id ?? a.id) === String(accountId)) || null;
  const isPractice = isPracticeAccountName(account?.account_name ?? account?.name);

  return { accountId, account, isPractice };
}
