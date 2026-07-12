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

  useEffect(() => {
    cpGet('/me').then(me => setEmail(me.email)).catch(() => {});
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
        <p className="panel-placeholder">Discord and email trade alerts — coming soon.</p>
      </div>
    </div>
  );
}
