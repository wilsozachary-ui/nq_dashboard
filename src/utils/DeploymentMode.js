/**
 * DeploymentMode.js — Environment detection, config validation, runtime mode
 * setup, and production safety checks for the NQ Morning Strategy cockpit.
 *
 * Call order (happens in initDeploymentMode):
 *   detectEnvironment → loadEnvConfig → validateEnvConfig
 *   → prepareRuntimeMode → applyProduction/DevelopmentSettings
 *   → prepareBuildArtifacts → runProductionSafetyChecks
 *   → exportDeploymentSummary
 *
 * Global side-effect: populates window.cockpit with runtime flags.
 * UI side-effect: emits nq:deployment-mode and nq:deployment-ready events.
 */

import { API_ROOT, USE_MOCK } from '../api/pnlApi';
import { emitCritical, emitWarning } from './errorBus';

// ── Environment constants ─────────────────────────────────────────────────────

export const ENVS = Object.freeze({
  LOCAL_DEV:  'LOCAL_DEV',   // npm start, development hot-reload
  LOCAL_PROD: 'LOCAL_PROD',  // npm run build served locally
  CLOUD_PROD: 'CLOUD_PROD',  // VPS / container deployment
  SANDBOX:    'SANDBOX',     // prop-firm isolated environment
});

// ── Required config fields ────────────────────────────────────────────────────

const REQUIRED_FIELDS = [
  'API_ROOT',
  'WS_ROOT',
  'STRATEGY_NAME',
  'PORT',
  'LOG_LEVEL',
  'MARKET_OPEN_TIME',
  'MARKET_CLOSE_TIME',
];

// ── Module-level state (singleton) ────────────────────────────────────────────

let _env         = null;
let _config      = null;
let _warnings    = [];
let _summary     = null;
let _initialized = false;

// ── Preserved console references (before any suppression) ────────────────────

