import { useState, useEffect, useCallback, useRef } from 'react';
import botApi, { BOT_WS_URL } from '../services/botApi';
import { authenticatedWebSocketUrl } from '../services/websocket';
import { computeSessionState, formatHoursMinutes, SESSION_STATES } from '../utils/marketOpenMode';
import './SessionStartChecklist.css';

// ── Pre-Flight Checklist ─────────────────────────────────────────────────────
//
// Every check below reads a real field from a real endpoint (verified live
// against the running backend on 2026-07-02) -- this replaces an earlier
// version that predated the adapter integration work and mostly checked
// stale /topstep/* routes, wrong field names (maxDailyLoss etc. that don't
// exist on /risk), and several rows that were hardcoded to always warn
// regardless of actual state. If a check here is wrong, it's because the
// backend shape changed, not because it was never wired up.

const CHICAGO_TZ = 'America/Chicago';

function fmtCountdownToArm() {
  const now = new Date();
  const chicagoNow = new Date(now.toLocaleString('en-US', { timeZone: CHICAGO_TZ }));
  const target = new Date(chicagoNow);
  target.setHours(8, 29, 59, 0);
  if (chicagoNow >= target) target.setDate(target.getDate() + 1);
  while (target.getDay() === 0 || target.getDay() === 6) target.setDate(target.getDate() + 1);
  const ms = target.getTime() - chicagoNow.getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function pushActivityEvent(note) {
  window.dispatchEvent(new CustomEvent('nq:param-update', {
    detail: { type: 'param_update', timestamp: new Date().toISOString(), note },
  }));
}

// ── Individual check executors -- each hits exactly one real field ─────────

async function checkAdapterHealth() {
  try {
    const d = await botApi.getHealth();
    return d.ok
      ? { status: 'pass', detail: `${d.adapter} · ${d.ws_clients} WS client(s)` }
      : { status: 'fail', detail: 'Adapter reports not ok' };
  } catch {
    return { status: 'fail', detail: 'Backend (:8080) unreachable' };
  }
}

async function checkRealtimeWs() {
  const url = authenticatedWebSocketUrl(BOT_WS_URL + '/ws');
  return new Promise(resolve => {
    let ws;
    const t0 = performance.now();
    const timer = setTimeout(() => {
      if (ws) { ws.onopen = null; ws.onerror = null; try { ws.close(); } catch {} }
      resolve({ status: 'fail', detail: 'Connection timeout (3s)' });
    }, 3000);
    try { ws = new WebSocket(url); }
    catch { clearTimeout(timer); return resolve({ status: 'fail', detail: 'Invalid WS URL' }); }
    ws.onopen = () => {
      clearTimeout(timer);
      const latency = Math.round(performance.now() - t0);
      ws.onopen = null; ws.onerror = null;
      try { ws.close(); } catch {}
      resolve({ status: 'pass', detail: `Connected · ${url}`, latency });
    };
    ws.onerror = () => { clearTimeout(timer); resolve({ status: 'fail', detail: 'Connection refused' }); };
  });
}

async function checkPlatformConnection(telemetry) {
  const connected = telemetry?.bot?.connection === 'Connected';
  return connected
    ? { status: 'pass', detail: 'Connected to Topstep' }
    : { status: 'fail', detail: `Connection: ${telemetry?.bot?.connection ?? 'unknown'}` };
}

// Feed Freshness reads its classification from the ONE shared session-state
// calculator in marketOpenMode.js (see computeSessionState()) rather than
// deriving its own weekend/holiday logic -- that duplication is exactly what
// previously made this check report "Stale -- 3642s since last tick" during
// a routine market closure, which could push the whole Pre-Flight Checklist
// to NOT READY for a completely benign reason. A market closure is an
// informational/pass state: no red X, no amber warning, excluded from
// Recommended Actions (both handled below purely by returning 'neutral'
// instead of 'warn'/'fail' -- see the recommendations filter and the
// overallStatus calc, neither of which look at 'neutral').
function checkFeedFreshness(telemetry, sessionState) {
  const feed = telemetry?.feed || {};
  switch (sessionState.session_state) {
    case SESSION_STATES.CLOSED:
      return { status: 'neutral', detail: 'Market Closed', meta: sessionState };
    case SESSION_STATES.OPEN_AWAITING_FIRST_TICK:
      return { status: 'neutral', detail: 'Market Open — Awaiting first tick', meta: sessionState };
    case SESSION_STATES.OPEN_STALE:
      return { status: 'fail', detail: `Stale -- ${sessionState.feed_age_seconds ?? 0}s since last tick`, meta: sessionState };
    case SESSION_STATES.OPEN_FRESH:
      return { status: 'pass', detail: `Fresh -- last tick ${Math.round(feed.last_tick_age_ms)}ms ago`, meta: sessionState };
    default:
      return { status: 'warn', detail: 'No tick age reported yet', meta: sessionState };
  }
}

// While the market is closed, the last traded price is still worth showing
// but must not read as a live quote -- "Last Price" instead of "Live Price"
// (same distinction SystemHealthPanel's Market Feed card makes).
function checkLivePrice(telemetry, sessionState) {
  const price = telemetry?.market?.price;
  if (price == null) return { status: 'warn', detail: 'No price on telemetry yet' };
  const label = sessionState?.session_state === SESSION_STATES.CLOSED ? 'Last Price' : 'Live Price';
  return { status: 'pass', detail: `${label}: ${Number(price).toLocaleString()}` };
}

// Live-ticking display text for the Feed Freshness row while the market is
// closed, so "Reopening in Xh Ym" counts down on its own every second
// without requiring the user to re-run the checklist. Falls back to the
// check's own static `detail` (set at run() time) for every other state.
function feedFreshnessLiveDetail(check, nowMs) {
  const meta = check.meta;
  if (!meta || meta.session_state !== SESSION_STATES.CLOSED || !meta.next_open_at) return null;
  const secondsUntilOpen = Math.max(0, Math.round((new Date(meta.next_open_at).getTime() - nowMs) / 1000));
  const countdownText = formatHoursMinutes(secondsUntilOpen);
  return countdownText ? `Market Closed — Reopening in ${countdownText}` : 'Market Closed';
}

function checkAccountSelected() {
  const sel = window.topstepAccountsSelected;
  const accountId = sel && sel.length ? sel[0] : null;
  if (!accountId) return { status: 'fail', detail: 'No account selected -- pick one in the account selector' };
  return { status: 'pass', detail: `Account ${accountId} selected` };
}

function checkTradeParameters() {
  const p = window.nqMorningStrategyParams;
  if (!p) return { status: 'warn', detail: 'Params not read yet -- open Trade Parameter Panel' };
  const sl = Number(p.stopLoss ?? p.stopLossDollars);
  const tp = Number(p.takeProfit ?? p.takeProfitDollars);
  if (!Number.isFinite(sl) || sl <= 0 || !Number.isFinite(tp) || tp <= 0) {
    return { status: 'fail', detail: 'SL/TP not set to a positive value' };
  }
  return { status: 'pass', detail: `SL $${sl} · TP $${tp}` };
}

async function checkArmSchedule() {
  try {
    const d = await botApi.getLiveBot();
    if (d.armed && d.next_fire_at) {
      const fireAt = new Date(d.next_fire_at);
      const inFuture = fireAt.getTime() > Date.now();
      return inFuture
        ? { status: 'pass', detail: `Armed -- fires ${fireAt.toLocaleString('en-US', { timeZone: CHICAGO_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' })} CT` }
        : { status: 'fail', detail: 'Armed but next_fire_at is in the past -- re-arm' };
    }
    return { status: 'warn', detail: `Not armed yet -- arm before ${fmtCountdownToArm()}` };
  } catch {
    return { status: 'fail', detail: 'Cannot reach /testbot/live' };
  }
}

async function checkRiskFlatten() {
  try {
    const d = await botApi.getRisk();
    const f = d.flatten || {};
    if (f.in_progress) return { status: 'warn', detail: 'Flatten currently in progress' };
    if (f.unconfirmed_active) return { status: 'fail', detail: `Unconfirmed flatten: ${f.reason || 'unknown reason'}` };
    return { status: 'pass', detail: 'No flatten in progress' };
  } catch { return { status: 'fail', detail: 'Cannot reach /risk' }; }
}

async function checkRiskFatal(riskData) {
  const fe = riskData?.fatal_errors || {};
  return fe.active
    ? { status: 'fail', detail: fe.last_message || 'Fatal error active' }
    : { status: 'pass', detail: 'No active fatal errors' };
}

function checkTrailingSafeguards(riskData) {
  const s = riskData?.safeguards || {};
  const failures = s.trailing_cancel_failures ?? 0;
  const uncanceled = s.uncanceled_order_count ?? 0;
  if (failures === 0 && uncanceled === 0) return { status: 'pass', detail: 'No trailing-stop or order cleanup issues' };
  return { status: 'warn', detail: `${failures} trailing cancel failure(s), ${uncanceled} uncanceled order(s)` };
}

async function checkVix() {
  try {
    const d = await botApi.getSignals();
    return d.vix != null
      ? { status: 'pass', detail: `VIX ${Number(d.vix).toFixed(2)} · ${d.volatility_regime || 'regime unknown'}` }
      : { status: 'warn', detail: 'VIX not available yet' };
  } catch { return { status: 'fail', detail: 'Cannot reach /signals' }; }
}

async function checkOvernightRange() {
  try {
    const d = await botApi.getSignals();
    const hi = d.overnight_high, lo = d.overnight_low;
    if (hi == null || lo == null) return { status: 'warn', detail: 'Overnight range not available yet' };
    if (hi <= lo) return { status: 'fail', detail: `Range looks wrong: ${lo}-${hi}` };
    return { status: 'pass', detail: `${lo.toLocaleString()} - ${hi.toLocaleString()} (${(hi - lo).toFixed(2)} pts)` };
  } catch { return { status: 'fail', detail: 'Cannot reach /signals' }; }
}

function checkDom(selector) {
  return document.querySelector(selector)
    ? { status: 'pass', detail: 'Mounted' }
    : { status: 'fail', detail: 'Not found in DOM' };
}

// ── Section + check definitions ─────────────────────────────────────────────
// `run` executors that need shared data (telemetry/risk, fetched once per
// pass) take it as an argument; standalone ones fetch for themselves.
const SECTIONS = [
  {
    id: 'connectivity',
    label: 'Connectivity',
    checks: [
      { id: 'adapter',   label: 'Adapter Backend',    run: () => checkAdapterHealth() },
      { id: 'ws',        label: 'Realtime WebSocket', run: () => checkRealtimeWs() },
    ],
  },
  {
    id: 'feed',
    label: 'Market Feed',
    checks: [
      { id: 'platform-conn', label: 'Platform Connection', run: ctx => checkPlatformConnection(ctx.telemetry) },
      { id: 'feed-fresh',    label: 'Feed Freshness',      run: ctx => checkFeedFreshness(ctx.telemetry, ctx.sessionState) },
      { id: 'live-price',    label: 'Live Price',          run: ctx => checkLivePrice(ctx.telemetry, ctx.sessionState) },
    ],
  },
  {
    id: 'config',
    label: 'Strategy Configuration',
    checks: [
      { id: 'account',    label: 'Account Selected',   run: () => checkAccountSelected() },
      { id: 'params',     label: 'Trade Parameters',   run: () => checkTradeParameters() },
      { id: 'arm-sched',  label: 'Arm / Schedule',      run: () => checkArmSchedule() },
    ],
  },
  {
    id: 'risk',
    label: 'Risk & Safety',
    checks: [
      { id: 'risk-flatten',  label: 'Flatten State',        run: () => checkRiskFlatten() },
      { id: 'risk-fatal',    label: 'Fatal Errors',         run: ctx => checkRiskFatal(ctx.risk) },
      { id: 'risk-trailing', label: 'Trailing Safeguards',  run: ctx => checkTrailingSafeguards(ctx.risk) },
    ],
  },
  {
    id: 'market_context',
    label: 'Market Context',
    checks: [
      { id: 'vix',   label: 'VIX',             run: () => checkVix() },
      { id: 'range', label: 'Overnight Range', run: () => checkOvernightRange() },
    ],
  },
  {
    id: 'ui_readiness',
    label: 'UI Readiness',
    checks: [
      { id: 'ui-overview', label: 'Market Overview Strip',       run: () => checkDom('.mos-strip') },
      { id: 'ui-ticker',   label: 'NQ Live Ticker',               run: () => checkDom('.ltk-panel') },
      { id: 'ui-params',   label: 'Trade Parameter Panel',        run: () => checkDom('.tp-panel') },
      { id: 'ui-control',  label: 'Morning Strategy Control',     run: () => checkDom('.mstb-panel--live') },
      { id: 'ui-activity', label: 'Activity Panel',               run: () => checkDom('.ap-panel') },
    ],
  },
];

const ALL_CHECKS = SECTIONS.flatMap(s =>
  s.checks.map(c => ({ ...c, sectionId: s.id, sectionLabel: s.label }))
);

const INIT_STATE = () =>
  ALL_CHECKS.map(c => ({ ...c, status: 'idle', detail: null, latency: null }));

// ── Status icon helper ──────────────────────────────────────────────────────
function StatusIcon({ status }) {
  if (status === 'pass')    return <span className="ssc-icon ssc-icon--pass">✓</span>;
  if (status === 'neutral') return <span className="ssc-icon ssc-icon--neutral">●</span>;
  if (status === 'warn')    return <span className="ssc-icon ssc-icon--warn">⚠</span>;
  if (status === 'fail')    return <span className="ssc-icon ssc-icon--fail">✗</span>;
  if (status === 'running') return <span className="ssc-icon ssc-icon--running"><span className="ssc-pulse">●</span></span>;
  return <span className="ssc-icon ssc-icon--idle">○</span>;
}

// ── ORB placeholder panel ────────────────────────────────────────────────────
function OrbComingSoon() {
  return (
    <div className="ssc-coming-soon">
      <span className="ssc-coming-soon-icon" aria-hidden="true">◆</span>
      <div className="ssc-coming-soon-title">ORB Pre-Flight — Coming Soon</div>
      <div className="ssc-coming-soon-body">
        ORB has its own real trading engine already running (see the ORB Strategy tab),
        but a dedicated pre-flight checklist for it hasn't been built yet. This panel
        will get the same treatment as Morning Strategy's checklist once that's scoped.
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SessionStartChecklist() {
  const [strategy,  setStrategy]  = useState('morning');
  const [checks,    setChecks]    = useState(INIT_STATE);
  const [running,   setRunning]   = useState(false);
  const [runAt,     setRunAt]     = useState(null);
  const [hasRun,    setHasRun]    = useState(false);
  const [countdown, setCountdown] = useState(() => fmtCountdownToArm());
  const [nowMs,     setNowMs]     = useState(() => Date.now());

  const activeRef = useRef(false);
  const checksRef = useRef(checks);

  useEffect(() => { checksRef.current = checks; }, [checks]);

  useEffect(() => {
    const id = setInterval(() => { setCountdown(fmtCountdownToArm()); setNowMs(Date.now()); }, 1000);
    return () => clearInterval(id);
  }, []);

  const runChecks = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setRunning(true);
    setRunAt(new Date());
    setHasRun(true);
    setChecks(INIT_STATE());
    await new Promise(r => setTimeout(r, 100));

    // Shared fetches -- telemetry/risk are hit once per pass, not once per
    // check that needs them, so a 6-row section doesn't fire 6 redundant
    // requests for the same data.
    const [telemetry, risk] = await Promise.all([
      botApi.getRawTelemetry().catch(() => ({})),
      botApi.getRisk().catch(() => ({})),
    ]);
    // Computed once per pass (same reasoning as telemetry/risk above) and
    // shared by both feed-freshness and live-price checks, so there's a
    // single classification per run rather than each check re-deriving it.
    const feed = telemetry?.feed || {};
    const sessionState = computeSessionState({
      tickAgeMs: feed.last_tick_age_ms ?? null,
      feedStale: feed.stale === true,
      telemetryAvailable: telemetry != null && 'feed' in telemetry,
    });
    const ctx = { telemetry, risk, sessionState };

    for (const def of ALL_CHECKS) {
      if (!activeRef.current) break;
      setChecks(prev => prev.map(c => c.id === def.id ? { ...c, status: 'running' } : c));
      await new Promise(r => setTimeout(r, 40 + Math.random() * 60));
      const result = await def.run(ctx);
      setChecks(prev => prev.map(c => c.id === def.id ? { ...c, ...result } : c));
    }

    const finalChecks = checksRef.current;
    const passN = finalChecks.filter(c => c.status === 'pass').length;
    const warnN = finalChecks.filter(c => c.status === 'warn').length;
    const failN = finalChecks.filter(c => c.status === 'fail').length;
    const label = failN > 0 ? 'NOT READY' : warnN > 0 ? 'READY WITH WARNINGS' : 'READY';
    pushActivityEvent(`Pre-Flight Checklist — ${passN} passed · ${warnN} warnings · ${failN} failed → ${label}`);
    window.dispatchEvent(new CustomEvent('nq:session-status', {
      detail: { status: failN > 0 ? 'fail' : warnN > 0 ? 'warn' : 'pass' },
    }));

    activeRef.current = false;
    setRunning(false);
  }, []);

  useEffect(() => {
    if (strategy !== 'morning') return;
    const t = setTimeout(runChecks, 700);
    return () => { clearTimeout(t); activeRef.current = false; };
  }, [strategy, runChecks]);

  const passCount    = checks.filter(c => c.status === 'pass').length;
  const neutralCount = checks.filter(c => c.status === 'neutral').length;
  const warnCount    = checks.filter(c => c.status === 'warn').length;
  const failCount    = checks.filter(c => c.status === 'fail').length;
  const pendingCount = checks.filter(c => c.status === 'idle' || c.status === 'running').length;

  const overallStatus = !hasRun   ? 'idle'
    : running || pendingCount > 0 ? 'running'
    : failCount > 0               ? 'fail'
    : warnCount > 0                ? 'warn'
    : 'pass';

  const recommendations = hasRun && !running
    ? checks
        .filter(c => c.status === 'warn' || c.status === 'fail')
        .map(c => ({ id: c.id, severity: c.status, label: c.sectionLabel, check: c.label, detail: c.detail }))
    : [];

  const bannerText = overallStatus === 'idle'    ? '— PRE-FLIGHT NOT YET RUN —'
    : overallStatus === 'running'                ? 'RUNNING CHECKS…'
    : overallStatus === 'fail'                   ? 'NOT READY — FIX ISSUES BELOW'
    : overallStatus === 'warn'                   ? 'READY WITH WARNINGS — REVIEW BELOW'
    : 'MORNING STRATEGY READY FOR SESSION';

  return (
    <section className="ssc-root">

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="ssc-header">
        <div className="ssc-title-block">
          <h2 className="ssc-title">Pre-Flight Checklist</h2>
          {strategy === 'morning' && runAt && (
            <span className="ssc-last-run">Last run: {runAt.toLocaleTimeString()}</span>
          )}
        </div>

        <div className="ssc-header-right">
          <div className="ssc-strategy-switch" role="tablist" aria-label="Strategy">
            <button
              role="tab"
              aria-selected={strategy === 'morning'}
              className={`ssc-strategy-tab${strategy === 'morning' ? ' ssc-strategy-tab--active' : ''}`}
              onClick={() => setStrategy('morning')}
            >
              Morning Strategy
            </button>
            <button
              role="tab"
              aria-selected={strategy === 'orb'}
              className={`ssc-strategy-tab${strategy === 'orb' ? ' ssc-strategy-tab--active' : ''}`}
              onClick={() => setStrategy('orb')}
            >
              ORB <span className="ssc-strategy-tab-badge">Soon</span>
            </button>
          </div>

          {strategy === 'morning' && (
            <button
              className={`ssc-run-btn${running ? ' ssc-run-btn--running' : ''}`}
              onClick={runChecks}
              disabled={running}
            >
              {running ? <><span className="ssc-btn-spinner" aria-hidden="true" />Running…</> : '↺ Re-run Checks'}
            </button>
          )}
        </div>
      </div>

      {strategy === 'orb' ? (
        <OrbComingSoon />
      ) : (
        <>
          {/* ── Check sections (card grid) ─────────────────────────────── */}
          <div className="ssc-sections">
            {SECTIONS.map(section => {
              const sChecks  = checks.filter(c => c.sectionId === section.id);
              const sPass    = sChecks.filter(c => c.status === 'pass').length;
              const sNeutral = sChecks.filter(c => c.status === 'neutral').length;
              const sWarn    = sChecks.filter(c => c.status === 'warn').length;
              const sFail    = sChecks.filter(c => c.status === 'fail').length;
              const isRun    = sChecks.some(c => c.status === 'running');
              // A closed-market row reports 'neutral', not 'pass' -- but it's
              // still an all-clear section (nothing here is actually broken),
              // so it counts toward the section reading 'pass' the same way
              // an actual pass would.
              const sStatus = sFail > 0 ? 'fail'
                : isRun                 ? 'running'
                : sWarn > 0             ? 'warn'
                : sChecks.length > 0 && sPass + sNeutral === sChecks.length ? 'pass'
                : 'idle';

              return (
                <div key={section.id} className="ssc-section">
                  <div className="ssc-section-head">
                    <span className={`ssc-section-dot ssc-section-dot--${sStatus}`} />
                    <span className="ssc-section-label">{section.label}</span>
                    <span className="ssc-section-tally">
                      {sPass > 0 && <span className="ssc-tally ssc-tally--pass">{sPass}✓</span>}
                      {sWarn > 0 && <span className="ssc-tally ssc-tally--warn">{sWarn}⚠</span>}
                      {sFail > 0 && <span className="ssc-tally ssc-tally--fail">{sFail}✗</span>}
                    </span>
                  </div>

                  <div className="ssc-checks">
                    {sChecks.map(check => (
                      <div key={check.id} className={`ssc-check ssc-check--${check.status}`}>
                        <StatusIcon status={check.status} />
                        <span className="ssc-check-label">{check.label}</span>
                        <span className={`ssc-check-detail ssc-check-detail--${check.status}`}>
                          {check.status === 'running' ? 'Checking…'
                          : check.status === 'idle'   ? 'Pending'
                          : feedFreshnessLiveDetail(check, nowMs) || check.detail || '—'}
                        </span>
                        {check.latency != null && <span className="ssc-check-lat">{check.latency}ms</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Pre-Flight Summary ─────────────────────────────────────── */}
          {hasRun && !running && (
            <div className={`ssc-summary ssc-summary--${overallStatus}`}>
              <div className="ssc-summary-heading">Pre-Flight Summary</div>

              <div className="ssc-summary-counts">
                <span className="ssc-sc ssc-sc--pass"><b>{passCount}</b> passed</span>
                {neutralCount > 0 && (
                  <>
                    <span className="ssc-sc-sep">·</span>
                    <span className="ssc-sc ssc-sc--neutral"><b>{neutralCount}</b> informational</span>
                  </>
                )}
                <span className="ssc-sc-sep">·</span>
                <span className="ssc-sc ssc-sc--warn"><b>{warnCount}</b> warnings</span>
                <span className="ssc-sc-sep">·</span>
                <span className="ssc-sc ssc-sc--fail"><b>{failCount}</b> failed</span>
                <span className="ssc-sc-sep">·</span>
                <span className="ssc-sc">{passCount + neutralCount + warnCount + failCount} total</span>
              </div>

              <div className="ssc-countdown-row">
                <span className="ssc-countdown-label">Next arm window in</span>
                <span className="ssc-countdown-val">{countdown}</span>
                <span className="ssc-countdown-note">(8:30 AM CT)</span>
              </div>

              {recommendations.length > 0 && (
                <div className="ssc-recs">
                  <div className="ssc-recs-heading">Recommended Actions</div>
                  {recommendations.map(r => (
                    <div key={r.id} className={`ssc-rec ssc-rec--${r.severity}`}>
                      <span className="ssc-rec-icon">{r.severity === 'fail' ? '✗' : '⚠'}</span>
                      <span className="ssc-rec-text">
                        <span className="ssc-rec-section">{r.label}</span>
                        <span className="ssc-rec-arrow"> › </span>
                        <span className="ssc-rec-check">{r.check}</span>
                        {r.detail && <span className="ssc-rec-detail"> — {r.detail}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── READY / NOT READY Banner ───────────────────────────────── */}
          <div className={`ssc-banner ssc-banner--${overallStatus}`}>
            {(overallStatus === 'running' || overallStatus === 'idle') && (
              <span className="ssc-banner-spinner" aria-hidden="true" />
            )}
            {bannerText}
          </div>
        </>
      )}

    </section>
  );
}
