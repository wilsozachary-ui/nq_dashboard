import { getSessionToken } from './sessionToken';

// Same-origin fallback: works unmodified for both the desktop exe (frontend
// and adapter always served from the same http://localhost:8080 origin) and
// a cloud container (each tenant's frontend+API share their own origin).
// Local `npm start` (CRA dev server on :3000, adapter separately on :8080)
// overrides these via .env.development.
function sameOriginHttp() {
  return `${window.location.protocol}//${window.location.host}`;
}
function sameOriginWs() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}`;
}

export const BOT_API_ROOT = process.env.REACT_APP_BOT_API_URL || sameOriginHttp();
export const BOT_WS_URL = process.env.REACT_APP_BOT_WS_URL || sameOriginWs();

// The launcher is a separate always-on local service (not the adapter
// itself) -- it's the one thing that has to already be running so the
// On/Off control has something to talk to even when the backend is off.
export const LAUNCHER_ROOT = process.env.REACT_APP_LAUNCHER_URL || 'http://localhost:8090';

async function launcherRequest(path, init = {}) {
  const response = await fetch(`${LAUNCHER_ROOT}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || `${init.method || 'GET'} ${path} failed (${response.status})`);
  }
  return body;
}

async function request(path, init = {}, signal) {
  const token = getSessionToken();
  const headers = token ? { ...init.headers, Authorization: `Bearer ${token}` } : init.headers;
  const response = await fetch(`${BOT_API_ROOT}${path}`, { ...init, headers, signal: signal || init.signal });
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${path} failed (${response.status})`);
  }
  const body = await response.json();
  if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'ok') && Object.prototype.hasOwnProperty.call(body, 'data')) {
    return body.data;
  }
  return body;
}

function get(path, signal) {
  return request(path, { method: 'GET' }, signal);
}

function post(path, body, signal) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }, signal);
}

// Returns the full { ok, ts, data, error } envelope instead of unwrapping to
// `data` -- callers of /testbot/start|stop|flatten need to see `ok:false`
// business-logic failures (e.g. "already_active", "no_price"), which come
// back as HTTP 200 and would otherwise be silently swallowed by request()'s
// generic unwrap.
async function postEnvelope(path, body, signal) {
  const token = getSessionToken();
  const response = await fetch(`${BOT_API_ROOT}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
    signal,
  });
  const envelope = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(envelope?.error?.message || `POST ${path} failed (${response.status})`);
  }
  return envelope;
}

async function getFirst(paths, signal, fallback = null) {
  for (const path of paths) {
    try {
      return await get(path, signal);
    } catch {
      // Continue trying compatible endpoint aliases.
    }
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`No compatible endpoint found: ${paths.join(', ')}`);
}

function normalizeTelemetry(telemetry = {}) {
  const market = telemetry.market || {};
  const feed = telemetry.feed || {};
  const account = telemetry.account || {};
  const pnl = telemetry.pnl || {};
  const activeTrade = telemetry.active_trade || null;
  const bot = telemetry.bot || {};
  return {
    market,
    feed,
    account,
    pnl,
    active_trade: activeTrade,
    status: bot.status || telemetry.status || 'unknown',
    connection: bot.connection || telemetry.connection || 'disconnected',
  };
}

async function getTelemetry(signal) {
  const telemetry = await getFirst(['/telemetry', '/market/price-snapshot'], signal, {});
  return normalizeTelemetry(telemetry || {});
}

async function getCompositeSnapshot(signal) {
  const [telemetry, orbSnapshot, signalsSnapshot, testbot, risk] = await Promise.all([
    getTelemetry(signal).catch(() => ({})),
    getFirst(['/orb', '/orb/health'], signal, {}).catch(() => ({})),
    getFirst(['/signals'], signal, {}).catch(() => ({})),
    getFirst(['/testbot', '/strategy/parameters'], signal, {}).catch(() => ({})),
    getFirst(['/risk', '/risk/status'], signal, {}).catch(() => ({})),
  ]);

  const market = telemetry.market || {};
  const feed = telemetry.feed || {};
  const account = telemetry.account || {};
  const pnl = telemetry.pnl || {};
  const activeTrade = telemetry.active_trade || testbot.position || null;

  return {
    market: {
      price: market.price ?? null,
      bid: market.bid ?? null,
      ask: market.ask ?? null,
      timestamp: market.timestamp,
      ...market,
    },
    feed: {
      latency_ms: feed.latency_ms ?? null,
      stale: feed.stale ?? false,
      ...feed,
    },
    status: telemetry.status || testbot.status || 'unknown',
    connection: telemetry.connection || 'disconnected',
    account: account.account_id || testbot.account_id || null,
    pnl: pnl.realized ?? pnl.unrealized ?? null,
    active_trade: activeTrade,
    orb_snapshot: orbSnapshot || {},
    signals_snapshot: signalsSnapshot || {},
    trailing: testbot.trailing || {},
    risk: risk || {},
    testbot: testbot || {},
  };
}

