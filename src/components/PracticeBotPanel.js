import { useState, useRef } from 'react';
import botApi from '../services/botApi';
import {
  StatusPill, Spinner, useTestBotSnapshot, useMorningStrategyParams,
  useSelectedAccounts, resolveSinglePracticeAccount,
} from './morningStrategyShared';
import { armPayloadFromDraft } from './parameterDraft';
import './PracticeBotPanel.css';

// Diagnostic-only panel: fires the Morning Strategy's exact currently-set
// parameters immediately, on command, against the practice account only --
// built to reproduce/verify the 2026-07-20 silent-fill-dispatch incident
// without waiting for tomorrow's 08:30 CT window or touching real money.
// Deliberately separate from MorningStrategyPracticeBotControl (kept
// hidden elsewhere in this tab) -- this is meant to be small, temporary,
// and removed once the bug is confirmed fixed.
export default function PracticeBotPanel() {
  const [busy, setBusy] = useState(null); // null | 'firing' | 'stopping'
  const [message, setMessage] = useState(null);

  const snapshot = useTestBotSnapshot('practice');
  const paramsRef = useMorningStrategyParams();
  const { accounts: selectedAccounts } = useSelectedAccounts();
  const practiceSelection = resolveSinglePracticeAccount(selectedAccounts);
  const accountId = practiceSelection.account
    ? practiceSelection.account.account_id ?? practiceSelection.account.id
    : null;
  const firingRef = useRef(false);

  if (!snapshot._snapshotMeta?.loaded) {
    return (
      <div className="card pbp-panel">
        <div className="pbp-header">
          <h3 className="panel-title">Practice Bot</h3>
        </div>
        <div className="pbp-loading"><Spinner /> Checking bot status…</div>
      </div>
    );
  }

  const status = snapshot.status || 'OFF';
  const on = status === 'ARMED' || status === 'ACTIVE';

  const fire = async () => {
    if (firingRef.current || !accountId) return;
    firingRef.current = true;
    setBusy('firing');
    setMessage(null);
    try {
      const p = paramsRef.current || {};
      // Keep the diagnostic Practice Bot on the exact same parameter
      // conversion path as Morning Strategy Live. This is especially
      // important for derived settings such as Secure BE, where the
      // first-profitable-tick dollar threshold depends on contract size.
      const {
        account_ids: _accountIds,
        expected_arm_revision: _expectedArmRevision,
        ...strategyParams
      } = armPayloadFromDraft(p, [accountId]);
      const result = await botApi.startPracticeBot({
        account_id: accountId,
        ...strategyParams,
      });
      setMessage(result.ok
        ? { text: `Fired at ${new Date().toLocaleTimeString()}`, kind: 'success' }
        : { text: result.error?.message || 'Failed to start', kind: 'error' });
    } catch (err) {
      setMessage({ text: err.message || 'Failed to start', kind: 'error' });
    } finally {
      setBusy(null);
      firingRef.current = false;
    }
  };

  const off = async () => {
    setBusy('stopping');
    setMessage(null);
    try {
      const result = await botApi.stopPracticeBot();
      setMessage(result.ok
        ? { text: 'Stopped — orders canceled, position flattened', kind: 'success' }
        : { text: result.error?.message || 'Stop failed', kind: 'error' });
    } catch (err) {
      setMessage({ text: err.message || 'Stop failed', kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const fireDisabled = busy !== null || on || !accountId;
  const offDisabled = busy !== null || !on;

  return (
    <div className="card pbp-panel">
      <div className="pbp-header">
        <h3 className="panel-title">Practice Bot</h3>
        <StatusPill status={status} />
      </div>
      <p className="pbp-sub">
        {accountId
          ? 'Fires the current Morning Strategy parameters immediately, practice account only.'
          : 'Select a practice account to fire.'}
      </p>
      <div className="pbp-buttons">
        <button className="pbp-btn pbp-btn--fire" onClick={fire} disabled={fireDisabled}>
          {busy === 'firing' ? <Spinner /> : 'FIRE'}
        </button>
        <button className="pbp-btn pbp-btn--off" onClick={off} disabled={offDisabled}>
          {busy === 'stopping' ? <Spinner /> : 'OFF'}
        </button>
      </div>
      {message && <div className={`pbp-message pbp-message--${message.kind}`}>{message.text}</div>}
    </div>
  );
}
