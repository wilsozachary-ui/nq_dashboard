import { useState, useEffect, useRef, useCallback } from 'react';
import { USE_MOCK } from '../api/pnlApi';
import './TradeParameterPanel.css';
import botApi from '../services/botApi';
import { PARAMETER_DEFAULTS, normalizeParameterDraft } from './parameterDraft';

// ── Adjustment steps ──────────────────────────────────────────────────────────
const HOLD_MS       = 120;     // hold-to-repeat interval (ms)
const DOLLAR_STEP   = 25;      // TP/SL adjustment step, in dollars
const TRAIL_STEP    = 1;       // trailing distance adjustment step, in points

// ── Defaults (used until WS/API provides real values) ────────────────────────
// Shared by both the ORB display and the Morning Strategy live/practice
// bots (TestBotEngine) -- TP/SL are dollar risk amounts, trailing distance
// is in points, matching TestBotConfig/ORBConfig, not raw price levels.
const DEFAULTS = PARAMETER_DEFAULTS;

// ── User-saved defaults ("Make Default" button) ──────────────────────────────
// Browser storage is never parameter authority. These defaults are only a
// temporary fallback while the server-authoritative saved draft loads.
function effectiveDefaults() {
  return { ...DEFAULTS };
}

// ── Server-truth armed parameters -> this panel's own field shape ───────────
// ── Format helpers ────────────────────────────────────────────────────────────
// All guard against non-finite input (undefined/null/NaN) rather than
// rendering a raw "NaN" -- e.g. a param object missing a field it should
// have (a stale object surviving a hot-reload across a DEFAULTS change is
// one real way this happens, but any future gap should degrade to '—'
// instead of an unlabeled NaN with no indication of what's wrong).
const fmtContracts = n => Number.isFinite(n) ? `${n}` : '—';
const fmtDist      = n => Number.isFinite(n) ? `$${Math.round(n)}` : '—';
const fmtPoints    = n => Number.isFinite(n) ? `${n} pt${n === 1 ? '' : 's'}` : '—';

// ── Dispatch a timeline event to ActivityDashboard via browser event ──────────
function pushEvent(note) {
  window.dispatchEvent(new CustomEvent('nq:param-update', {
    detail: { type: 'param_update', timestamp: new Date().toISOString(), note },
  }));
}

// ── Broadcast current params for MorningStrategyLiveControl /
// MorningStrategyPracticeBotControl to read without a state-lifting
// refactor. window.nqMorningStrategyParams covers late-mounting
// consumers; the event covers ones already mounted and listening.
function broadcastMorningStrategyParams(p) {
  window.nqMorningStrategyParams = p;
  window.dispatchEvent(new CustomEvent('nq:morning-strategy-params', { detail: p }));
}

// ── Client-side validation ────────────────────────────────────────────────────
function validate(p) {
  const e = {};
  if (p.contractSize < 1)
    e.contractSize = 'Min 1';
  if (p.spreadPoints < 1)
    e.spreadPoints = 'Min 1';
  if (p.takeProfit < 1)
    e.takeProfit = 'Min $1';
  if (p.stopLoss < 1)
    e.stopLoss = 'Min $1';
  if (p.trailingStop && p.trailingDistance < 1)
    e.trailingDistance = 'Min 1';
  return e;
}

