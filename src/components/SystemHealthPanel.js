import { useEffect, useState } from 'react';
import botApi from '../services/botApi';
import { getDashboardConfig } from '../services/controlPlaneApi';
import { getSessionToken } from '../services/sessionToken';
import { isFuturesMarketOpenNow } from '../utils/marketOpenMode';
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

function stateOf({ ok, warn, neutral }) {
  return neutral ? 'neutral' : ok == null ? 'unknown' : warn ? 'warn' : ok ? 'ok' : 'bad';
}

function StatusRow({ label, ok, detail, warn }) {
  const state = stateOf({ ok, warn });
  return (
    <div className={`shp-row shp-row--${state}`}>
      <span className={`shp-dot shp-dot--${state}`} aria-hidden="true" />
      <span className="shp-label">{label}</span>
      <span className={`shp-detail shp-detail--${state}`}>{detail}</span>
    </div>
  );
}

// One card per section, with a summary badge in the header ("All OK" / "N
// issue(s)") so the customer doesn't have to read every row to know
// whether that section needs attention -- same pattern as the Admin tab's
// "Bot containers" card badge.
function SectionCard({ title, rows, summaryOverride }) {
  const states = rows.map(stateOf);
  const badTotal = states.filter(s => s === 'bad').length;
  const warnTotal = states.filter(s => s === 'warn').length;
  const unknownTotal = states.filter(s => s === 'unknown').length;
  const summary = summaryOverride || (
    unknownTotal === rows.length ? { cls: '', text: 'Connecting…' }
      : badTotal > 0    ? { cls: 'shp-summary--bad',  text: `${badTotal} issue${badTotal === 1 ? '' : 's'}` }
      : warnTotal > 0   ? { cls: 'shp-summary--warn', text: `${warnTotal} warning${warnTotal === 1 ? '' : 's'}` }
      : { cls: 'shp-summary--ok', text: 'All OK' }
  );

  return (
    <div className="card shp-card">
      <div className="shp-card-header">
        <span className="shp-card-title">{title}</span>
        <span className={`shp-summary ${summary.cls}`}>{summary.text}</span>
      </div>
      <div className="shp-rows">
        {rows.map(r => <StatusRow key={r.label} {...r} />)}
      </div>
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
  // A captured per-login token exists only in a cloud dashboard opened
  // through NQ Cloud; /dashboard-config intentionally contains no token.
  const [isCloud, setIsCloud] = useState(false);
  const [futuresMarketOpen, setFuturesMarketOpen] = useState(isFuturesMarketOpenNow);

  useEffect(() => {
    getDashboardConfig().then(() => setIsCloud(Boolean(getSessionToken()))).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = event => setFuturesMarketOpen(Boolean(event.detail?.open));
    window.addEventListener('nq:futures-market-mode', handler);
    return () => window.removeEventListener('nq:futures-market-mode', handler);
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

  const connectivityRows = [
    ...(isCloud ? [] : [{
      label: 'Launcher Service',
      ok: launcher != null ? launcherUp : null,
      detail: launcher == null ? 'Unreachable' : launcherUp ? 'Running' : 'Not running',
    }]),
    {
      label: 'Adapter Backend',
      ok: health != null ? adapterUp : null,
      detail: health == null ? 'Unreachable' : `${wsClients ?? 0} WS client${wsClients === 1 ? '' : 's'}`,
    },
    {
      label: 'Clock Sync',
      ok: clockOffsetMs != null ? !clockDrifted : null,
      warn: clockDrifted,
      detail: clockOffsetMs != null ? `${fmtMs(clockOffsetMs)} vs Topstep` : '—',
    },
  ];

  const marketFeedRows = [
    {
      label: 'Platform Connection',
      ok: telemetry != null ? connected : null,
      detail: telemetry == null ? 'Unreachable' : connected ? 'Connected' : 'Disconnected',
    },
    {
      label: 'Feed Freshness',
      ok: telemetry != null ? (!futuresMarketOpen || !feedStale) : null,
      warn: futuresMarketOpen && feedStale,
      neutral: telemetry != null && !futuresMarketOpen,
      detail: !futuresMarketOpen
        ? (tickAgeMs != null ? `Market closed — last tick ${fmtMs(tickAgeMs)} ago` : 'Market closed')
        : tickAgeMs != null ? (feedStale ? `Stale — ${fmtMs(tickAgeMs)}` : `Fresh — ${fmtMs(tickAgeMs)}`) : '—',
    },
    {
      label: 'Live Price',
      ok: price != null,
      neutral: price != null && !futuresMarketOpen,
      detail: price != null
        ? `${!futuresMarketOpen ? 'Cached — ' : ''}${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '—',
    },
  ];

  const riskRows = [
    {
      label: 'Flatten State',
      ok: risk != null ? !flatten.unconfirmed_active : null,
      warn: flatten.in_progress,
      detail:
        flatten.unconfirmed_active ? `Unconfirmed — ${flatten.reason || 'unknown reason'}`
          : flatten.in_progress ? 'In progress'
          : risk != null ? 'Idle' : '—',
    },
    {
      label: 'Fatal Errors',
      ok: risk != null ? !fatalErrors.active : null,
      detail: fatalErrors.active ? (fatalErrors.last_message || 'Active') : risk != null ? 'None' : '—',
    },
    {
      label: 'Trailing Safeguards',
      ok: risk != null ? safeguardsClean : null,
      detail:
        risk == null ? '—'
          : safeguardsClean ? 'OK'
          : `${trailingFailures} cancel failure(s), ${uncanceledOrders} uncanceled order(s)`,
    },
    {
      label: 'Bracket Mode',
      ok: bracketMode != null,
      detail: bracketMode || '—',
    },
  ];

  return (
    <div className="shp-grid">
      <SectionCard title="Connectivity" rows={connectivityRows} />
      <SectionCard
        title="Market Feed"
        rows={marketFeedRows}
        summaryOverride={!futuresMarketOpen ? { cls: 'shp-summary--neutral', text: 'Market Closed' } : null}
      />
      <SectionCard title="Risk &amp; Safeguards" rows={riskRows} />
    </div>
  );
}
