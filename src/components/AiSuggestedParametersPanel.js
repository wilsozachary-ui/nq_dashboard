import { useState, useEffect, useCallback } from 'react';
import { API_ROOT, USE_MOCK } from '../api/pnlApi';
import { integratedFetch } from '../CockpitIntegrator';
import {
  AI_PARAMETERS as PARAMETERS,
  useApplyRecommendationFlow,
  fmtPct,
  fmtSamples,
  fmtPoints,
  fmtDollars,
} from './morningStrategyShared';
import ApplyConfirmationDialog from './ApplyConfirmationDialog';
import './AiSuggestedParametersPanel.css';

function fmtRatio(n) {
  return Number.isFinite(n) ? `${n.toFixed(2)}:1` : '—';
}

// Client-side backstop only -- morning_strategy_ai.py's
// _evaluate_spread_candidate is what actually guarantees SL/TP can never
// violate these by construction. This just makes a violation impossible to
// miss in the UI if one ever slipped through.
const MINIMUM_REWARD_RISK = 1.5;
function violatesRiskConstraints(rec) {
  if (!rec || rec.action === 'skip') return false;
  const { recommended_sl_dollars: sl, recommended_tp_dollars: tp, reward_risk_ratio: rr } = rec;
  if (!Number.isFinite(sl) || !Number.isFinite(tp)) return false;
  return tp < sl || (Number.isFinite(rr) && rr < MINIMUM_REWARD_RISK);
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

// Section order, matching TradeParameterPanel.js's own Entry/Risk/Trailing
// grouping -- driven from AI_PARAMETERS' own `section` field so the two
// stay in sync automatically rather than duplicating an order here.
const SECTION_ORDER = ['Entry', 'Risk', 'Trailing'];

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
  // Still-on-baseline rows (no real evidence yet) are the majority early on
  // and read nearly identically to each other -- muting them visually lets
  // the eye land on rows that carry an actual suggestion first.
  const isInsufficientEvidence = typeof reason === 'string' && reason.toLowerCase().startsWith('insufficient evidence');

  return (
    <div className={`ai-param-row${isInsufficientEvidence ? ' ai-param-row--muted' : ''}`}>
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
  const [showDetails, setShowDetails] = useState(false);
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

  const isSkip = rec?.action === 'skip';
  const constraintViolation = violatesRiskConstraints(rec);
  const applyFlow = useApplyRecommendationFlow(rec);

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
          <div className="ai-meta-row">
            <span className={`ai-action-badge ai-action-badge--${isSkip ? 'skip' : 'trade'}`}>
              {isSkip ? 'SKIP' : 'TRADE'}
            </span>
            <span className="ai-meta-item">Confidence: <strong>{fmtPct(rec.confidence)}</strong></span>
          </div>

          {/* The primary view: just the recommended numbers and one line of
              why. Everything else (per-parameter current-vs-suggested,
              evidence badges, sample counts) is real but secondary --
              tucked behind "View details" rather than forced on every
              reader every time. */}
          {isSkip ? (
            <div className="ai-headline ai-headline--skip">Skip this setup</div>
          ) : (
            <div className="ai-headline">
              Spread {fmtPoints(rec.recommended_spread_points)} · TP {fmtDollars(rec.recommended_tp_dollars)} · SL{' '}
              {fmtDollars(rec.recommended_sl_dollars)} · Trail {fmtPoints(rec.recommended_trailing_points)} ·{' '}
              {rec.recommended_contract_size} contract{rec.recommended_contract_size === 1 ? '' : 's'}
            </div>
          )}

          {(rec.summary || rec.skip_reason) && (
            <p className="ai-summary">{isSkip ? rec.skip_reason : rec.summary}</p>
          )}

          {rec.data_quality_warning && (
            <div className="ai-warning">⚠️ {rec.data_quality_warning}</div>
          )}
          {constraintViolation && (
            <div className="ai-warning ai-warning--critical">
              ⚠️ This recommendation appears to violate the configured risk constraints — do not apply until reviewed.
            </div>
          )}

          <button
            type="button"
            className="ai-details-toggle"
            onClick={() => setShowDetails(v => !v)}
            aria-expanded={showDetails}
          >
            {showDetails ? 'Hide details' : 'View details'}
          </button>

          {showDetails && (
            <>
              <div className="ai-meta-row ai-meta-row--details">
                <span className="ai-meta-item">Sample: <strong>{fmtSamples(rec.sample_count)}</strong></span>
                <span className="ai-meta-item">Comparable: <strong>{fmtSamples(rec.comparable_day_count)}</strong></span>
                {!isSkip && Number.isFinite(rec.reward_risk_ratio) && (
                  <span className="ai-meta-item">R:R: <strong>{fmtRatio(rec.reward_risk_ratio)}</strong></span>
                )}
                {!isSkip && Number.isFinite(rec.both_sides_triggered_rate) && (
                  <span className="ai-meta-item">Both-Sides-Crossed: <strong>{fmtPct(rec.both_sides_triggered_rate)}</strong></span>
                )}
                {!isSkip && Number.isFinite(rec.continuation_rate) && (
                  <span className="ai-meta-item">Continuation: <strong>{fmtPct(rec.continuation_rate)}</strong></span>
                )}
              </div>

              <div className="ai-param-list">
                {SECTION_ORDER.map(section => (
                  <div key={section} className="ai-param-section">
                    <span className="ai-param-section-label">{section}</span>
                    {PARAMETERS.filter(config => config.section === section).map(config => (
                      <ParameterRow key={config.key} config={config} rec={rec} current={current} />
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}

          <button
            className={`ai-apply${applyFlow.applied ? ' ai-apply--applied' : ''}`}
            onClick={applyFlow.openDialog}
            disabled={isSkip}
            aria-label="Apply to Morning Strategy"
            title={isSkip ? 'No trade is recommended this session — nothing to apply' : undefined}
          >
            {isSkip ? 'Apply disabled — no trade recommended' : (applyFlow.applied ? '✓ Saved' : 'Apply to Morning Strategy')}
          </button>
          <div className="ai-disclaimer">
            Advisory only — saved parameters only change after you review and confirm the diff below. Nothing is
            placed, armed, or modified on an active trade automatically.
          </div>
        </>
      )}

      {applyFlow.dialog && (
        <ApplyConfirmationDialog
          diff={applyFlow.dialog.diff}
          isArmed={applyFlow.isArmed}
          confirming={applyFlow.confirming}
          error={applyFlow.error}
          loadFailed={applyFlow.dialog.loadFailed}
          onConfirm={applyFlow.confirmApply}
          onCancel={applyFlow.closeDialog}
        />
      )}
    </div>
  );
}
