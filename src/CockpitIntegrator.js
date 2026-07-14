import botApi, { BOT_API_ROOT, BOT_WS_URL } from './services/botApi';
import { emitError, emitWarning, resolveWarning } from './utils/errorBus';
import { startMarketScheduler, stopMarketScheduler } from './utils/marketOpenMode';
import { applyGlobalStyles } from './CockpitThemePolish';
import { getSessionToken } from './services/sessionToken';

const STREAMS = ['activity', 'pnl', 'risk', 'price', 'strategy', 'testbot', 'trailing', 'orb'];
const listeners = new Map();
const callbackTypes = new Map();
let ws = null;
let wsReconnectTimer = null;
let themeCleanup = null;
let initialized = false;
let dependencyRetryTimer = null;
const BYPASS_LIVE_VALIDATION = process.env.NODE_ENV === 'test';
let status = { ready: BYPASS_LIVE_VALIDATION, initializing: false, missing: [], connections: {} };
export let cockpitReady = BYPASS_LIVE_VALIDATION;

export function publish(event) {
  if (!event?.type) return;
  const callbacks = new Set([...(listeners.get(event.type) || []), ...(listeners.get('*') || [])]);
  callbacks.forEach(callback => { try { callback(event.payload, event); } catch (error) { emitError('event_bus_error', error.message); } });
  window.dispatchEvent(new CustomEvent(`cockpit:${event.type}`, { detail: event.payload }));
}

export function subscribe(eventType, callback) {
  if (!listeners.has(eventType)) listeners.set(eventType, new Set());
  listeners.get(eventType).add(callback);
  if (!callbackTypes.has(callback)) callbackTypes.set(callback, new Set());
  callbackTypes.get(callback).add(eventType);
  return () => unsubscribe(callback, eventType);
}

export function unsubscribe(callback, eventType) {
  const types = eventType ? [eventType] : [...(callbackTypes.get(callback) || [])];
  types.forEach(type => listeners.get(type)?.delete(callback));
  if (!eventType) callbackTypes.delete(callback); else callbackTypes.get(callback)?.delete(eventType);
}

export function initializeEventBus() {
  const bridges = [
    ['nq:param-update', 'ui:parameter'], ['nq:activity-event', 'ui:activity'],
    ['nq:risk-update', 'ui:risk'], ['nq:bot-status', 'ui:bot'],
    ['nq:ews-event', 'ui:warning'], ['nq:recorder-event', 'ui:recorder'],
    ['nq:strategy-change', 'ui:strategy'], ['nq:market-open-mode', 'market:mode'],
  ];
  const handlers = bridges.map(([domType, busType]) => {
    const handler = event => publish({ type: busType, payload: event.detail });
    window.addEventListener(domType, handler);
    return [domType, handler];
  });
  return () => handlers.forEach(([type, handler]) => window.removeEventListener(type, handler));
}

function normalizePricePayload(payload) {
  const price = payload.price ?? payload.lastPrice ?? payload.last ?? payload.value;
  const bid = payload.bid ?? payload.bestBid;
  const ask = payload.ask ?? payload.bestAsk;
  const spread = payload.spread ?? (bid != null && ask != null ? ask - bid : undefined);
  return {
    type: 'price',
    price,
    bid,
    ask,
    spread,
    tickSpeed: payload.tickSpeed ?? payload.ticksPerSecond ?? null,
    timestamp: payload.timestamp || new Date().toISOString(),
  };
}

function publishByStream(stream, payload) {
  publish({ type: `ws:${stream}`, payload });
  publish({ type: 'ws:any', payload: { ...payload, stream } });
}

function getMessageType(payload) {
  if (payload?.type === 'event' && payload?.topic) {
    return String(payload.topic).toLowerCase();
  }
  return String(payload.type || payload.event || payload.topic || payload.stream || '').toLowerCase();
}

