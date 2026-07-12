import { useState, useEffect, useCallback } from 'react';
import { API_ROOT, USE_MOCK } from '../api/pnlApi';
import { integratedFetch } from '../CockpitIntegrator';
import './AiSuggestedParametersPanel.css';

const fmtPoints   = n => Number.isFinite(n) ? `${n} pt${n === 1 ? '' : 's'}` : '—';
const fmtDollars  = n => Number.isFinite(n) ? `$${Math.round(n)}` : '—';
const fmtContracts = n => Number.isFinite(n) ? `${n}` : '—';
const fmtPct      = n => Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—';

// Advisory only -- this panel never talks to the bot directly. "Apply"
// dispatches the same nq:strategy-params-sync event TradeParameterPanel.js
// already listens for (its "sync from StrategyControlBar quick-adjustments"
// handler), so the AI's numbers land in the exact editable inputs the user
// arms/fires from -- they can still change any value by hand afterward.
function applyToTradeParameters(rec) {
  window.dispatchEvent(new CustomEvent('nq:strategy-params-sync', {
    detail: {
      spreadPoints:     rec.recommended_spread_points,
      takeProfit:       rec.recommended_tp_dollars,
      stopLoss:         rec.recommended_sl_dollars,
      trailingDistance: rec.recommended_trailing_points,
      contractSize:     rec.recommended_contract_size,
    },
  }));
}

export default function AiSuggestedParametersPanel() {
  const [rec, setRec]       = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [applied, setApplied] = useState(false);

  const load = useCallback(() => {
    if (USE_MOCK) { setStatus('error'); return; }
    setStatus('loading');
    integratedFetch(`${API_ROOT}/morning_strategy/ai/recommendations`)
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
          <div className="ai-grid">
            <div className="ai-stat">
              <span className="ai-stat-label">Spread</span>
              <span className="ai-stat-value">{fmtPoints(rec.recommended_spread_points)}</span>
            </div>
            <div className="ai-stat">
              <span className="ai-stat-label">Take Profit</span>
              <span className="ai-stat-value">{fmtDollars(rec.recommended_tp_dollars)}</span>
            </div>
            <div className="ai-stat">
              <span className="ai-stat-label">Stop Loss</span>
              <span className="ai-stat-value">{fmtDollars(rec.recommended_sl_dollars)}</span>
            </div>
            <div className="ai-stat">
              <span className="ai-stat-label">Trailing</span>
              <span className="ai-stat-value">{fmtPoints(rec.recommended_trailing_points)}</span>
            </div>
            <div className="ai-stat">
              <span className="ai-stat-label">Contract Size</span>
              <span className="ai-stat-value">{fmtContracts(rec.recommended_contract_size)}</span>
            </div>
            <div className="ai-stat">
              <span className="ai-stat-label">Confidence</span>
              <span className="ai-stat-value">{fmtPct(rec.confidence)}</span>
            </div>
          </div>

          {rec.basis && rec.basis.notes && (
            <div className="ai-notes">{rec.basis.notes}</div>
          )}

          <button
            className={`ai-apply${applied ? ' ai-apply--applied' : ''}`}
            onClick={handleApply}
            aria-label="Apply AI-suggested values to Trade Parameters"
          >
            {applied ? '✓ Applied to Trade Parameters' : 'Apply to Morning Strategy Settings'}
          </button>
          <div className="ai-disclaimer">
            Advisory only — copies values into Trade Parameters below for review. Nothing is placed or armed automatically.
          </div>
        </>
      )}
    </div>
  );
}
