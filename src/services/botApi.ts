export type AnyObject = Record<string, any>;

export type BotOrderBody = {
  account_id?: string;
  qty?: number;
  quantity?: number;
  symbol?: string;
  side?: 'buy' | 'sell';
  [key: string]: any;
};

export const BOT_API_ROOT = process.env.REACT_APP_BOT_API_URL || 'http://localhost:8080';
export const BOT_WS_URL = process.env.REACT_APP_BOT_WS_URL || 'ws://localhost:8080';

async function request<T = AnyObject>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${BOT_API_ROOT}${path}`, { ...init, signal: signal || init.signal });
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${path} failed (${response.status})`);
  }
  const body = await response.json();
  if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'ok') && Object.prototype.hasOwnProperty.call(body, 'data')) {
    return body.data as T;
  }
  return body as T;
}

function get<T = AnyObject>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'GET' }, signal);
}

function post<T = AnyObject>(path: string, body?: AnyObject, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }, signal);
}

async function getFirst<T = AnyObject>(paths: string[], signal?: AbortSignal, fallback?: T): Promise<T> {
  for (const path of paths) {
    try {
      return await get<T>(path, signal);
    } catch {
      // Continue trying compatible endpoint aliases.
    }
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`No compatible endpoint found: ${paths.join(', ')}`);
}

