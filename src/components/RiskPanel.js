import { useState, useEffect, useRef, useCallback } from 'react';
import botApi from '../services/botApi';
import useWebSocket from '../hooks/useWebSocket';
import { emitCritical, resolveWarning } from '../utils/errorBus';
import './RiskPanel.css';

// ── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_PARAMS = {
  contractSize: 1, stopLoss: 20430, takeProfit: 20500,
  trailingStopEnabled: false, trailingDistance: 20,
};

const DEFAULT_RISK = {
  maxDailyLoss: 500, maxDailyTrades: 10, maxConsecutiveLosses: 3,
  currentLoss: 0, currentTrades: 0, currentConsecutiveLosses: 0,
  riskStatus: 'normal', killSwitchArmed: true, killSwitchActive: false,
};

// Point value per contract (NQ = $20/pt, MNQ = $2/pt)
const POINT_VALUE = { NQ: 20, MNQ: 2 };

// ── Arrow button ──────────────────────────────────────────────────────────────
function ArrowBtn({ onUp, onDown, value, label, fmt = v => v }) {
  return (
    <div className="rpn-adj-row">
      <span className="rpn-adj-label">{label}</span>
      <button className="rpn-adj-btn" onClick={onDown} aria-label={`Decrease ${label}`}>−</button>
      <span className="rpn-adj-val">{fmt(value)}</span>
      <button className="rpn-adj-btn" onClick={onUp}   aria-label={`Increase ${label}`}>+</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function RiskPanel({ apiPrefix = '' }) {
  const symbol    = apiPrefix === '/orb' ? 'MNQ' : 'NQ';
  const ptValue   = POINT_VALUE[symbol];
  const ptStep    = symbol === 'MNQ' ? 0.25 : 0.25;

  const [params,  setParams]  = useState(DEFAULT_PARAMS);
  const [risk,    setRisk]    = useState(DEFAULT_RISK);
  const [price,   setPrice]   = useState(null);
  const [ksArmed, setKsArmed] = useState(false); // armed = waiting for confirm
  const [loading, setLoading] = useState(false);

  const debounceTimer = useRef(null);

  // ── Fetch parameters ──────────────────────────────────────────────────────
  const loadParams = useCallback(async () => {
    try {
      const [contractResp, trailingResp, snapshotResp] = await Promise.all([
        botApi.getContract().catch(() => null),
        botApi.getTrailingStatus().catch(() => null),
        botApi.getTestbotSnapshot().catch(() => null),
      ]);
      if (contractResp || trailingResp) {
        setParams(p => ({
          ...p,
          contractSize: contractResp?.contractSize ?? contractResp?.qty ?? p.contractSize,
          stopLoss: trailingResp?.stopLoss ?? p.stopLoss,
          takeProfit: trailingResp?.takeProfit ?? p.takeProfit,
          trailingStopEnabled: trailingResp?.enabled ?? p.trailingStopEnabled,
          trailingDistance: trailingResp?.distance ?? p.trailingDistance,
        }));
      }
      if (snapshotResp) {
        setRisk(r => ({
          ...r,
          maxDailyLoss: snapshotResp.maxDailyLoss ?? r.maxDailyLoss,
          maxDailyTrades: snapshotResp.maxDailyTrades ?? r.maxDailyTrades,
          maxConsecutiveLosses: snapshotResp.maxConsecutiveLosses ?? r.maxConsecutiveLosses,
          currentLoss: snapshotResp.currentLoss ?? snapshotResp.dailyLoss ?? r.currentLoss,
          currentTrades: snapshotResp.currentTrades ?? snapshotResp.tradeCount ?? r.currentTrades,
          currentConsecutiveLosses: snapshotResp.currentConsecutiveLosses ?? r.currentConsecutiveLosses,
          riskStatus: snapshotResp.riskStatus ?? r.riskStatus,
        }));
      }
    } catch {}
  }, []);

  useEffect(() => { loadParams(); }, [loadParams]);

  // ── Real-time risk updates ────────────────────────────────────────────────
  useEffect(() => {
    const handler = event => { const msg = event.detail; if (msg.type === 'risk_update') setRisk(r => ({ ...r, ...msg })); };
    window.addEventListener('nq:integrated-risk', handler);
    return () => window.removeEventListener('nq:integrated-risk', handler);
  }, []);

  // ── Current price — same live price stream LiveTicker.js consumes ────────
  const { lastMessage: priceMessage } = useWebSocket({ autoConnect: true });
  useEffect(() => {
    const lp = priceMessage?.price;
    if (lp != null) setPrice(symbol === 'MNQ' ? lp / 10 : lp);
  }, [priceMessage, symbol]);

  // ── Derived metrics ───────────────────────────────────────────────────────
  const slDist  = price != null ? Math.abs(price - params.stopLoss)   : null;
  const tpDist  = price != null ? Math.abs(params.takeProfit - price) : null;
  const rr      = slDist && tpDist && slDist > 0 ? (tpDist / slDist).toFixed(2) : '—';
  const exposure = slDist != null ? (slDist * params.contractSize * ptValue).toFixed(0) : '—';

  // ── Debounced save for parameter changes ──────────────────────────────────
  const saveParams = useCallback((next) => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      try { await botApi.getTrailingUpdate(); }
      catch {}
    }, 500);
  }, []);

  const adjustParam = (key, delta) => {
    setParams(p => {
      const next = { ...p, [key]: Math.round((p[key] + delta) * 100) / 100 };
      saveParams(next);
      return next;
    });
  };

  // ── Kill switch ───────────────────────────────────────────────────────────
  const handleKillSwitch = useCallback(async () => {
    if (!ksArmed) { setKsArmed(true); return; }
    setKsArmed(false);
    setLoading(true);
    try {
      const d = await botApi.postFlattenOrder({});
      if (d) {
        setRisk(rv => ({ ...rv, killSwitchActive: d.active ?? true }));
        if (d.active) emitCritical(`${symbol} Kill switch triggered`, 'rpn');
      }
    } catch {
      emitCritical('Kill switch command failed — check connection', 'rpn');
    } finally { setLoading(false); }
  }, [ksArmed, apiPrefix, symbol]);

  const handleReset = useCallback(async () => {
    try {
      await botApi.postTestbotStart({});
      setRisk(rv => ({ ...rv, killSwitchActive: false })); resolveWarning('rpn');
    } catch {}
  }, []);

  // Disarm on outside click
  useEffect(() => {
    if (!ksArmed) return;
    const h = () => setKsArmed(false);
    const t = setTimeout(h, 4_000);
    return () => clearTimeout(t);
  }, [ksArmed]);

  // ── Formatters ─────────────────────────────────────────────────────────────
  const fmtP  = v => v != null ? v.toFixed(2) : '—';
  const fmtPt = v => v != null ? v.toFixed(2) + ' pt' : '—';
  const fmtDollar = v => v !== '—' ? `$${Number(v).toLocaleString()}` : '—';

  const pct = (v, max) => Math.min(100, max > 0 ? (v / max) * 100 : 0);
  const lossColor = pct(risk.currentLoss, risk.maxDailyLoss) > 70 ? 'rpn-bar--red' :
                    pct(risk.currentLoss, risk.maxDailyLoss) > 40 ? 'rpn-bar--amber' : 'rpn-bar--green';

  return (
    <div className="card rpn-panel rcp-panel">

      {/* ── Section 1: Controls ─────────────────────────────────────────── */}
      <div className="rpn-section">
        <span className="rpn-section-title panel-title">Risk Controls · {symbol}</span>

        {/* Trailing stop toggle */}
        <label className="rpn-toggle-row">
          <input
            type="checkbox"
            checked={params.trailingStopEnabled}
            onChange={e => {
              const next = { ...params, trailingStopEnabled: e.target.checked };
              setParams(next); saveParams(next);
            }}
            className="rpn-toggle-checkbox"
          />
          <span className="rpn-toggle-label">Trailing Stop</span>
          {params.trailingStopEnabled && (
            <span className="rpn-toggle-meta">{params.trailingDistance} pts</span>
          )}
        </label>

        {/* Contract size */}
        <ArrowBtn
          label="Contracts"
          value={params.contractSize}
          onUp={()   => adjustParam('contractSize', 1)}
          onDown={() => adjustParam('contractSize', Math.max(1, params.contractSize - 1) - params.contractSize)}
          fmt={v => `${v} ct`}
        />

        {/* Stop Loss */}
        <ArrowBtn
          label="Stop Loss"
          value={params.stopLoss}
          onUp={()   => adjustParam('stopLoss', ptStep)}
          onDown={() => adjustParam('stopLoss', -ptStep)}
          fmt={fmtP}
        />

        {/* Take Profit */}
        <ArrowBtn
          label="Take Profit"
          value={params.takeProfit}
          onUp={()   => adjustParam('takeProfit', ptStep)}
          onDown={() => adjustParam('takeProfit', -ptStep)}
          fmt={fmtP}
        />
      </div>

      {/* ── Section 2: Metrics ──────────────────────────────────────────── */}
      <div className="rpn-section rpn-section--metrics">
        <span className="rpn-section-title panel-title">Risk Metrics</span>

        <div className="rpn-metric-grid">
          <div className="rpn-metric">
            <span className="rpn-metric-lbl">SL Dist</span>
            <span className="rpn-metric-val rpn-val--red">{fmtPt(slDist)}</span>
          </div>
          <div className="rpn-metric">
            <span className="rpn-metric-lbl">TP Dist</span>
            <span className="rpn-metric-val rpn-val--green">{fmtPt(tpDist)}</span>
          </div>
          <div className="rpn-metric">
            <span className="rpn-metric-lbl">R : R</span>
            <span className={`rpn-metric-val${rr !== '—' && Number(rr) >= 2 ? ' rpn-val--green' : rr !== '—' && Number(rr) < 1 ? ' rpn-val--red' : ''}`}>
              1 : {rr}
            </span>
          </div>
          <div className="rpn-metric">
            <span className="rpn-metric-lbl">Exposure</span>
            <span className="rpn-metric-val">{fmtDollar(exposure)}</span>
          </div>
        </div>

        {/* Daily loss bar */}
        <div className="rpn-bar-row">
          <div className="rpn-bar-label">
            <span>Daily Loss</span>
            <span className="rpn-bar-nums">
              ${risk.currentLoss.toFixed(0)} / ${risk.maxDailyLoss}
            </span>
          </div>
          <div className="rpn-bar-track">
            <div
              className={`rpn-bar-fill ${lossColor}`}
              style={{ width: `${pct(risk.currentLoss, risk.maxDailyLoss)}%` }}
            />
          </div>
        </div>

        {/* Trades today */}
        <div className="rpn-bar-row">
          <div className="rpn-bar-label">
            <span>Trades Today</span>
            <span className="rpn-bar-nums">
              {risk.currentTrades} / {risk.maxDailyTrades}
            </span>
          </div>
          <div className="rpn-bar-track">
            <div
              className={`rpn-bar-fill${pct(risk.currentTrades, risk.maxDailyTrades) > 80 ? ' rpn-bar--red' : ' rpn-bar--green'}`}
              style={{ width: `${pct(risk.currentTrades, risk.maxDailyTrades)}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Section 3: Kill Switch ──────────────────────────────────────── */}
      <div className={`rpn-section rpn-section--ks${risk.killSwitchActive ? ' rpn-ks--active' : ''}`}>
        <div className="rpn-ks-header">
          <span className="rpn-section-title panel-title">Kill Switch</span>
          <span className={`rpn-ks-status${risk.killSwitchActive ? ' rpn-ks-status--triggered' : ' rpn-ks-status--armed'}`}>
            {risk.killSwitchActive ? '● TRIGGERED' : '○ ARMED'}
          </span>
        </div>

        {risk.killSwitchActive ? (
          <button className="rpn-ks-btn rpn-ks-btn--reset" onClick={handleReset} disabled={loading}>
            RESET KILL SWITCH
          </button>
        ) : (
          <button
            className={`rpn-ks-btn${ksArmed ? ' rpn-ks-btn--confirm' : ' rpn-ks-btn--prime'}`}
            onClick={handleKillSwitch}
            disabled={loading}
          >
            {ksArmed ? '⚠ CONFIRM KILL' : 'TRIGGER KILL'}
          </button>
        )}

        {ksArmed && (
          <span className="rpn-ks-warning">Click again to confirm — disarms in 4s</span>
        )}
      </div>

    </div>
  );
}
