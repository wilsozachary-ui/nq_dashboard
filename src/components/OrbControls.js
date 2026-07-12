import { useState } from 'react';
import botApi from '../services/botApi';
import './OrbControls.css';

export default function OrbControls() {
  const [status, setStatus] = useState('');

  const run = async (fn, label) => {
    setStatus(`${label}…`);
    try {
      await fn();
      setStatus(`${label} sent`);
    } catch (err) {
      setStatus(`${label} failed: ${err.message || 'error'}`);
    }
  };

  return (
    <div className="card orb-controls">
      <h3 className="panel-title orb-controls-title">ORB Controls</h3>
      <div className="orb-controls-buttons">
        <button className="orb-ctrl-btn orb-ctrl-btn--stop" onClick={() => run(botApi.orbStop, 'Stop')}>
          Stop ORB
        </button>
        <button className="orb-ctrl-btn orb-ctrl-btn--flatten" onClick={() => run(botApi.orbFlatten, 'Flatten')}>
          Flatten ORB
        </button>
      </div>
      {status && <div className="orb-controls-status">{status}</div>}
    </div>
  );
}
