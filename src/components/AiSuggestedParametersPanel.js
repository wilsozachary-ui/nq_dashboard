import { useState, useEffect, useCallback } from 'react';
import { API_ROOT, USE_MOCK } from '../api/pnlApi';
import { integratedFetch } from '../CockpitIntegrator';
import './AiSuggestedParametersPanel.css';

const fmtPoints     = n => Number.isFinite(n) ? `${n} pt${n === 1 ? '' : 's'}` : '—';
const fmtDollars    = n => Number.isFinite(n) ? `$${Math.round(n)}` : '—';
const fmtContracts  = n => Number.isFinite(n) ? `${n}` : '—';
const fmtPct        = n => Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—';
const fmtRetainPct  = n => Number.isFinite(n) ? `${Math.round(n)}%` : '—';
const fmtBool       = v => v == null ? '—' : (v ? 'On' : 'Off');
const fmtSamples    = n => Number.isFinite(n) ? `${n} day${n === 1 ? '' : 's'}` : '—';

// Every recommended parameter this panel can show, in display order.
// `key` matches the API's "recommended_<key>" / parameter_reasons key;
// `currentKey` matches window.nqMorningStrategyParams' own field name
// (see parameterDraft.js's PARAMETER_DEFAULTS) so "current value" reads
// from the exact same source TradeParameterPanel.js itself uses.
const PARAMETERS = [
  { key: 'spread_points',          currentKey: 'spreadPoints',        label: 'Spread',              fmt: fmtPoints },
  { key: 'tp_dollars',             currentKey: 'takeProfit',          label: 'Take Profit',         fmt: fmtDollars },
  { key: 'sl_dollars',             currentKey: 'stopLoss',            label: 'Stop Loss',           fmt: fmtDollars },
  { key: 'trailing_enabled',       currentKey: 'trailingStop',        label: 'Trailing Enabled',    fmt: fmtBool },
  { key: 'trailing_points',        currentKey: 'trailingDistance',    label: 'Trailing Distance',   fmt: fmtPoints },
  { key: 'breakeven_dollars',      currentKey: 'breakevenTrigger',    label: 'Breakeven Trigger',   fmt: fmtDollars },
  { key: 'profit_lock_dollars',    currentKey: 'profitLockTrigger',   label: 'Profit Lock Trigger', fmt: fmtDollars },
  { key: 'profit_lock_retain_pct', currentKey: 'profitLockRetainPct', label: 'Profit Lock Retain',  fmt: fmtRetainPct },
  { key: 'contract_size',          currentKey: 'contractSize',        label: 'Contract Size',       fmt: fmtContracts },
];

// Advisory only -- this panel never talks to the bot directly. "Apply"
// dispatches the same nq:strategy-params-sync event TradeParameterPanel.js
// already listens for (its "sync from StrategyControlBar quick-adjustments"
// handler), so the AI's numbers land in the exact editable inputs the user
// arms/fires from -- they can still change any value by hand afterward, and
// nothing here ever saves or arms on its own.
function applyToTradeParameters(rec) {
  window.dispatchEvent(new CustomEvent('nq:strategy-params-sync', {
    detail: {
      spreadPoints:        rec.recommended_spread_points,
      takeProfit:          rec.recommended_tp_dollars,
      stopLoss:            rec.recommended_sl_dollars,
      trailingDistance:    rec.recommended_trailing_points,
      trailingStop:        rec.recommended_trailing_enabled,
      contractSize:        rec.recommended_contract_size,
      breakevenTrigger:    rec.recommended_breakeven_dollars,
      profitLockTrigger:   rec.recommended_profit_lock_dollars,
      profitLockRetainPct: rec.recommended_profit_lock_retain_pct,
    },
  }));
}

// window.nqMorningStrategyParams (set by TradeParameterPanel.js) is the
// single existing source of "what's currently configured" -- reading it
// directly (plus its companion event for live updates) means "current
// value" here can never drift from what the Trade Parameters form actually
// shows, without introducing a second parallel state store.
function useCurrentTradeParameters() {
  const [current, setCurrent] = useState(() => window.nqMorningStrategyParams || null);
  useEffect(() => {
    const handler = e => setCurrent(e.detail);
    window.addEventListener('nq:morning-strategy-params', handler);
    return () => window.removeEventListener('nq:morning-strategy-params', handler);
  }, []);
  return current;
}

