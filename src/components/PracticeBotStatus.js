import { useState, useEffect, useRef, useCallback } from 'react';
import botApi from '../services/botApi';
import './PracticeBotStatus.css';

// Module-level reconnect counter shared across mounts
let _reconnects = 0;

// ─────────────────────────────────────────────────────────────────────────────

export default function PracticeBotStatus({ apiPrefix = '' }) {
  const [st, setSt] = useState({
    apiLatency: null, heartbeatAge: null, reconnects: 0,
    strategyLoaded: false, riskLoaded: false, executionActive: false, positionManager: false,
  });

  const lastHeartbeat = useRef(Date.now());
  const heartbeatTimer = useRef(null);
  const apiTimer = useRef(null);

  const pingApi = useCallback(async () => {
    try {
      const [statusResp, latencyResp, authResp] = await Promise.all([
        botApi.getFeedStatus(),
        botApi.getFeedLatency().catch(() => ({})),
        botApi.getAuthStatus().catch(() => ({})),
      ]);
      setSt(s => ({
        ...s,
        apiLatency:      latencyResp.apiLatency ?? latencyResp.latency ?? null,
        strategyLoaded:  statusResp.strategy  ?? false,
        riskLoaded:      statusResp.risk      ?? false,
        executionActive: statusResp.execution ?? authResp.authenticated ?? false,
        positionManager: statusResp.position  ?? false,
      }));
    } catch {
      setSt(s => ({ ...s, apiLatency: null }));
    }
  }, []);

  useEffect(() => {
    pingApi();
    apiTimer.current = setInterval(pingApi, 10_000);
    return () => clearInterval(apiTimer.current);
  }, [pingApi]);

  // Heartbeat age — updated by nq:heartbeat, dispatched on every
  // successfully parsed WS message (CockpitIntegrator.js). nq:ws-heartbeat
  // used to be the source here but only fired for a literal "heartbeat"/
  // "pong" message type the adapter never actually sends, so this timer
  // just counted up from page load forever and never reset.
  useEffect(() => {
    const onBeat = () => { lastHeartbeat.current = Date.now(); };
    window.addEventListener('nq:heartbeat', onBeat);

    heartbeatTimer.current = setInterval(() => {
      setSt(s => ({
        ...s,
        heartbeatAge: +((Date.now() - lastHeartbeat.current) / 1000).toFixed(1),
      }));
    }, 500);

    return () => {
      window.removeEventListener('nq:heartbeat', onBeat);
      clearInterval(heartbeatTimer.current);
    };
  }, []);

  // Reconnect counter — updated by nq:ws-reconnect events
  useEffect(() => {
    const onReconnect = () => {
      _reconnects++;
      setSt(s => ({ ...s, reconnects: _reconnects }));
    };
    window.addEventListener('nq:ws-reconnect', onReconnect);
    return () => window.removeEventListener('nq:ws-reconnect', onReconnect);
  }, []);

  const Flag = ({ ok, label }) => (
    <div className={`pbs-flag${ok ? ' pbs-flag--ok' : ' pbs-flag--off'}`}>
      <span className="pbs-flag-dot" aria-hidden="true" />
      <span className="pbs-flag-lbl">{label}</span>
    </div>
  );

  const Metric = ({ label, value, unit = '', warn = false }) => (
    <div className="pbs-metric">
      <span className="pbs-metric-lbl">{label}</span>
      <span className={`pbs-metric-val${warn ? ' pbs-metric-val--warn' : ''}`}>
        {value != null ? `${value}${unit}` : '—'}
      </span>
    </div>
  );

  const allOk = st.strategyLoaded && st.riskLoaded && st.executionActive && st.positionManager;

  return (
    <div className="card pbs-panel">
      <div className="pbs-header">
        <span className="pbs-title panel-title">Bot Health</span>
        <span
          className={`pbs-status-pill${allOk ? ' pbs-status-pill--ok' : ' pbs-status-pill--err'}`}
          title={allOk ? 'All systems operational' : 'Degraded'}
        >
          {allOk ? 'OK' : 'ERR'}
        </span>
      </div>

      <div className="pbs-metrics-row">
        <Metric label="API" value={st.apiLatency != null ? Math.round(st.apiLatency) : null}   unit="ms" warn={st.apiLatency != null && st.apiLatency > 100} />
        <Metric label="♥"   value={st.heartbeatAge != null ? `${st.heartbeatAge}s` : null} warn={st.heartbeatAge > 5} />
        <Metric label="⟳"  value={st.reconnects}              warn={st.reconnects  > 2} />
      </div>

      <div className="pbs-flags">
        <Flag ok={st.strategyLoaded}  label="Strategy" />
        <Flag ok={st.riskLoaded}      label="Risk" />
        <Flag ok={st.executionActive} label="Exec" />
        <Flag ok={st.positionManager} label="Pos. Mgr" />
      </div>
    </div>
  );
}
