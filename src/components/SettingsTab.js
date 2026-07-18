import { useEffect, useState } from 'react';
import { cpGet, cpPost } from '../services/controlPlaneApi';
import './SettingsTab.css';

export default function SettingsTab() {
  const [email, setEmail] = useState(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookLoading, setWebhookLoading] = useState(true);
  const [webhookError, setWebhookError] = useState(null);
  const [webhookSuccess, setWebhookSuccess] = useState(false);
  const [webhookBusy, setWebhookBusy] = useState(false);

  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const [showCredentialsForm, setShowCredentialsForm] = useState(false);
  const [topstepUsername, setTopstepUsername] = useState('');
  const [topstepApiKey, setTopstepApiKey] = useState('');
  const [credsError, setCredsError] = useState(null);
  const [credsSuccess, setCredsSuccess] = useState(null);
  const [credsBusy, setCredsBusy] = useState(false);

  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(false);
  const [emailAlertsLoading, setEmailAlertsLoading] = useState(true);
  const [emailAlertsError, setEmailAlertsError] = useState(null);
  const [emailAlertsBusy, setEmailAlertsBusy] = useState(false);

  useEffect(() => {
    cpGet('/me').then(me => setEmail(me.email)).catch(() => {});
    cpGet('/credentials')
      .then(res => {
        setWebhookUrl(res.discord_webhook_url || '');
        setEmailAlertsEnabled(!!res.email_alerts_enabled);
        setCredentialsSaved(!!res.saved);
      })
      .catch(() => {})
      .finally(() => {
        setWebhookLoading(false);
        setEmailAlertsLoading(false);
      });
  }, []);

  async function handleChangePassword(e) {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    if (newPassword !== confirmPassword) {
      setPwError('New password and confirmation do not match.');
      return;
    }
    setPwBusy(true);
    try {
      await cpPost('/auth/change-password', { current_password: currentPassword, new_password: newPassword });
      setPwSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwBusy(false);
    }
  }

  async function handleSaveWebhook(e) {
    e.preventDefault();
    setWebhookError(null);
    setWebhookSuccess(false);
    setWebhookBusy(true);
    try {
      await cpPost('/credentials/discord-webhook', { discord_webhook_url: webhookUrl.trim() || null });
      setWebhookSuccess(true);
    } catch (err) {
      setWebhookError(err.message);
    } finally {
      setWebhookBusy(false);
    }
  }

  async function handleSaveCredentials(e) {
    e.preventDefault();
    setCredsError(null);
    setCredsSuccess(null);
    setCredsBusy(true);
    try {
      const result = await cpPost('/credentials', {
        topstep_username: topstepUsername.trim(),
        topstep_api_key: topstepApiKey.trim(),
        // Echoed back unchanged so rotating the API key doesn't wipe an
        // already-configured Discord webhook -- POST /credentials replaces
        // all three fields together, it doesn't merge (see save_credentials).
        discord_webhook_url: webhookUrl.trim() || null,
      });
      setCredentialsSaved(true);
      setTopstepUsername('');
      setTopstepApiKey('');
      setShowCredentialsForm(false);
      setCredsSuccess(
        result.push_status === 'deferred_protected_window'
          ? 'API key saved. Your bot is in a protected trading window right now, so this will take effect on its next restart rather than immediately.'
          : 'API key updated.'
      );
    } catch (err) {
      setCredsError(err.message);
    } finally {
      setCredsBusy(false);
    }
  }

  async function handleToggleEmailAlerts() {
    const next = !emailAlertsEnabled;
    setEmailAlertsError(null);
    setEmailAlertsBusy(true);
    try {
      await cpPost('/credentials/email-alerts', { email_alerts_enabled: next });
      setEmailAlertsEnabled(next);
    } catch (err) {
      setEmailAlertsError(err.message);
    } finally {
      setEmailAlertsBusy(false);
    }
  }

  return (
    <div className="tab-single-col set-tab">
      <div className="card set-card">
        <div className="set-card-header">
          <div>
            <div className="panel-title">Login</div>
            <p className="set-card-subtitle">Your account credentials for nq-cloud.com.</p>
          </div>
        </div>
        {email && <p className="set-email">Signed in as {email}</p>}

        <form onSubmit={handleChangePassword} className="set-form">
          <label className="set-label">
            Current password
            <input
              type="password"
              className="set-input"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="set-label">
            New password
            <input
              type="password"
              className="set-input"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label className="set-label">
            Confirm new password
            <input
              type="password"
              className="set-input"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          {pwError && <p className="set-error">{pwError}</p>}
          {pwSuccess && <p className="set-success">Password updated.</p>}
          <button type="submit" className="set-btn" disabled={pwBusy}>
            {pwBusy ? 'Saving…' : 'Change password'}
          </button>
        </form>
      </div>

      <div className="card set-card">
        <div className="set-card-header">
          <div>
            <div className="panel-title">Topstep credentials</div>
            <p className="set-card-subtitle">Connects your bot to your Topstep/ProjectX account. Stored encrypted.</p>
          </div>
          {credentialsSaved && <span className="set-badge set-badge--ok">Connected</span>}
        </div>
        {!showCredentialsForm && (
          <>
            {!credentialsSaved && <p className="set-email">No platform credentials saved yet.</p>}
            <button
              type="button"
              className="set-btn"
              onClick={() => { setShowCredentialsForm(true); setCredsError(null); setCredsSuccess(null); }}
            >
              {credentialsSaved ? 'Change API key' : 'Add API key'}
            </button>
          </>
        )}
        {credsSuccess && !showCredentialsForm && <p className="set-success">{credsSuccess}</p>}

        {showCredentialsForm && (
          <form onSubmit={handleSaveCredentials} className="set-form">
            <label className="set-label">
              Topstep username
              <input
                type="text"
                className="set-input"
                value={topstepUsername}
                onChange={e => setTopstepUsername(e.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <label className="set-label">
              Topstep API key
              <input
                type="password"
                className="set-input"
                value={topstepApiKey}
                onChange={e => setTopstepApiKey(e.target.value)}
                autoComplete="off"
                placeholder={credentialsSaved ? 'Enter your new API key' : 'Enter your API key'}
                required
              />
            </label>
            <p className="set-hint">
              Re-enter your username along with the new key — for security, an existing key is never shown or prefilled here.
            </p>
            {credsError && <p className="set-error">{credsError}</p>}
            <div className="set-form-actions">
              <button type="submit" className="set-btn" disabled={credsBusy}>
                {credsBusy ? 'Saving…' : 'Save credentials'}
              </button>
              <button
                type="button"
                className="set-btn set-btn--secondary"
                disabled={credsBusy}
                onClick={() => { setShowCredentialsForm(false); setTopstepUsername(''); setTopstepApiKey(''); setCredsError(null); }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="card set-card">
        <div className="set-card-header">
          <div>
            <div className="panel-title">Alerts</div>
            <p className="set-card-subtitle">Where trade notifications get sent.</p>
          </div>
        </div>

        <form onSubmit={handleSaveWebhook} className="set-form">
          <label className="set-label">
            Discord webhook URL
            <input
              type="url"
              className="set-input"
              value={webhookUrl}
              onChange={e => { setWebhookUrl(e.target.value); setWebhookSuccess(false); }}
              placeholder="https://discord.com/api/webhooks/..."
              autoComplete="off"
              disabled={webhookLoading}
            />
          </label>
          {webhookError && <p className="set-error">{webhookError}</p>}
          {webhookSuccess && <p className="set-success">Discord webhook updated.</p>}
          <button type="submit" className="set-btn" disabled={webhookBusy || webhookLoading}>
            {webhookBusy ? 'Saving…' : 'Save webhook'}
          </button>
        </form>

        <div className="set-email-alerts-row">
          <div>
            <p className="set-email-alerts-label">Email trade alerts</p>
            <p className="set-email-alerts-hint">
              {email ? `Sent to ${email} after every closed trade.` : 'Sent to your account email after every closed trade.'}
            </p>
          </div>
          <button
            type="button"
            className={`adm-toggle ${emailAlertsEnabled ? 'adm-toggle--on' : ''}`}
            role="switch"
            aria-checked={emailAlertsEnabled}
            aria-label="Email trade alerts"
            disabled={emailAlertsLoading || emailAlertsBusy}
            onClick={handleToggleEmailAlerts}
          >
            <span className="adm-toggle-knob" />
          </button>
        </div>
        {emailAlertsError && <p className="set-error">{emailAlertsError}</p>}
      </div>
    </div>
  );
}
