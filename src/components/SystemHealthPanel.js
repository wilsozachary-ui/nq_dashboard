import { useEffect, useState } from 'react';
import botApi from '../services/botApi';
import { getDashboardConfig } from '../services/controlPlaneApi';
import './SystemHealthPanel.css';

// ── System Health — a live, always-real operational status board ───────────
//
// Deliberately has no trading actions (no kill switch, no risk-limit
// editing) -- those either duplicate the per-strategy OFF toggles that
// already work, or don't exist as a real backend feature at all. This
// panel only ever displays fields that come straight from real endpoints
// already used throughout the app (/health, :8090/status, /telemetry,
// /risk) -- nothing here is seeded from a hardcoded default or a field
// name that doesn't exist server-side.

const CLOCK_DRIFT_WARN_MS = 2000; // matches engine_bridge.py's CLOCK_DRIFT_WARN_SECONDS

function fmtMs(ms) {
  if (ms == null) return '—';
  const abs = Math.abs(ms);
  return abs < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function StatusRow({ label, ok, detail, warn }) {
  const state = ok == null ? 'unknown' : warn ? 'warn' : ok ? 'ok' : 'bad';
  return (
    <div className="shp-row">
      <span className={`shp-dot shp-dot--${state}`} aria-hidden="true" />
      <span className="shp-label">{label}</span>
      <span className={`shp-detail shp-detail--${state}`}>{detail}</span>
    </div>
  );
}

export default function SystemHealthPanel() {
  const [launcher, setLauncher] = useState(null);
  const [health, setHealth] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [risk, setRisk] = useState(null);
  // The Launcher Service check hits LAUNCHER_ROOT, which defaults to
  // http://localhost:8090 -- for a cloud customer that's their own PC,
  // not the container, so it can never succeed there (there's nothing
  // running on their machine to answer it). Detected the same way
  // App.js detects a cloud instance: a real dashboard_token only ever
  // gets baked in at cloud provision time, never present for the
  // desktop exe.
  const [isCloud, setIsCloud] = useState(false);

  useEffect(() => {
    getDashboardConfig().then(config => setIsCloud(Boolean(config.dashboard_token))).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      Promise.allSettled([
        isCloud ? Promise.resolve(null) : botApi.getBackendStatus(),
        botApi.getHealth(),
        botApi.getRawTelemetry(),
        botApi.getRisk(),
      ]).then(([l, h, t, r]) => {
        if (cancelled) return;
        setLauncher(l.status === 'fulfilled' ? l.value : null);
        setHealth(h.status === 'fulfilled' ? h.value : null);
        setTelemetry(t.status === 'fulfilled' ? t.value : null);
        setRisk(r.status === 'fulfilled' ? r.value : null);
      });
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isCloud]);

  const launcherUp = launcher?.running === true;
  const adapterUp = health?.ok === true;
  const wsClients = health?.ws_clients;
  const clockOffsetMs = health?.clock_offset_ms;
  const clockDrifted = clockOffsetMs != null && Math.abs(clockOffsetMs) > CLOCK_DRIFT_WARN_MS;

  const connected = telemetry?.bot?.connection === 'Connected';
  const feedStale = telemetry?.feed?.stale === true;
  const tickAgeMs = telemetry?.feed?.last_tick_age_ms;
  const price = telemetry?.market?.price;

  const flatten = risk?.flatten || {};
  const fatalErrors = risk?.fatal_errors || {};
  const safeguards = risk?.safeguards || {};
  const bracketMode = risk?.bracket_mode?.mode;
  const trailingFailures = safeguards.trailing_cancel_failures ?? 0;
  const uncanceledOrders = safeguards.uncanceled_order_count ?? 0;
  const safeguardsClean = trailingFailures === 0 && uncanceledOrders === 0;

  return (
    <div className="card shp-panel">
      <h2 className="panel-title">System Health</h2>

      <div className="shp-section">
        <div className="shp-section-label">Connectivity</div>
        {!isCloud && (
          <StatusRow
            label="Launcher Service"
            ok={launcher != null ? launcherUp : null}
            detail={launcher == null ? 'Unreachable' : launcherUp ? 'Running' : 'Not running'}
          />
        )}
        <StatusRow
          label="Adapter Backend"
          ok={health != null ? adapterUp : null}
          detail={health == null ? 'Unreachable' : `${wsClients ?? 0} WS client${wsClients === 1 ? '' : 's'}`}
        />
        <StatusRow
          label="Clock Sync"
          ok={clockOffsetMs != null ? !clockDrifted : null}
          warn={clockDrifted}
          detail={clockOffsetMs != null ? `${fmtMs(clockOffsetMs)} vs Topstep` : '—'}
        />
      </div>

      <div className="shp-section">
        <div className="shp-section-label">Market Feed</div>
        <StatusRow
          label="Platform Connection"
          ok={telemetry != null ? connected : null}
          detail={telemetry == null ? 'Unreachable' : connected ? 'Connected' : 'Disconnected'}
        />
        <StatusRow
          label="Feed Freshness"
          ok={telemetry != null ? !feedStale : null}
          warn={feedStale}
          detail={tickAgeMs != null ? (feedStale ? `Stale — ${fmtMs(tickAgeMs)}` : `Fresh — ${fmtMs(tickAgeMs)}`) : '—'}
        />
        <StatusRow
          label="Live Price"
          ok={price != null}
          detail={price != null ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        />
      </div>

      <div className="shp-section">
        <div className="shp-section-label">Risk &amp; Safeguards</div>
        <StatusRow
          label="Flatten State"
          ok={risk != null ? !flatten.unconfirmed_active : null}
          warn={flatten.in_progress}
          detail={
            flatten.unconfirmed_active ? `Unconfirmed — ${flatten.reason || 'unknown reason'}`
              : flatten.in_progress ? 'In progress'
              : risk != null ? 'Idle' : '—'
          }
        />
        <StatusRow
          label="Fatal Errors"
          ok={risk != null ? !fatalErrors.active : null}
          detail={fatalErrors.active ? (fatalErrors.last_message || 'Active') : risk != null ? 'None' : '—'}
        />
        <StatusRow
          label="Trailing Safeguards"
          ok={risk != null ? safeguardsClean : null}
          detail={
            risk == null ? '—'
              : safeguardsClean ? 'OK'
              : `${trailingFailures} cancel failure(s), ${uncanceledOrders} uncanceled order(s)`
          }
        />
        <StatusRow
          label="Bracket Mode"
          ok={bracketMode != null}
          detail={bracketMode || '—'}
        />
      </div>
    </div>
  );
}