const botApi = {
  getPrice: async signal => {
    const t = await getTelemetry(signal);
    return {
      price: t.market?.price ?? null,
      bid: t.market?.bid ?? null,
      ask: t.market?.ask ?? null,
      timestamp: t.market?.timestamp,
    };
  },
  getBidAsk: async signal => {
    const t = await getTelemetry(signal);
    return {
      bid: t.market?.bid ?? null,
      ask: t.market?.ask ?? null,
      spread: t.market?.bid != null && t.market?.ask != null ? t.market.ask - t.market.bid : null,
      timestamp: t.market?.timestamp,
    };
  },
  getTick: async signal => {
    const t = await getTelemetry(signal);
    return {
      tick: t.feed?.tick_monotonic ?? null,
      timestamp: t.market?.timestamp,
    };
  },
  getFeedStatus: async signal => {
    const t = await getTelemetry(signal);
    const connected = t.connection === 'Connected' || t.connection === 'connected';
    return {
      feeds: true,
      strategy: true,
      risk: true,
      execution: connected,
      // Whether the position-tracking pipeline is available, not whether a
      // trade happens to be open right now -- using "no open position" as
      // a health failure would read ERR any time the bot is simply flat.
      position: connected,
      status: t.status,
      connection: t.connection,
      wsClients: 1,
    };
  },
  getFeedLatency: async signal => {
    // t.feed.latency_ms is "time since this instrument's price last
    // changed" (from the exchange feed's own lastUpdated field), not
    // network/WS transit time -- it legitimately grows into the seconds
    // during quiet market moments and isn't a connection problem, so it's
    // exposed as `latency` but deliberately not reused as `wsLatency`
    // (there's no real WS ping/pong round-trip to measure here).
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const t = await getTelemetry(signal);
    const apiLatency = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return {
      latency: t.feed?.latency_ms ?? null,
      wsLatency: null,
      apiLatency,
      stale: t.feed?.stale ?? false,
    };
  },
  getAccounts: async signal => {
    const accounts = await getFirst(['/accounts'], signal, []);
    return Array.isArray(accounts) ? accounts : [];
  },
  getAccountSettings: signal => getFirst(['/testbot', '/strategy/parameters'], signal, {}),
  getPositions: async signal => {
    const t = await getTelemetry(signal);
    const p = t.active_trade;
    if (!p) return [];
    return [{
      side: p.side,
      direction: p.side,
      qty: p.quantity,
      entryPrice: p.entry_price,
      takeProfit: p.take_profit,
      stopLoss: p.stop_loss,
      unrealizedPnl: p.upl,
      realizedPnl: p.rpl,
      status: p.state,
    }];
  },
  getOpenOrders: (_signal) => Promise.resolve([]),
  getOrderStatus: (_id, _signal) => Promise.resolve({}),
  getBars: (_unit = 2, _unitNumber = 1, _limit = 240, _signal) => Promise.resolve([]),
  getContract: signal => getFirst(['/testbot', '/strategy/parameters'], signal, {}),
  getAuthStatus: async signal => {
    const t = await getTelemetry(signal);
    return { authenticated: t.connection === 'Connected' || t.connection === 'connected' };
  },

  postBuyOrder: (body, signal) => post('/activity/event', { type: 'buy', ...body }, signal),
  postSellOrder: (body, signal) => post('/activity/event', { type: 'sell', ...body }, signal),
  postFlattenOrder: (body = {}, signal) => post('/strategy/pause', body, signal),

  getHealth: signal => get('/health', signal),
  getRisk: signal => getFirst(['/risk', '/risk/status'], signal, {}),
  getRawTelemetry: signal => getFirst(['/telemetry'], signal, {}),

  // Trade Recap tab -- per-day trade lifecycle history (orders placed,
  // entry, TP/SL, trailing adjustments, close) plus win/loss streaks.
  // Pure historical REST read, no WebSocket involved.
  getRecapDay: (date, strategy, accountId, signal) => {
    const params = new URLSearchParams({ date });
    if (strategy && strategy !== 'overall') params.set('strategy', strategy);
    if (accountId) params.set('account_id', accountId);
    return get(`/recap/day?${params.toString()}`, signal);
  },

  // Trade Recap tab -- opening-candle metrics + the Morning Strategy Live
  // trade that ran that day (params used, outcome), joined server-side by
  // date. See app/adapter_api/routers/morning_candle.py.
  getMorningStrategyDailySummary: (date, signal) => get(`/morning_strategy/daily_summary/${date}`, signal),

  // AI Insights tab -- one card per Mon-Fri trading weekday (historical
  // candle behavior + weekday-specific recommendation). account_id filters
  // the win-rate/contract-size guidance to that account only; candle
  // range/volatility is market-wide and unaffected by it. See
  // app/adapter_api/routers/morning_strategy_ai.py.
  getWeekdayInsights: (accountId, signal) => {
    const params = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
    return get(`/morning_strategy/ai/weekday_insights${params}`, signal);
  },

  getSignals: signal => getFirst(['/signals'], signal, {}),
  getOrbState: signal => getFirst(['/orb', '/orb/health'], signal, {}),
  getOrbTrades: async signal => {
    const signals = await getFirst(['/signals', '/topstep/activity/snapshot'], signal, {});
    return Array.isArray(signals?.events) ? signals.events : Array.isArray(signals) ? signals : [];
  },
  getOrbBias: signal => getFirst(['/orb', '/orb/strategy/parameters'], signal, {}),
  getOrbRange: signal => getFirst(['/orb', '/orb/strategy/parameters'], signal, {}),
  getOrbBreakout: signal => getFirst(['/orb', '/orb/strategy/parameters'], signal, {}),
  orbStop: signal => post('/orb/stop', {}, signal),
  orbFlatten: signal => post('/orb/flatten', {}, signal),
  getOrbPnl: async signal => {
    const t = await getTelemetry(signal);
    return {
      realized: t.pnl?.realized ?? null,
      unrealized: t.pnl?.unrealized ?? null,
      total: t.pnl?.realized ?? t.pnl?.unrealized ?? null,
      timestamp: t.market?.timestamp,
    };
  },

  getTestbotSnapshot: signal => getCompositeSnapshot(signal),
  postTestbotStart: (body = {}, signal) => post('/strategy/start', body, signal),
  postTestbotStop: (body = {}, signal) => post('/strategy/pause', body, signal),

  getTrailingStatus: async signal => {
    const testbot = await getFirst(['/testbot', '/strategy/parameters'], signal, {});
    return {
      enabled: !!testbot?.trailing?.enabled,
      distance: testbot?.trailing?.offset_points ?? null,
      stopLoss: testbot?.position?.trailing_stop ?? testbot?.position?.sl_price ?? null,
      takeProfit: testbot?.position?.tp_price ?? null,
    };
  },
  getTrailingExtreme: async signal => {
    const t = await getTelemetry(signal);
    return { price: t.market?.price ?? null };
  },
  getTrailingStop: async signal => {
    const testbot = await getFirst(['/testbot', '/strategy/parameters'], signal, {});
    return {
      stopLoss: testbot?.position?.trailing_stop ?? testbot?.position?.sl_price ?? null,
      takeProfit: testbot?.position?.tp_price ?? null,
      enabled: !!testbot?.trailing?.enabled,
      distance: testbot?.trailing?.offset_points ?? null,
    };
  },
  getTrailingUpdate: signal => botApi.getTrailingStop(signal),

  // Real TestBotEngine control (Morning Strategy Live + Practice) -- Live
  // and Practice are independent engines/routes on the backend (separate
  // EngineRegistry slots), never sharing state -- distinct from the
  // postTestbotStart/postTestbotStop stubs above, which hit the no-op
  // /strategy/start|pause placeholder routes.
  getLiveBot: signal => get('/testbot/live', signal),
  armLiveBot: (payload = {}, signal) => postEnvelope('/testbot/live/arm', payload, signal),
  offLiveBot: signal => postEnvelope('/testbot/live/off', {}, signal),
  flattenLiveBot: signal => postEnvelope('/testbot/live/flatten', {}, signal),

  getPracticeBot: signal => get('/testbot/practice', signal),
  startPracticeBot: (payload = {}, signal) => postEnvelope('/testbot/practice/start', payload, signal),
  stopPracticeBot: signal => postEnvelope('/testbot/practice/stop', {}, signal),
  flattenPracticeBot: signal => postEnvelope('/testbot/practice/flatten', {}, signal),

  // Backend process control via the always-on local launcher service --
  // this is what actually starts/stops the headless nq_bot process, not
  // the adapter itself (which isn't running at all while "off").
  getBackendStatus: () => launcherRequest('/status'),
  startBackend: () => launcherRequest('/start', { method: 'POST' }),
  stopBackend: () => launcherRequest('/stop', { method: 'POST' }),
};

export default botApi;
