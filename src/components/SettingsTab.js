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

  useEffect(() => {
    cpGet('/me').then(me => setEmail(me.email)).catch(() => {});
    cpGet('/credentials')
      .then(res => setWebhookUrl(res.discord_webhook_url || ''))
      .catch(() => {})
      .finally(() => setWebhookLoading(false));
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

  return (
    <div className="tab-single-col set-tab">
      <div className="card set-card">
        <div className="panel-title">Login</div>
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
        <div className="panel-title">Alerts</div>

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

        <p className="panel-placeholder">Email trade alerts — coming soon.</p>
      </div>
    </div>
  );
}
