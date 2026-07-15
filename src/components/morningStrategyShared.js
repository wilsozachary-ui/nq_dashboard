import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import botApi from '../services/botApi';

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

// Tracks the currently-selected Topstep account (first of
// TopstepAccountSelector's multi-select) and resolves its account object
// (for the practice-account name check) from GET /accounts.
export function useSelectedAccount() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(() => {
    const sel = window.topstepAccountsSelected;
    return sel && sel.length ? sel[0] : null;
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
      setAccountId(sel && sel.length ? sel[0] : null);
    };
    window.addEventListener('nq:accounts-changed', handler);
    return () => window.removeEventListener('nq:accounts-changed', handler);
  }, []);

  const account = accounts.find(a => String(a.account_id ?? a.id) === String(accountId)) || null;
  const isPractice = isPracticeAccountName(account?.account_name ?? account?.name);

  return { accountId, account, isPractice };
}