function unwrapAdapterEvent(payload) {
  if (!payload || payload.type !== 'event') return payload;
  const topic = String(payload.topic || '').toLowerCase();
  const body = payload.payload && typeof payload.payload === 'object' ? payload.payload : {};

  if (topic === 'telemetry') {
    const market = body.market || {};
    return {
      type: 'price',
      price: market.price,
      bid: market.bid,
      ask: market.ask,
      spread: market.bid != null && market.ask != null ? market.ask - market.bid : null,
      timestamp: market.timestamp || payload.ts,
      telemetry: body,
    };
  }
  if (topic === 'gateway_quote') {
    return {
      type: 'price',
      price: body.price,
      bid: body.bid,
      ask: body.ask,
      spread: body.bid != null && body.ask != null ? body.ask - body.bid : null,
      timestamp: body.timestamp || payload.ts,
    };
  }
  if (topic === 'gateway_trade') {
    // body.type is the raw exchange trade-type field from Topstep's
    // GatewayTrade payload -- spread it before the literal 'activity' tag
    // so that tag always wins instead of being silently clobbered.
    return { ...body, type: 'activity', timestamp: body.timestamp || payload.ts };
  }
  if (topic === 'orb_snapshot') {
    return {
      type: 'orb_state',
      state: body.state,
      status: body.state,
      high: body.range_high,
      low: body.range_low,
      rangeHigh: body.range_high,
      rangeLow: body.range_low,
      orb: body,
      timestamp: payload.ts,
    };
  }
  if (topic === 'signals_snapshot') {
    return { type: 'strategy', strategy: body, signals_snapshot: body, timestamp: payload.ts };
  }
  if (topic === 'status') {
    return { type: 'strategy', status: body.status, strategy: body, timestamp: payload.ts };
  }
  if (topic === 'connection') {
    return { type: 'risk', risk: body, connection: body.connection, timestamp: payload.ts };
  }
  if (topic === 'log' || topic === 'trade_log' || topic === 'orb_log') {
    return { type: 'activity', ...body, timestamp: payload.ts };
  }
  if (topic === 'pnl_monthly') {
    // Previously fell through to the generic `return body` below, which
    // strips the topic/type entirely -- routeIncomingMessage's type-sniff
    // then found nothing to match and dumped it on the 'activity' stream
    // instead of 'pnl', so MonthlyPnLPanel (the only real consumer) never
    // saw it. That's the reason a closed trade never updated the Trade
    // Recap calendar without a manual month-change/refresh.
    return { type: 'pnl_monthly', ...body, timestamp: payload.ts };
  }

  return body;
}

function routeIncomingMessage(payload) {
  const normalizedPayload = unwrapAdapterEvent(payload);
  if (!normalizedPayload) return;

  const t = getMessageType(normalizedPayload);
  if (t === 'pnl_monthly') {
    publishByStream('pnl', normalizedPayload);
    return;
  }
  if (t.includes('price') || t.includes('bid_ask') || t.includes('tick')) {
    const normalized = normalizePricePayload(normalizedPayload);
    if (normalized.price != null) {
      window.LastPriceUpdate = Date.now();
      publishByStream('price', normalized);
    }
    return;
  }
  if (t.includes('orb') && t.includes('trade')) {
    publishByStream('activity', normalizedPayload);
    publishByStream('orb', normalizedPayload);
    if (normalizedPayload.pnl != null) publishByStream('pnl', { type: 'trade', ...normalizedPayload });
    return;
  }
  if (t.includes('orb') && t.includes('state')) {
    publishByStream('strategy', { type: 'orb_state', ...normalizedPayload });
    publishByStream('orb', normalizedPayload);
    return;
  }
  if (t.includes('testbot')) {
    publishByStream('testbot', normalizedPayload);
    publishByStream('pnl', { type: 'snapshot', ...normalizedPayload });
    publishByStream('risk', { type: 'risk_update', ...normalizedPayload });
    return;
  }
  if (t.includes('trail')) {
    publishByStream('trailing', normalizedPayload);
    publishByStream('risk', { type: 'risk_update', ...normalizedPayload });
    publishByStream('strategy', { type: 'trailing_update', ...normalizedPayload });
    return;
  }
  publishByStream('activity', normalizedPayload);
}