function ParameterRow({ config, rec, current }) {
  const suggested = rec[`recommended_${config.key}`];
  const currentValue = current ? current[config.currentKey] : undefined;
  const reason = rec.parameter_reasons ? rec.parameter_reasons[config.key] : null;
  // Matched against the exact phrases morning_strategy_ai.py's reason
  // strings use for each evidence kind (see generate_recommendations'
  // "never mix actual and simulated" labeling) -- deliberately not an
  // else-branch/exclusion check, since a reason that's neither (e.g.
  // trailing_enabled's static default-on note) must show no badge at all
  // rather than being misclassified as "Actual."
  const isSimulated = typeof reason === 'string' && reason.toLowerCase().startsWith('simulated replay');
  const isActual = typeof reason === 'string' && reason.toLowerCase().startsWith('based on actual closed trades');

  return (
    <div className="ai-param-row">
      <div className="ai-param-row-top">
        <span className="ai-param-label">{config.label}</span>
        {isSimulated && (
          <span
            className="ai-param-badge ai-param-badge--sim"
            title="Derived from a simulated replay of recorded tick data, not an actual trade outcome"
          >Simulated</span>
        )}
        {isActual && (
          <span
            className="ai-param-badge ai-param-badge--actual"
            title="Derived from actual closed-trade outcomes"
          >Actual</span>
        )}
      </div>
      <div className="ai-param-row-values">
        <div className="ai-param-value-block">
          <span className="ai-param-value-label">Suggested</span>
          <span className="ai-param-value ai-param-value--suggested">{config.fmt(suggested)}</span>
        </div>
        <div className="ai-param-value-block">
          <span className="ai-param-value-label">Current</span>
          <span className="ai-param-value">{current ? config.fmt(currentValue) : '—'}</span>
        </div>
      </div>
      {reason && <p className="ai-param-reason">{reason}</p>}
    </div>
  );
}

export default function AiSuggestedParametersPanel() {
  const [rec, setRec]       = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [applied, setApplied] = useState(false);
  const current = useCurrentTradeParameters();

  const load = useCallback(() => {
    if (USE_MOCK) { setStatus('error'); return; }
    setStatus('loading');
    integratedFetch(`${API_ROOT}/morning_strategy/ai/recommendations`, {}, { startup: true })
      .then(r => r.json())
      .then(envelope => {
        const data = envelope && envelope.data ? envelope.data : envelope;
        if (!data || typeof data.recommended_spread_points !== 'number') {
          setStatus('error');
          return;
        }
        setRec(data);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApply = () => {
    if (!rec) return;
    applyToTradeParameters(rec);
    setApplied(true);
    setTimeout(() => setApplied(false), 2500);
  };

  return (
    <div className="card ai-panel">
      <div className="ai-header">
        <h3 className="panel-title">AI Suggested Parameters</h3>
        <button
          className="ai-refresh"
          onClick={load}
          disabled={status === 'loading'}
          aria-label="Refresh AI recommendation"
          title="Refresh"
        >⟳</button>
      </div>

      {status === 'loading' && !rec && (
        <div className="ai-empty">Analyzing recent candles…</div>
      )}
      {status === 'error' && !rec && (
        <div className="ai-empty ai-empty--error">AI recommendations unavailable right now.</div>
      )}

      {rec && (
        <>
          {rec.summary && <p className="ai-summary">{rec.summary}</p>}

          <div className="ai-meta-row">
            <span className="ai-meta-item">Confidence: <strong>{fmtPct(rec.confidence)}</strong></span>
            <span className="ai-meta-item">Sample: <strong>{fmtSamples(rec.sample_count)}</strong></span>
            <span className="ai-meta-item">Comparable: <strong>{fmtSamples(rec.comparable_day_count)}</strong></span>
          </div>

          {rec.data_quality_warning && (
            <div className="ai-warning">⚠️ {rec.data_quality_warning}</div>
          )}

          <div className="ai-param-list">
            {PARAMETERS.map(config => (
              <ParameterRow key={config.key} config={config} rec={rec} current={current} />
            ))}
          </div>

          <button
            className={`ai-apply${applied ? ' ai-apply--applied' : ''}`}
            onClick={handleApply}
            aria-label="Apply AI-suggested values to Trade Parameters"
          >
            {applied ? '✓ Applied to Trade Parameters' : 'Apply to Morning Strategy Settings'}
          </button>
          <div className="ai-disclaimer">
            Advisory only — copies values into Trade Parameters below for review. Nothing is placed or armed automatically; review, save, and arm by hand afterward.
          </div>
        </>
      )}
    </div>
  );
}