// ── ArrowControl — reusable arrow + value + arrow row ────────────────────────
function ArrowControl({ label, display, onIncrease, onDecrease, disabled, error }) {
  const holdRef = useRef(null);

  function press(fn) {
    fn();
    holdRef.current = setInterval(fn, HOLD_MS);
  }

  function release() {
    clearInterval(holdRef.current);
    holdRef.current = null;
  }

  // Safety cleanup on unmount
  useEffect(() => () => clearInterval(holdRef.current), []);

  return (
    <div className={`tp-row${error ? ' tp-row--error' : ''}`}>
      <div className="tp-row-top">
        <span className="tp-label">{label}</span>
        {error && <span className="tp-error-msg">{error}</span>}
      </div>
      <div className="tp-arrow-group">
        <button
          className="tp-arrow"
          disabled={disabled}
          aria-label={`Decrease ${label}`}
          onMouseDown={() => press(onDecrease)}
          onMouseUp={release}
          onMouseLeave={release}
          onTouchStart={e => { e.preventDefault(); press(onDecrease); }}
          onTouchEnd={release}
        >▼</button>
        <span className="tp-val">{display}</span>
        <button
          className="tp-arrow"
          disabled={disabled}
          aria-label={`Increase ${label}`}
          onMouseDown={() => press(onIncrease)}
          onMouseUp={release}
          onMouseLeave={release}
          onTouchStart={e => { e.preventDefault(); press(onIncrease); }}
          onTouchEnd={release}
        >▲</button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TradeParameterPanel() {
  const [params,       setParams]       = useState(effectiveDefaults);
  const [lastApplied,  setLastApplied]  = useState(effectiveDefaults);
  const [errors,       setErrors]       = useState({});
  const [applying,     setApplying]     = useState(false);
  const [applyState,   setApplyState]   = useState('idle'); // 'idle'|'success'|'error'
  const [applyMsg,     setApplyMsg]     = useState('');
  const [draftRevision, setDraftRevision] = useState(0);
  const [wsStatus,    setWsStatus]    = useState(USE_MOCK ? 'mock' : 'connecting');
  const [loadError,   setLoadError]   = useState('');

  // Ref always holds the latest params (prevents stale closures in hold intervals)
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const dirty = JSON.stringify(params) !== JSON.stringify(lastApplied);

  // ── Sync to server-truth armed parameters, once ─────────────────────────
  // effectiveDefaults() above is per-device localStorage, which is exactly
  // Keep late-mounting/already-mounted Morning Strategy controls in sync
  // with the current panel values (not just the last-applied ones), since
  // Fire/Arm should always use whatever is currently on screen.
  useEffect(() => {
    broadcastMorningStrategyParams(params);
  }, [params]);

  // ── Adjustment helper ─────────────────────────────────────────────────────
  // Reads paramsRef (not closed-over params) so hold-repeat always sees fresh value
  const adjust = useCallback((key, delta, label, fmtFn, min = -Infinity) => {
    const prev = paramsRef.current;
    // Fall back to this field's own default rather than blindly adding
    // delta to a non-finite base -- NaN + delta is still NaN, so without
    // this a value that ever went missing/undefined (e.g. a stale object
    // surviving a hot-reload across a DEFAULTS change) could never be
    // fixed by clicking the arrows; every future click would stay NaN too.
    const base  = Number.isFinite(prev[key]) ? prev[key] : DEFAULTS[key];
    const raw   = base + delta;
    const next  = Math.round(raw * 10000) / 10000;   // float safety
    const clamped = Math.max(min, next);
    if (clamped === prev[key]) return;
    setParams(p => ({ ...p, [key]: clamped }));
    pushEvent(`${label} → ${fmtFn(clamped)}`);
  }, []);

  const toggleTrailingStop = useCallback(() => {
    const next = !paramsRef.current.trailingStop;
    setParams(p => ({ ...p, trailingStop: next }));
    pushEvent(`Trailing Stop → ${next ? 'Enabled' : 'Disabled'}`);
  }, []);

  const toggleSecureBE = useCallback(() => {
    const next = !paramsRef.current.secureBE;
    setParams(p => ({ ...p, secureBE: next }));
    pushEvent(`Secure BE → ${next ? 'Enabled' : 'Disabled'}`);
  }, []);

  // ── Load initial params from backend (real mode) ──────────────────────────
  useEffect(() => {
    if (USE_MOCK) return;
    botApi.getMorningStrategyParameters()
      .then(d => {
        if (d) {
          const loaded = normalizeParameterDraft(d.draft);
          setParams(loaded);
          setLastApplied(loaded);
          setDraftRevision(d.revision ?? 0);
          setLoadError('');
        }
      })
      .catch(error => {
        setLoadError(`Could not load saved parameters (${error.message}). Verify before arming.`);
      });
  }, []);

  // ── Sync from StrategyControlBar quick-adjustments ────────────────────────
  useEffect(() => {
    const handler = e => {
      setParams(p => ({ ...p, ...e.detail }));
      setLastApplied(p => ({ ...p, ...e.detail }));
    };
    window.addEventListener('nq:strategy-params-sync', handler);
    return () => window.removeEventListener('nq:strategy-params-sync', handler);
  }, []);

  // Transactional strategy loads replace the complete editable parameter set.
  useEffect(() => {
    const handler = e => {
      const next = { ...effectiveDefaults(), ...(e.detail.config?.parameters || {}) };
      setParams(next);
      setLastApplied(next);
      setErrors({});
      setApplyState('idle');
    };
    window.addEventListener('nq:strategy-change', handler);
    return () => window.removeEventListener('nq:strategy-change', handler);
  }, []);

  // ── WebSocket connection (/ws/topstep/strategy) ───────────────────────────
  useEffect(() => {
    if (USE_MOCK) return;
    const handler = event => {
      const msg = event.detail; setWsStatus('connected');
      if (msg.type !== 'parameter_update') return;
      // Spread the effective defaults first, then only override fields the
      // message actually carries -- previously this object omitted
      // breakevenTrigger (and would've omitted the two profit-lock fields
      // below too), silently resetting them to undefined (rendered as
      // "$NaN") on any inbound nq:integrated-strategy message.
      const ed = effectiveDefaults();
      const merged = {
        ...ed,
        contractSize: msg.contractSize ?? ed.contractSize,
        stopLoss: msg.stopLoss ?? ed.stopLoss,
        takeProfit: msg.takeProfit ?? ed.takeProfit,
        trailingStop: msg.trailingStop ?? ed.trailingStop,
        secureBE: msg.secureBE ?? ed.secureBE,
        trailingDistance: msg.trailingDistance ?? ed.trailingDistance,
        breakevenTrigger: msg.breakevenTrigger ?? ed.breakevenTrigger,
        profitLockTrigger: msg.profitLockTrigger ?? ed.profitLockTrigger,
        profitLockRetainPct: msg.profitLockRetainPct ?? ed.profitLockRetainPct,
      };
      setParams(merged); setLastApplied(merged);
    };
    window.addEventListener('nq:integrated-strategy', handler);
    return () => window.removeEventListener('nq:integrated-strategy', handler);
  }, []);

  // ── Confirm Changes ────────────────────────────────────────────────────────
  // There is no backend "staged config" to push these to -- Fire/Arm on the
  // Morning Strategy live/practice controls already read the live panel
  // values directly (via broadcastMorningStrategyParams) at the moment they
  // fire, not a previously-applied snapshot: that's already correct and is
  // NOT changed by clicking this button. This is purely a local
  // confirm-and-clear-dirty step. (The adapter only exposes GET for
  // /topstep/strategy/parameters -- POSTing to it 405s.)
  //
  // Previously labeled "Apply Changes" / "Apply parameter changes to the
  // bot", which claimed a live sync that never happened -- a user could
  // click it, see a success state, then arm from a different device (or
  // after this component remounted) and get traded with different
  // parameters than whatever they thought they'd just "applied"
  // (2026-07-14 audit, High). Relabeled to "Confirm Changes" to match what
  // this button actually does: acknowledge the current on-screen values
  // and clear the unsaved-changes indicator, nothing more.
  const handleApply = useCallback(async () => {
    const p    = paramsRef.current;
    const errs = validate(p);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setApplying(true);
    setApplyState('idle');

    try {
      const saved = await botApi.saveMorningStrategyParameters(p, draftRevision);
      setLastApplied(normalizeParameterDraft(saved.draft));
      setDraftRevision(saved.revision);
    } catch (error) {
      if (error.status === 409 && error.detail) {
        const current = normalizeParameterDraft(error.detail.draft);
        setParams(current);
        setLastApplied(current);
        setDraftRevision(error.detail.revision);
      }
      setApplyState('error');
      setApplyMsg(error.message || 'Save failed');
      setApplying(false);
      return;
    }
    pushEvent(`Contract Size Updated → ${fmtContracts(p.contractSize)}`);
    pushEvent(`Stop Loss Updated → ${fmtDist(p.stopLoss)}`);
    pushEvent(`Take Profit Updated → ${fmtDist(p.takeProfit)}`);
    pushEvent(`Trailing Stop → ${p.trailingStop ? 'Enabled' : 'Disabled'}`);
    if (p.trailingStop) {
      pushEvent(`Trailing Distance Updated → ${fmtPoints(p.trailingDistance)}`);
      pushEvent(`Secure BE → ${p.secureBE ? 'Enabled' : 'Disabled'}`);
    }

    setApplyState('success');
    setApplyMsg('Saved');
    setApplying(false);
    setTimeout(() => setApplyState('idle'), 2500);
  }, [draftRevision]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`card tp-panel${dirty ? ' tp-panel--dirty' : ''}`}>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="tp-header">
        <h3 className="panel-title">Trade Parameters</h3>
        <span className={`tp-ws-badge tp-ws-badge--${wsStatus}`}>
          <span className="tp-ws-dot" />
          {wsStatus === 'connected'   ? 'Synced'
          : wsStatus === 'mock'       ? 'Mock'
          : wsStatus === 'connecting' ? '…'
          : 'Offline'}
        </span>
      </div>

      {dirty && (
        <div className="tp-dirty-banner">
          Unsaved changes — save to sync across devices
        </div>
      )}

      {loadError && (
        <div className="tp-load-error" role="alert">
          {loadError}
        </div>
      )}

      {/* ── Controls, grouped Entry / Risk / Trailing ───────────────── */}
      <div className="tp-controls">

        <div className="tp-section">
          <span className="tp-section-label">Entry</span>
          <ArrowControl
            label="Contract Size"
            display={`${params.contractSize} contract${params.contractSize !== 1 ? 's' : ''}`}
            onIncrease={() => adjust('contractSize',  1, 'Contract Size',  fmtContracts, 1)}
            onDecrease={() => adjust('contractSize', -1, 'Contract Size',  fmtContracts, 1)}
            disabled={applying}
            error={errors.contractSize}
          />
          <ArrowControl
            label="Spread (points)"
            display={fmtPoints(params.spreadPoints)}
            onIncrease={() => adjust('spreadPoints',  1, 'Spread', fmtPoints, 1)}
            onDecrease={() => adjust('spreadPoints', -1, 'Spread', fmtPoints, 1)}
            disabled={applying}
            error={errors.spreadPoints}
          />
        </div>

        <div className="tp-section">
          <span className="tp-section-label">Risk</span>
          <ArrowControl
            label="Take Profit ($)"
            display={fmtDist(params.takeProfit)}
            onIncrease={() => adjust('takeProfit',  DOLLAR_STEP, 'Take Profit', fmtDist, 1)}
            onDecrease={() => adjust('takeProfit', -DOLLAR_STEP, 'Take Profit', fmtDist, 1)}
            disabled={applying}
            error={errors.takeProfit}
          />
          <ArrowControl
            label="Stop Loss ($)"
            display={fmtDist(params.stopLoss)}
            onIncrease={() => adjust('stopLoss',  DOLLAR_STEP, 'Stop Loss', fmtDist, 1)}
            onDecrease={() => adjust('stopLoss', -DOLLAR_STEP, 'Stop Loss', fmtDist, 1)}
            disabled={applying}
            error={errors.stopLoss}
          />
        </div>

        <div className="tp-section">
          <span className="tp-section-label">Trailing</span>
          <div className="tp-row tp-row--toggle">
            <div className="tp-row-top">
              <span className="tp-label">Trailing Stop</span>
            </div>
            <button
              className={`tp-toggle ${params.trailingStop ? 'tp-toggle--on' : 'tp-toggle--off'}`}
              onClick={toggleTrailingStop}
              disabled={applying}
            >
              <span className="tp-toggle-track">
                <span className="tp-toggle-knob" />
              </span>
              <span className="tp-toggle-label">
                {params.trailingStop ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
          <ArrowControl
            label="Trailing Distance (points)"
            display={fmtPoints(params.trailingDistance)}
            onIncrease={() => adjust('trailingDistance',  TRAIL_STEP, 'Trailing Distance', fmtPoints, 1)}
            onDecrease={() => adjust('trailingDistance', -TRAIL_STEP, 'Trailing Distance', fmtPoints, 1)}
            disabled={applying || !params.trailingStop}
            error={errors.trailingDistance}
          />
          <div className="tp-row tp-row--toggle">
            <div className="tp-row-top">
              <span className="tp-label">Secure BE</span>
            </div>
            <button
              className={`tp-toggle ${params.secureBE ? 'tp-toggle--on' : 'tp-toggle--off'}`}
              onClick={toggleSecureBE}
              disabled={applying || !params.trailingStop}
              aria-label="Toggle Secure BE"
              title="Move the stop to breakeven on the first profitable NQ tick, then ratchet it with the trade"
            >
              <span className="tp-toggle-track">
                <span className="tp-toggle-knob" />
              </span>
              <span className="tp-toggle-label">
                {params.secureBE ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        </div>

      </div>

      {/* ── Action row: Make Default (secondary) + Confirm (primary) ────── */}
      <div className="tp-actions">
        <button
          className={`tp-apply tp-apply--${applyState}`}
          onClick={handleApply}
          disabled={applying || (!dirty && applyState === 'idle')}
          aria-label="Save parameters for all devices"
          title="Save these parameters as the server-authoritative draft without changing the armed bot"
        >
          {applying ? (
            <><span className="tp-spinner" aria-hidden="true" />Saving…</>
          ) : applyState === 'success' ? (
            <>✓ {applyMsg}</>
          ) : applyState === 'error' ? (
            <>⚠ {applyMsg}</>
          ) : (
            'Save Parameters'
          )}
        </button>
      </div>

    </div>
  );
}