const _origConsole = {
  log:   typeof console !== 'undefined' ? console.log.bind(console)   : () => {},
  debug: typeof console !== 'undefined' ? console.debug.bind(console) : () => {},
  warn:  typeof console !== 'undefined' ? console.warn.bind(console)  : () => {},
  error: typeof console !== 'undefined' ? console.error.bind(console) : () => {},
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. detectEnvironment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads process.env.NODE_ENV and process.env.REACT_APP_COCKPIT_ENV to
 * classify the runtime environment.
 *
 * .env file mapping:
 *   LOCAL_DEV  → .env.local              (npm start)
 *   LOCAL_PROD → .env.production         (npm run build, no COCKPIT_ENV)
 *   CLOUD_PROD → .env.production         (REACT_APP_COCKPIT_ENV=cloud)
 *   SANDBOX    → any NODE_ENV            (REACT_APP_COCKPIT_ENV=sandbox)
 */
export function detectEnvironment() {
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
  // CRA strips non-REACT_APP_ vars in the browser build; support both
  const cockpitEnv = (
    process.env.REACT_APP_COCKPIT_ENV ||
    process.env.COCKPIT_ENV           ||
    ''
  ).toLowerCase().trim();

  let env;
  if (cockpitEnv === 'sandbox') {
    env = ENVS.SANDBOX;
  } else if (cockpitEnv === 'cloud' && nodeEnv === 'production') {
    env = ENVS.CLOUD_PROD;
  } else if (nodeEnv === 'production') {
    env = ENVS.LOCAL_PROD;
  } else {
    env = ENVS.LOCAL_DEV;
  }

  _env = env;
  return env;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. loadEnvConfig
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads REACT_APP_* environment variables (baked in at build time by CRA).
 * Provides sensible defaults where possible so development works out of the box.
 *
 * .env file variable names (must use REACT_APP_ prefix in CRA):
 *   REACT_APP_API_ROOT        → maps to config.API_ROOT
 *   REACT_APP_WS_ROOT         → maps to config.WS_ROOT
 *   REACT_APP_STRATEGY_NAME   → maps to config.STRATEGY_NAME
 *   REACT_APP_PORT            → maps to config.PORT
 *   REACT_APP_LOG_LEVEL       → maps to config.LOG_LEVEL
 *   REACT_APP_MARKET_OPEN_TIME  → maps to config.MARKET_OPEN_TIME
 *   REACT_APP_MARKET_CLOSE_TIME → maps to config.MARKET_CLOSE_TIME
 */
export function loadEnvConfig() {
  if (!_env) detectEnvironment();
  const e = process.env;

  const apiRoot = e.REACT_APP_API_ROOT || API_ROOT || 'http://localhost:5000';
  const wsRoot  = e.REACT_APP_WS_ROOT  || apiRoot.replace(/^http/, 'ws');

  _config = {
    API_ROOT:          apiRoot,
    WS_ROOT:           wsRoot,
    STRATEGY_NAME:     e.REACT_APP_STRATEGY_NAME     || 'morning_strategy',
    PORT:              e.REACT_APP_PORT || e.PORT     || '5000',
    LOG_LEVEL:         e.REACT_APP_LOG_LEVEL          || (_env === ENVS.LOCAL_DEV ? 'debug' : 'info'),
    MARKET_OPEN_TIME:  e.REACT_APP_MARKET_OPEN_TIME   || '09:30',
    MARKET_CLOSE_TIME: e.REACT_APP_MARKET_CLOSE_TIME  || '16:00',

    // Extended (optional)
    TZ:             e.REACT_APP_TZ             || 'America/New_York',
    COCKPIT_ENV:    _env,
    ENABLE_MOCK:    USE_MOCK,
    BUILD_TIME:     e.REACT_APP_BUILD_TIME     || null,
    VERSION:        e.REACT_APP_VERSION || e.npm_package_version || '0.0.0',
  };

  return { ..._config };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. validateEnvConfig
// ─────────────────────────────────────────────────────────────────────────────

export function validateEnvConfig() {
  if (!_config) loadEnvConfig();

  const missing  = REQUIRED_FIELDS.filter(f => !_config[f] || _config[f] === '');
  const warnings = [];

  // Log level must be a recognized value
  const VALID_LEVELS = ['debug', 'info', 'warn', 'error'];
  if (_config.LOG_LEVEL && !VALID_LEVELS.includes(_config.LOG_LEVEL)) {
    warnings.push(`LOG_LEVEL "${_config.LOG_LEVEL}" is not recognized — falling back to "info"`);
    _config.LOG_LEVEL = 'info';
  }

  // Time fields must be HH:MM
  const timeRe = /^\d{2}:\d{2}$/;
  if (_config.MARKET_OPEN_TIME && !timeRe.test(_config.MARKET_OPEN_TIME)) {
    warnings.push(`MARKET_OPEN_TIME "${_config.MARKET_OPEN_TIME}" is not HH:MM format`);
  }
  if (_config.MARKET_CLOSE_TIME && !timeRe.test(_config.MARKET_CLOSE_TIME)) {
    warnings.push(`MARKET_CLOSE_TIME "${_config.MARKET_CLOSE_TIME}" is not HH:MM format`);
  }

  // WS_ROOT must use ws:// or wss://
  if (_config.WS_ROOT && !/^wss?:\/\//.test(_config.WS_ROOT)) {
    warnings.push(`WS_ROOT "${_config.WS_ROOT}" does not start with ws:// or wss://`);
  }

  // In production, warn if using the default localhost API
  if (
    (_env === ENVS.CLOUD_PROD) &&
    (_config.API_ROOT.includes('localhost') || _config.API_ROOT.includes('127.0.0.1'))
  ) {
    warnings.push('API_ROOT points to localhost but environment is CLOUD_PROD — set REACT_APP_API_ROOT to your server URL');
  }

  _warnings = [..._warnings, ...warnings];

  if (missing.length > 0) {
    const msg = `Missing required config fields: ${missing.join(', ')}`;
    _origConsole.error(`[DeploymentMode] CRITICAL — ${msg}`);
    emitCritical('env_config_missing',
      `Cockpit cannot start: missing required environment config.\n\nMissing: ${missing.join(', ')}\n\nSet these in your .env file and restart.`,
      { missing, environment: _env }
    );
  }

  warnings.forEach(w => {
    _origConsole.warn(`[DeploymentMode] WARNING — ${w}`);
    emitWarning('env_config_warning', w, { environment: _env });
  });

  return { valid: missing.length === 0, missing, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiter — token bucket
// ─────────────────────────────────────────────────────────────────────────────

function _createRateLimiter(maxCalls, windowMs) {
  const timestamps = [];
  return function isAllowed() {
    const now = Date.now();
    while (timestamps.length && timestamps[0] < now - windowMs) timestamps.shift();
    if (timestamps.length >= maxCalls) return false;
    timestamps.push(now);
    return true;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. applyProductionSettings
// ─────────────────────────────────────────────────────────────────────────────

export function applyProductionSettings() {
  // Silence debug / verbose log traffic
  // eslint-disable-next-line no-console
  console.debug = () => {};
  // eslint-disable-next-line no-console
  console.log   = () => {};

  // Rate-limit warnings: max 20 per minute
  const warnLimiter = _createRateLimiter(20, 60_000);
  // eslint-disable-next-line no-console
  console.warn = (...args) => { if (warnLimiter()) _origConsole.warn(...args); };

  // Rate-limit errors: max 10 per minute
  const errLimiter = _createRateLimiter(10, 60_000);
  // eslint-disable-next-line no-console
  console.error = (...args) => { if (errLimiter()) _origConsole.error(...args); };

  if (window.cockpit) {
    Object.assign(window.cockpit.flags, {
      verboseLogging:     false,
      verboseWs:          false,
      rateLimiting:       true,
      errorSuppression:   true,
      heartbeatWatchdog:  true,
      autoReconnect:      true,
      optimizedRendering: true,
      hotReload:          false,
      consoleTracing:     false,
    });
  }

  _origConsole.log('[DeploymentMode] Production settings applied');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. applyDevelopmentSettings
// ─────────────────────────────────────────────────────────────────────────────

export function applyDevelopmentSettings() {
  // Restore originals in case they were previously overridden
  // eslint-disable-next-line no-console
  console.debug = _origConsole.debug;
  // eslint-disable-next-line no-console
  console.log   = _origConsole.log;
  // eslint-disable-next-line no-console
  console.warn  = _origConsole.warn;
  // eslint-disable-next-line no-console
  console.error = _origConsole.error;

  if (window.cockpit) {
    Object.assign(window.cockpit.flags, {
      verboseLogging:     true,
      verboseWs:          true,
      rateLimiting:       false,
      errorSuppression:   false,
      heartbeatWatchdog:  false,
      autoReconnect:      false,
      optimizedRendering: false,
      hotReload:          true,
      consoleTracing:     true,
    });
  }

  console.log('[DeploymentMode] Development settings applied');
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. prepareBuildArtifacts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CRA/webpack handles the actual minification and tree-shaking.
 * This function:
 *   - Reports which optimizations are active in the current runtime
 *   - Warns if running an unoptimized build in a production environment
 *   - Returns a manifest of build characteristics for the deployment summary
 */
export function prepareBuildArtifacts() {
  if (!_env) detectEnvironment();
  const isProd    = _env === ENVS.LOCAL_PROD || _env === ENVS.CLOUD_PROD;
  const isSandbox = _env === ENVS.SANDBOX;
  const isOptimized = isProd || isSandbox;

  // Warn if the bundle itself is not a production build but we expect optimization
  const nodeEnv = process.env.NODE_ENV;
  if (isOptimized && nodeEnv !== 'production') {
    const w = 'COCKPIT_ENV is production/sandbox but NODE_ENV is not "production" — run `npm run build` for optimized output';
    _warnings.push(w);
    _origConsole.warn(`[DeploymentMode] WARNING — ${w}`);
    emitWarning('build_not_optimized', w);
  }

  const manifest = {
    // CRA production build features (active when NODE_ENV === 'production')
    minifiedJs:           nodeEnv === 'production',
    minifiedCss:          nodeEnv === 'production',
    treeShaking:          nodeEnv === 'production',
    deadCodeRemoval:      nodeEnv === 'production',  // terser
    sourceMaps:           nodeEnv !== 'production',

    // Runtime feature flags
    hotReload:            _env === ENVS.LOCAL_DEV,
    wsHandlersOptimized:  isOptimized,  // reduced verbosity, rate-limited reconnects
    restWrappersOptimized: isOptimized, // timeout + retry enforced

    // Build commands
    buildCommand:   isProd || isSandbox ? 'npm run build' : 'npm start',
    serveCommand:   isProd ? 'npx serve -s build' : 'npm start',
    outputDir:      isProd || isSandbox ? 'build/' : '(webpack dev server, in-memory)',
  };

  if (isOptimized) {
    _origConsole.log('[DeploymentMode] Build artifacts: production mode', manifest);
  } else {
    console.log('[DeploymentMode] Build artifacts: development mode — optimizations inactive', manifest);
  }

  return manifest;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. prepareRuntimeMode
// ─────────────────────────────────────────────────────────────────────────────

export function prepareRuntimeMode() {
  const env = _env   || detectEnvironment();
  const cfg = _config || loadEnvConfig();

  const isProduction = env === ENVS.LOCAL_PROD || env === ENVS.CLOUD_PROD;
  const isDevelopment = env === ENVS.LOCAL_DEV;
  const isCloud       = env === ENVS.CLOUD_PROD;
  const isSandbox     = env === ENVS.SANDBOX;

  window.cockpit = {
    // Mode booleans — read by components at runtime
    isProduction,
    isDevelopment,
    isCloud,
    isSandbox,
    isLocal:       env === ENVS.LOCAL_DEV || env === ENVS.LOCAL_PROD,
    environment:   env,

    // Config snapshot
    apiRoot:      cfg.API_ROOT,
    wsRoot:       cfg.WS_ROOT,
    strategyName: cfg.STRATEGY_NAME,
    logLevel:     cfg.LOG_LEVEL,
    marketOpen:   cfg.MARKET_OPEN_TIME,
    marketClose:  cfg.MARKET_CLOSE_TIME,
    version:      cfg.VERSION,

    // Behavior flags — overwritten by applyProduction/DevelopmentSettings
    flags: {
      verboseLogging:     isDevelopment,
      verboseWs:          isDevelopment,
      rateLimiting:       !isDevelopment,
      errorSuppression:   !isDevelopment,
      heartbeatWatchdog:  !isDevelopment,
      autoReconnect:      !isDevelopment,
      optimizedRendering: !isDevelopment,
      hotReload:          isDevelopment,
      consoleTracing:     isDevelopment,
    },

    // Utilities accessible to all components via window.cockpit
    createRateLimiter: _createRateLimiter,

    // Set to true after initDeploymentMode() completes successfully
    initialized:        false,
    readyForDeployment: false,
  };

  // Notify components that the runtime environment is established
  window.dispatchEvent(new CustomEvent('nq:deployment-mode', {
    detail: {
      environment:  env,
      isProduction,
      isDevelopment,
      isCloud,
      isSandbox,
      flags: window.cockpit.flags,
      apiRoot: cfg.API_ROOT,
      wsRoot:  cfg.WS_ROOT,
    },
  }));

  _origConsole.log(`[DeploymentMode] Runtime mode: ${env}`);
  return window.cockpit;
}

// ─────────────────────────────────────────────────────────────────────────────
// Safety check helpers
// ─────────────────────────────────────────────────────────────────────────────

async function _checkRest(url, label) {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const resp  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return { ok: true, label, url };
  } catch (err) {
    return { ok: false, label, url, error: err.name === 'AbortError' ? 'Timeout (5s)' : err.message };
  }
}

async function _checkWs(url, label) {
  return new Promise(resolve => {
    try {
      const ws    = new WebSocket(url);
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        resolve({ ok: false, label, url, error: 'Connection timeout (5s)' });
      }, 5000);
      ws.onopen = () => {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve({ ok: true, label, url });
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve({ ok: false, label, url, error: 'Connection refused' });
      };
    } catch (err) {
      resolve({ ok: false, label, url, error: err.message });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. runProductionSafetyChecks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifies all critical backend systems are reachable before the cockpit
 * allows trading activity. Emits a critical modal via ErrorWarningSystem on
 * any failure, blocking the UI until acknowledged.
 *
 * Skipped automatically in mock mode (no real backend exists).
 */
export async function runProductionSafetyChecks() {
  if (USE_MOCK) {
    _origConsole.log('[DeploymentMode] Safety checks skipped — USE_MOCK is true');
    return { passed: true, results: [], skipped: true, reason: 'mock_mode' };
  }

  const api = _config?.API_ROOT || API_ROOT;
  const ws  = _config?.WS_ROOT  || api.replace(/^http/, 'ws');

  _origConsole.log('[DeploymentMode] Running pre-flight safety checks…');

  // Run all checks in parallel — don't let one slow check block the others
  const [
    healthCheck,
    strategyCheck,
    riskCheck,
    botStatusCheck,
    wsActivityCheck,
    wsPriceCheck,
    wsLogsCheck,
  ] = await Promise.all([
    _checkRest(`${api}/topstep/health`,          'Health endpoint'),
    _checkRest(`${api}/topstep/strategy/parameters`, 'Strategy parameters'),
    _checkRest(`${api}/topstep/risk/status`,     'Risk limits'),
    _checkRest(`${api}/session/status`,  'Bot status'),
    _checkWs(`${ws}/ws/topstep/activity`,        'Activity WebSocket'),
    _checkWs(`${ws}/ws/topstep/price`,           'Price WebSocket'),
    _checkWs(`${ws}/ws/logs`,            'Logs WebSocket'),
  ]);

  const results  = [healthCheck, strategyCheck, riskCheck, botStatusCheck, wsActivityCheck, wsPriceCheck, wsLogsCheck];
  const failures = results.filter(r => !r.ok);
  const passed   = failures.length === 0;

  if (failures.length > 0) {
    const failList = failures.map(f => `  • ${f.label}: ${f.error}`).join('\n');
    emitCritical(
      'safety_check_failed',
      `Pre-flight system check failed. The following systems could not be reached:\n\n${failList}\n\nVerify the backend is running and try again.`,
      { failures: failures.map(f => ({ label: f.label, error: f.error, url: f.url })) }
    );
    _origConsole.error('[DeploymentMode] Safety check FAILURES:', failures);
  } else {
    _origConsole.log('[DeploymentMode] All safety checks passed ✓');
    window.dispatchEvent(new CustomEvent('nq:deployment-ready', {
      detail: { ready: true, timestamp: new Date().toISOString() },
    }));
  }

  return { passed, results, failures, skipped: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. exportDeploymentSummary
// ─────────────────────────────────────────────────────────────────────────────

export function exportDeploymentSummary(safetyCheckResult = null) {
  const cfg = _config || {};
  const env = _env    || ENVS.LOCAL_DEV;
  const isProd = env === ENVS.LOCAL_PROD || env === ENVS.CLOUD_PROD;

  const missing = REQUIRED_FIELDS.filter(f => !cfg[f] || cfg[f] === '');
  const safetyPassed = !safetyCheckResult
    || safetyCheckResult.passed
    || safetyCheckResult.skipped;

  _summary = {
    environment:                     env,
    nodeEnv:                         process.env.NODE_ENV || 'development',
    apiRoot:                         cfg.API_ROOT          || '(not set)',
    wsRoot:                          cfg.WS_ROOT           || '(not set)',
    strategy:                        cfg.STRATEGY_NAME     || '(not set)',
    logLevel:                        cfg.LOG_LEVEL         || '(not set)',
    marketHours:                     `${cfg.MARKET_OPEN_TIME || '?'} – ${cfg.MARKET_CLOSE_TIME || '?'} ET`,
    version:                         cfg.VERSION           || '0.0.0',
    mockMode:                        USE_MOCK,
    productionOptimizationsEnabled:  isProd,
    missingEnvFields:                missing,
    warnings:                        [..._warnings],
    safetyChecks:                    safetyCheckResult,
    readyForDeployment:              missing.length === 0 && safetyPassed,
    generatedAt:                     new Date().toISOString(),
  };

  if (window.cockpit) {
    window.cockpit.readyForDeployment = _summary.readyForDeployment;
    window.cockpit.initialized        = true;
  }

  // Log summary to BotLogConsole via the deployment-mode event
  window.dispatchEvent(new CustomEvent('nq:deployment-summary', {
    detail: _summary,
  }));

  return _summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deployment-aware WS connection factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a managed WebSocket connection that respects cockpit.flags.
 * In production: reduced reconnect verbosity, enforced backoff.
 * In development: logs every state change.
 *
 * Components can use this instead of their own inline connectWs helper
 * to get automatic cockpit-flag awareness.
 *
 * Returns a cleanup function.
 */
export function createWsConnection(url, onMsg, onOpen, onClose) {
  const flags  = window.cockpit?.flags ?? { verboseWs: true, autoReconnect: true };
  let ws       = null;
  let backoff  = 1000;
  let timer    = null;
  let dead     = false;

  function connect() {
    if (dead) return;
    if (flags.verboseWs) _origConsole.debug(`[WS] connecting: ${url}`);
    try { ws = new WebSocket(url); } catch (err) {
      if (flags.verboseWs) _origConsole.warn(`[WS] open failed: ${err.message}`);
      if (flags.autoReconnect) sched();
      return;
    }
    ws.onopen = () => {
      backoff = 1000;
      if (flags.verboseWs) _origConsole.debug(`[WS] connected: ${url}`);
      onOpen?.();
    };
    ws.onclose = () => {
      if (dead) return;
      if (flags.verboseWs) _origConsole.debug(`[WS] closed: ${url}`);
      onClose?.();
      if (flags.autoReconnect) sched();
    };
    ws.onerror = () => {};
    ws.onmessage = e => {
      try { onMsg(JSON.parse(e.data)); }
      catch { if (flags.verboseWs) _origConsole.warn('[WS] message parse error'); }
    };
  }

  function sched() {
    if (dead) return;
    const jittered = Math.min(backoff * (0.85 + Math.random() * 0.30), 30_000);
    timer   = setTimeout(connect, jittered);
    backoff = Math.min(backoff * 2, 30_000);
  }

  connect();

  return function cleanup() {
    dead = true;
    clearTimeout(timer);
    if (ws) {
      ws.onopen = null; ws.onclose = null; ws.onerror = null; ws.onmessage = null;
      try { ws.close(); } catch {}
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deployment-aware fetch wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * fetch() with:
 *   - 8s timeout (production) / no timeout (development)
 *   - Rate limiting via cockpit.flags.rateLimiting
 *   - One auto-retry on 5xx in production
 *
 * Throws on network failure, timeout, or rate-limit exceeded.
 */
const _fetchLimiter = _createRateLimiter(30, 10_000); // 30 calls per 10s

export async function deployFetch(url, opts = {}) {
  const flags = window.cockpit?.flags ?? {};

  if (flags.rateLimiting && !_fetchLimiter()) {
    throw new Error('[DeploymentMode] Rate limit exceeded — too many API calls');
  }

  const isProd = window.cockpit?.isProduction || window.cockpit?.isSandbox;
  const ctrl   = new AbortController();
  let timer    = null;

  if (isProd) {
    timer = setTimeout(() => ctrl.abort(), 8000);
  }

  const mergedOpts = { ...opts, signal: ctrl.signal };

  try {
    const resp = await fetch(url, mergedOpts);
    clearTimeout(timer);

    // One auto-retry on 5xx in production mode
    if (!resp.ok && resp.status >= 500 && isProd) {
      await new Promise(r => setTimeout(r, 1000));
      return fetch(url, opts);
    }

    return resp;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// initDeploymentMode — full initialization pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orchestrates the full deployment preparation sequence.
 * Safe to call multiple times — subsequent calls return the cached summary.
 *
 * Usage:
 *   // In index.js (before ReactDOM.render) or App.js useEffect:
 *   import initDeploymentMode from './utils/DeploymentMode';
 *   initDeploymentMode().then(summary => console.log(summary));
 *
 * Returns a deployment summary object.
 */
export async function initDeploymentMode() {
  if (_initialized) {
    _origConsole.log('[DeploymentMode] Already initialized — returning cached summary');
    return _summary;
  }
  _initialized = true;
  _warnings    = [];

  _origConsole.log('[DeploymentMode] Initializing…');

  // ① Detect environment + load config (synchronous)
  detectEnvironment();
  loadEnvConfig();

  // ② Create window.cockpit before applying settings
  prepareRuntimeMode();

  // ③ Validate config — emits critical modal if required fields are missing
  const { valid, missing } = validateEnvConfig();

  // ④ Apply environment-specific console + flag settings
  if (window.cockpit.isProduction || window.cockpit.isSandbox) {
    applyProductionSettings();
  } else {
    applyDevelopmentSettings();
  }

  // ⑤ Build artifact manifest
  prepareBuildArtifacts();

  // ⑥ Abort if config is invalid — critical modal already shown to the user
  if (!valid) {
    _origConsole.error('[DeploymentMode] Initialization aborted — missing fields:', missing);
    const summary = exportDeploymentSummary(null);
    summary.readyForDeployment = false;
    return summary;
  }

  // ⑦ Async safety checks (production & sandbox only)
  let safetyResult;
  if (window.cockpit.isProduction || window.cockpit.isCloud || window.cockpit.isSandbox) {
    safetyResult = await runProductionSafetyChecks();
  } else {
    // Development — trust the backend is up (or running in mock mode)
    safetyResult = { passed: true, results: [], skipped: true, reason: 'development_mode' };
  }

  // ⑧ Generate and broadcast final summary
  const summary = exportDeploymentSummary(safetyResult);

  if (summary.readyForDeployment) {
    _origConsole.log('[DeploymentMode] ✓ Cockpit ready for deployment', summary);
  } else {
    _origConsole.error('[DeploymentMode] ✗ Cockpit NOT ready — see summary', summary);
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience accessors — read the initialized state from any module
// ─────────────────────────────────────────────────────────────────────────────

export const getConfig      = () => _config   ? { ..._config }   : null;
export const getEnvironment = () => _env;
export const getSummary     = () => _summary;
export const isReady        = () => window.cockpit?.readyForDeployment === true;
export const isInitialized  = () => _initialized;

export default initDeploymentMode;
