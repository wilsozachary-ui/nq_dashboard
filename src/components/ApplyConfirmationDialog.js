import './ApplyConfirmationDialog.css';

// Shared by AiSuggestedParametersPanel.js and AiInsightsTab.js -- the one
// UI surface allowed to persist an AI recommendation into saved Morning
// Strategy parameters. Purely presentational: all fetch/save logic lives
// in morningStrategyShared.js's useApplyRecommendationFlow, this only
// renders whatever that hook already computed and forwards the two button
// clicks. Never arms, disarms, starts, stops, or touches a trade -- the
// only side effect available from here is the parent's onConfirm, which
// itself only ever calls the parameter-save endpoint.
export default function ApplyConfirmationDialog({ diff, isArmed, confirming, error, loadFailed, onConfirm, onCancel }) {
  const changed = diff.filter(d => d.changed);

  return (
    <div className="acd-overlay" role="dialog" aria-modal="true" aria-label="Apply to Morning Strategy">
      <div className="acd-dialog">
        <h3 className="acd-title">Apply to Morning Strategy</h3>

        {changed.length > 0 ? (
          <ul className="acd-diff-list">
            {changed.map(d => (
              <li key={d.key} className="acd-diff-row">
                <span className="acd-diff-label">{d.label}</span>
                <span className="acd-diff-values">
                  <span className="acd-diff-from">{d.fmt(d.from)}</span>
                  <span className="acd-diff-arrow" aria-hidden="true">→</span>
                  <span className="acd-diff-to">{d.fmt(d.to)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="acd-note">No changes from the currently saved parameters.</p>
        )}

        <p className="acd-disclaimer">
          This updates your saved Morning Strategy parameters. It will not modify an active trade or the
          currently armed parameter snapshot.
        </p>

        {isArmed && (
          <p className="acd-armed-warning">
            Saved parameters will change, but the currently armed strategy will continue using its existing
            snapshot. Disarm and re-arm to use the new settings.
          </p>
        )}

        {loadFailed && (
          <p className="acd-error" role="alert">
            Could not confirm the current saved parameters before showing this diff -- Confirm may be rejected
            if they've changed elsewhere since.
          </p>
        )}

        {error && <p className="acd-error" role="alert">{error}</p>}

        <div className="acd-actions">
          <button type="button" className="acd-btn acd-btn--secondary" onClick={onCancel} disabled={confirming}>
            Cancel
          </button>
          <button
            type="button"
            className="acd-btn acd-btn--primary"
            onClick={onConfirm}
            disabled={confirming || changed.length === 0}
          >
            {confirming ? 'Saving…' : 'Confirm Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