function normalizeTelemetry(telemetry: AnyObject = {}): AnyObject {
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

async function getTelemetry(signal?: AbortSignal): Promise<AnyObject> {
  const telemetry = await getFirst<AnyObject>(['/telemetry', '/market/price-snapshot'], signal, {} as AnyObject);
  return normalizeTelemetry(telemetry || {});
}

async function getCompositeSnapshot(signal?: AbortSignal): Promise<AnyObject> {
  const [telemetry, orbSnapshot, signalsSnapshot, testbot, risk] = await Promise.all([
    getTelemetry(signal).catch(() => ({})),
    getFirst<AnyObject>(['/orb', '/orb/health'], signal, {} as AnyObject).catch(() => ({})),
    getFirst<AnyObject>(['/signals'], signal, {} as AnyObject).catch(() => ({})),
    getFirst<AnyObject>(['/testbot', '/strategy/parameters'], signal, {} as AnyObject).catch(() => ({})),
    getFirst<AnyObject>(['/risk', '/risk/status'], signal, {} as AnyObject).catch(() => ({})),
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
  getPrice: async (signal?: AbortSignal) => {
    const t = await getTelemetry(signal);
    return {
      price: t.market?.price ?? null,
      bid: t.market?.bid ?? null,
      ask: t.market?.ask ?? null,
      timestamp: t.market?.timestamp,
    };
  },
  getBidAsk: async (signal?: AbortSignal) => {
    const t = await getTelemetry(signal);
    return {
      bid: t.market?.bid ?? null,
      ask: t.market?.ask ?? null,
      spread: t.market?.bid != null && t.market?.ask != null ? t.market.ask - t.market.bid : null,
      timestamp: t.market?.timestamp,
    };
  },
  getTick: async (signal?: AbortSignal) => {
    const t = await getTelemetry(signal);
    return {
      tick: t.feed?.tick_monotonic ?? null,
      timestamp: t.market?.timestamp,
    };
  },
  getFeedStatus: async (signal?: AbortSignal) => {
    const t = await getTelemetry(signal);
    return {
      feeds: true,
      strategy: true,
      risk: true,
      execution: t.connection === 'Connected' || t.connection === 'connected',
      position: t.active_trade != null,
      status: t.status,
      connection: t.connection,
      wsClients: 1,
    };
  },
  getFeedLatency: async (signal?: AbortSignal) => {
    const t = await getTelemetry(signal);
    return {
      latency: t.feed?.latency_ms ?? null,
      wsLatency: t.feed?.latency_ms ?? null,
      apiLatency: t.feed?.latency_ms ?? null,
      stale: t.feed?.stale ?? false,
    };
  },
  getAccounts: async (signal?: AbortSignal) => {
    const accounts = await getFirst<AnyObject[]>(['/accounts'], signal, []);
    return Array.isArray(accounts) ? accounts : [];
  },
  getAccountSettings: (signal?: AbortSignal) => getFirst(['/testbot', '/strategy/parameters'], signal, {}),
  getPositions: async (signal?: AbortSignal) => {
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
  getOpenOrders: (_signal?: AbortSignal) => Promise.resolve([]),
  getOrderStatus: (_id: string | number, _signal?: AbortSignal) => Promise.resolve({}),
  getBars: (_unit = 2, _unitNumber = 1, _limit = 240, _signal?: AbortSignal) => Promise.resolve([]),
  getContract: (signal?: AbortSignal) => getFirst(['/testbot', '/strategy/parameters'], signal, {}),
  getAuthStatus: async (signal?: AbortSignal) => {
    const t = await getTelemetry(signal);
    return { authenticated: t.connection === 'Connected' || t.connection === 'connected' };
  },

  postBuyOrder: (body: BotOrderBody, signal?: AbortSignal) => post('/activity/event', { type: 'buy', ...body }, signal),
  postSellOrder: (body: BotOrderBody, signal?: AbortSignal) => post('/activity/event', { type: 'sell', ...body }, signal),
  postFlattenOrder: (body: AnyObject = {}, signal?: AbortSignal) => post('/strategy/pause', body, signal),

  getSignals: (signal?: AbortSignal) => getFirst(['/signals'], signal, {}),
  getOrbState: (signal?: AbortSignal) => getFirst(['/orb', '/orb/health'], signal, {}),
  getOrbTrades: async (signal?: AbortSignal) => {
    const signals = await getFirst<AnyObject | AnyObject[]>(['/signals', '/topstep/activity/snapshot'], signal, {} as AnyObject);
    return Array.isArray((signals as AnyObject)?.events) ? (signals as AnyObject).events : Array.isArray(signals) ? signals : [];
  },
  getOrbBias: (signal?: AbortSignal) => getFirst(['/orb', '/orb/strategy/parameters'], signal, {}),
  getOrbRange: (signal?: AbortSignal) => getFirst(['/orb', '/orb/strategy/parameters'], signal, {}),
  getOrbBreakout: (signal?: AbortSignal) => getFirst(['/orb', '/orb/strategy/parameters'], signal, {}),
  orbStop: (signal?: AbortSignal) => post('/orb/stop', {}, signal),
  orbFlatten: (signal?: AbortSignal) => post('/orb/flatten', {}, signal),
  getOrbPnl: async (signal?: AbortSignal) => {
    const t = await getTelemetry(signal);
    return {
      realized: t.pnl?.realized ?? null,
      unrealized: t.pnl?.unrealized ?? null,
      total: t.pnl?.realized ?? t.pnl?.unrealized ?? null,
      timestamp: t.market?.timestamp,
    };
  },

  getTestbotSnapshot: (signal?: AbortSignal) => getCompositeSnapshot(signal),
  postTestbotStart: (body: AnyObject = {}, signal?: AbortSignal) => post('/strategy/start', body, signal),
  postTestbotStop: (body: AnyObject = {}, signal?: AbortSignal) => post('/strategy/pause', body, signal),

  getTrailingStatus: async (signal?: AbortSignal) => {
    const testbot = await getFirst<AnyObject>(['/testbot', '/strategy/parameters'], signal, {} as AnyObject);
    return {
      enabled: !!testbot?.trailing?.enabled,
      distance: testbot?.trailing?.offset_points ?? null,
      stopLoss: testbot?.position?.trailing_stop ?? testbot?.position?.sl_price ?? null,
      takeProfit: testbot?.position?.tp_price ?? null,
    };
  },
  getTrailingExtreme: async (signal?: AbortSignal) => {
    const t = await getTelemetry(signal);
    return { price: t.market?.price ?? null };
  },
  getTrailingStop: async (signal?: AbortSignal) => {
    const testbot = await getFirst<AnyObject>(['/testbot', '/strategy/parameters'], signal, {} as AnyObject);
    return {
      stopLoss: testbot?.position?.trailing_stop ?? testbot?.position?.sl_price ?? null,
      takeProfit: testbot?.position?.tp_price ?? null,
      enabled: !!testbot?.trailing?.enabled,
      distance: testbot?.trailing?.offset_points ?? null,
    };
  },
  getTrailingUpdate: (signal?: AbortSignal) => botApi.getTrailingStop(signal),
};

export default botApi;