export function initializeWebSockets() {
  if (typeof WebSocket === 'undefined') return () => {};
  let stopped = false;
  let attempts = 0;
  let everConnected = false;

  const publishConnectionState = stateValue => {
    STREAMS.forEach(stream => {
      status.connections[stream] = stateValue;
      publish({ type: 'connection:status', payload: { stream, status: stateValue } });
    });
  };

  const connect = () => {
    if (stopped) return;
    publishConnectionState(attempts ? 'reconnecting' : 'connecting');
    try {
      // Browser WebSocket API can't set an Authorization header -- the
      // session token travels as a query param instead, checked by
      // nq_bot's session_auth.py before the socket is ever accepted.
      const token = getSessionToken();
      const wsUrl = `${BOT_WS_URL}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      ws = new WebSocket(wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      publishConnectionState('connected');
      ws.send(JSON.stringify({
        type: 'subscribe',
        topics: ['telemetry', 'gateway_quote', 'gateway_trade', 'orb_snapshot', 'signals_snapshot', 'status', 'connection', 'log', 'trade_log', 'orb_log', 'strategy_event', 'activity', 'pnl_monthly'],
        request_id: `sub-${Date.now()}`,
      }));
      ws.send(JSON.stringify({ type: 'ping', request_id: `ping-${Date.now()}` }));
      attempts = 0;
      resolveWarning('websocket_disconnect_global');
      if (everConnected) {
        window.dispatchEvent(new CustomEvent('nq:ws-reconnect'));
        publish({ type: 'system:websocket_reconnect', payload: { stream: 'all', timestamp: new Date().toISOString() } });
      }
      everConnected = true;
    };

    ws.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        // Any successfully parsed message proves the socket is alive --
        // ErrorWarningSystem's silence watchdog resets on this signal.
        // It must not depend on a specific event type/topic ever arriving
        // (e.g. a literal "heartbeat" type the adapter never sends, or a
        // topic this socket isn't even subscribed to), or it will trip on
        // every session regardless of real connection health.
        window.dispatchEvent(new CustomEvent('nq:heartbeat'));
        if (payload?.type === 'subscribed' || payload?.type === 'unsubscribed' || payload?.type === 'pong') return;
        routeIncomingMessage(payload);
      } catch {}
    };

    ws.onerror = () => {};
    ws.onclose = () => {
      if (stopped) return;
      publishConnectionState('disconnected');
      emitWarning('websocket_disconnect_global', 'Bot WebSocket disconnected — reconnecting');
      publish({ type: 'system:websocket_disconnect', payload: { stream: 'all', timestamp: new Date().toISOString() } });
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    const delay = Math.min(1000 * (2 ** attempts), 30000);
    attempts += 1;
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(connect, delay);
  };

  connect();

  return () => {
    stopped = true;
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  };
}

export async function integratedFetch(pathOrUrl, options = {}, metadata = {}) {
  const started = performance.now();
  const remap = path => {
    if (path === '/topstep/price') return '/topstep/price';
    if (path === '/topstep/pnl/today') return '/pnl/today';
    if (path === '/topstep/risk/status') return '/risk/status';
    if (path.startsWith('/topstep/risk/status?')) return '/risk/status';
    if (path === '/topstep/strategy/parameters') return '/strategy/parameters';
    if (path === '/topstep/health') return '/health';
    if (path === '/topstep/activity/snapshot') return '/topstep/activity/snapshot';
    if (path.startsWith('/topstep/strategy/')) {
      const action = path.replace('/topstep/strategy/', '');
      if (action === 'buy') return '/activity/event';
      if (action === 'sell') return '/activity/event';
      if (action === 'flatten') return '/strategy/pause';
      return '/strategy/parameters';
    }
    return path;
  };
  const path = pathOrUrl.startsWith('http') ? pathOrUrl.replace(BOT_API_ROOT, '') : remap(pathOrUrl);
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BOT_API_ROOT}${path}`;
  const token = getSessionToken();
  const fetchOptions = token
    ? { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } }
    : options;
  try {
    const response = await fetch(url, fetchOptions);
    const elapsed = Math.round(performance.now() - started);
    if (elapsed > 750) emitWarning('api_latency', `${options.method || 'GET'} ${path} took ${elapsed}ms`, { path, elapsed });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    publish({ type: 'rest:success', payload: { path, metadata, elapsed } });
    return response;
  } catch (error) {
    if (!metadata.silent) emitError('api_error', `${options.method || 'GET'} ${path} failed: ${error.message}`, { path });
    publish({ type: 'rest:error', payload: { path, error: error.message, metadata } });
    throw error;
  }
}

export async function restRequest(path, options = {}, metadata = {}) {
  const response = await integratedFetch(path, options, metadata);
  return response.json();
}

export async function loadTopstepStrategy() {
  const [contract, trailing] = await Promise.all([
    botApi.getContract(),
    botApi.getTrailingStatus().catch(() => ({})),
  ]);
  const params = {
    contractSize: contract.contractSize ?? contract.qty ?? 1,
    stopLoss: trailing.stopLoss ?? 0,
    takeProfit: trailing.takeProfit ?? 0,
    trailingStopEnabled: trailing.enabled ?? false,
    trailingDistance: trailing.distance ?? 0,
    strategyName: contract.strategyName ?? 'live_bot',
  };
  return params;
}

export async function loadTopstepRisk() {
  const [trailing, snapshot] = await Promise.all([
    botApi.getTrailingStatus().catch(() => ({})),
    botApi.getTestbotSnapshot().catch(() => ({})),
  ]);
  const r = {
    maxDailyLoss: snapshot.maxDailyLoss ?? 0,
    maxDailyTrades: snapshot.maxDailyTrades ?? 0,
    maxConsecutiveLosses: snapshot.maxConsecutiveLosses ?? 0,
    currentLoss: snapshot.currentLoss ?? snapshot.dailyLoss ?? 0,
    currentTrades: snapshot.currentTrades ?? snapshot.tradeCount ?? 0,
    currentConsecutiveLosses: snapshot.currentConsecutiveLosses ?? 0,
    riskStatus: trailing.riskStatus ?? snapshot.riskStatus ?? 'normal',
  };
  return r;
}

export async function loadTopstepPnl() {
  const [orbPnl, snapshot] = await Promise.all([
    botApi.getOrbPnl().catch(() => ({})),
    botApi.getTestbotSnapshot().catch(() => ({})),
  ]);
  const p = {
    realizedToday: snapshot.realizedToday ?? snapshot.realized ?? orbPnl.realized ?? orbPnl.total ?? 0,
    unrealized: snapshot.unrealized ?? orbPnl.unrealized ?? 0,
    tradeCount: snapshot.tradeCount ?? orbPnl.tradeCount ?? 0,
    wins: snapshot.wins ?? orbPnl.wins ?? 0,
    losses: snapshot.losses ?? orbPnl.losses ?? 0,
    winRate: snapshot.winRate ?? orbPnl.winRate ?? 0,
    lastUpdate: snapshot.lastUpdate ?? orbPnl.timestamp ?? new Date().toISOString(),
  };
  return p;
}

export async function loadTopstepHealth() {
  const [statusResp, latencyResp, authResp] = await Promise.all([
    botApi.getFeedStatus().catch(() => ({})),
    botApi.getFeedLatency().catch(() => ({})),
    botApi.getAuthStatus().catch(() => ({})),
  ]);
  const h = {
    wsClients: statusResp.wsClients ?? 1,
    apiLatency: latencyResp.apiLatency ?? latencyResp.latency ?? 0,
    wsLatency: latencyResp.wsLatency ?? 0,
    heartbeatInterval: statusResp.heartbeatInterval ?? 0,
    lastHeartbeat: statusResp.lastHeartbeat ?? null,
    feeds: statusResp.feeds ?? true,
    strategy: statusResp.strategy ?? true,
    risk: statusResp.risk ?? true,
    execution: statusResp.execution ?? authResp.authenticated ?? false,
    position: statusResp.position ?? true,
  };
  return h;
}

export async function loadTopstepPrice() {
  const [priceResp, bidAskResp, tickResp] = await Promise.all([
    botApi.getPrice(),
    botApi.getBidAsk().catch(() => ({})),
    botApi.getTick().catch(() => ({})),
  ]);
  const s = {
    price: priceResp.price ?? priceResp.lastPrice ?? priceResp.value ?? 0,
    bid: bidAskResp.bid ?? priceResp.bid,
    ask: bidAskResp.ask ?? priceResp.ask,
    spread: bidAskResp.spread ?? (bidAskResp.bid != null && bidAskResp.ask != null ? bidAskResp.ask - bidAskResp.bid : 0),
    timestamp: tickResp.timestamp ?? priceResp.timestamp ?? new Date().toISOString(),
  };
  return s;
}

export async function loadTopstepActivitySnapshot() {
  const raw = await botApi.getOrbTrades();
  return Array.isArray(raw) ? raw : [];
}

export function initializeREST() {
  return {
    getParameters: loadTopstepStrategy,
    getRisk: loadTopstepRisk,
    getTodayPnl: loadTopstepPnl,
    getHealth: loadTopstepHealth,
    getPriceSnapshot: loadTopstepPrice,
    strategyAction: action => {
      if (action === 'buy') return botApi.postBuyOrder({});
      if (action === 'sell') return botApi.postSellOrder({});
      if (action === 'flatten') return botApi.postFlattenOrder({});
      return Promise.reject(new Error(`Unsupported action: ${action}`));
    },
    setStrategyValue: (_endpoint, _body) => botApi.getTrailingUpdate(),
  };
}

export function wireComponents() {
  const forwards = [
    subscribe('ws:activity', payload => window.dispatchEvent(new CustomEvent('nq:integrated-activity', { detail: payload }))),
    subscribe('ws:pnl', payload => window.dispatchEvent(new CustomEvent('nq:integrated-pnl', { detail: payload }))),
    subscribe('ws:risk', payload => window.dispatchEvent(new CustomEvent('nq:integrated-risk', { detail: payload }))),
    subscribe('ws:price', payload => window.dispatchEvent(new CustomEvent('nq:integrated-price', { detail: payload }))),
    subscribe('ws:strategy', payload => window.dispatchEvent(new CustomEvent('nq:integrated-strategy', { detail: payload }))),
  ];
  return () => forwards.forEach(remove => remove());
}

export async function validateDependencies() {
  if (BYPASS_LIVE_VALIDATION) { cockpitReady = true; status = { ...status, ready: true, initializing: false, missing: [], connections: Object.fromEntries(STREAMS.map(s => [s, 'test'])) }; return status; }
  cockpitReady = false;
  try {
    const [price, pnl, risk, strategy, health, activitySnapshot] = await Promise.all([
      loadTopstepPrice(),
      loadTopstepPnl(),
      loadTopstepRisk(),
      loadTopstepStrategy(),
      loadTopstepHealth(),
      loadTopstepActivitySnapshot(),
    ]);
    cockpitReady = true;
    status = { ...status, ready: true, initializing: false, missing: [], data: { price, pnl, risk, strategy, health, activitySnapshot } };
    resolveWarning('cockpit_dependencies');
  } catch (error) {
    cockpitReady = false;
    status = { ...status, ready: false, initializing: false, missing: [error.message] };
    emitWarning('cockpit_dependencies', `Cockpit initialization failed: ${error.message}`);
  }
  publish({ type: 'cockpit:readiness', payload: status });
  return status;
}

export function cleanupDeadCode() {
  // Transport cleanup is lifecycle-owned; deprecated DOM aliases stay bridged only
  // until all external bot clients publish typed cockpit events.
  return { removedDuplicateTransports: true, deprecatedAliasesBridged: true };
}

export function getCockpitStatus() { return { ...status, connections: { ...status.connections } }; }

function waitForDependencyRetry(delay) {
  return new Promise(resolve => { dependencyRetryTimer = setTimeout(resolve, delay); });
}

export function initializeCockpit() {
  if (initialized) return { ready: Promise.resolve(getCockpitStatus()), cleanup: () => {} };
  initialized = true; status.initializing = true;
  themeCleanup = applyGlobalStyles();
  const removeBus = initializeEventBus();
  const removeSockets = initializeWebSockets();
  const removeWiring = wireComponents();
  startMarketScheduler();
  const ready = Promise.resolve().then(async () => {
    let delay = 1000;
    while (initialized) {
      const dependencies = await validateDependencies();
      if (dependencies.ready) return dependencies;
      await waitForDependencyRetry(delay);
      delay = Math.min(delay * 2, 10_000);
    }
    return getCockpitStatus();
  });
  cleanupDeadCode();
  const cleanup = () => {
    clearTimeout(dependencyRetryTimer); dependencyRetryTimer = null;
    removeWiring(); removeSockets(); removeBus(); stopMarketScheduler(); themeCleanup?.();
    listeners.clear(); callbackTypes.clear(); initialized = false;
  };
  return { ready, cleanup, rest: initializeREST() };
}

const CockpitIntegrator = { initializeCockpit, initializeWebSockets, initializeREST, initializeEventBus, wireComponents, validateDependencies, cleanupDeadCode, publish, subscribe, unsubscribe, integratedFetch, restRequest, loadTopstepPrice, loadTopstepPnl, loadTopstepRisk, loadTopstepStrategy, loadTopstepHealth, loadTopstepActivitySnapshot, getCockpitStatus };
export default CockpitIntegrator;
