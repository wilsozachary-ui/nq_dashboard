import { BOT_WS_URL } from './botApi';
import { getSessionToken } from './sessionToken';

export const BOT_WS_ROUTES = {
  price: `${BOT_WS_URL}/ws`,
  activity: `${BOT_WS_URL}/ws`,
  pnl: `${BOT_WS_URL}/ws`,
  risk: `${BOT_WS_URL}/ws`,
  strategy: `${BOT_WS_URL}/ws`,
  orb_price: `${BOT_WS_URL}/ws`,
  orb_activity: `${BOT_WS_URL}/ws`,
  strategy_event: `${BOT_WS_URL}/ws`,
  pnl_monthly: `${BOT_WS_URL}/ws`,
};

const STREAM_TOPICS = {
  price: ['telemetry', 'gateway_quote', 'connection', 'status'],
  activity: ['gateway_trade', 'trade_log', 'log', 'connection', 'status', 'activity', 'strategy_event'],
  pnl: ['telemetry', 'gateway_trade', 'connection', 'status'],
  risk: ['status', 'connection', 'telemetry'],
  strategy: ['orb_snapshot', 'signals_snapshot', 'status', 'connection'],
  orb_price: ['orb_snapshot', 'telemetry', 'connection'],
  orb_activity: ['orb_log', 'gateway_trade', 'connection'],
  strategy_event: ['strategy_event', 'connection', 'status'],
  pnl_monthly: ['pnl_monthly', 'connection', 'status'],
};

function translateEventEnvelope(message) {
  const topic = String(message.topic || '').toLowerCase();
  const payload = (message.payload && typeof message.payload === 'object') ? message.payload : message;

  if (topic === 'telemetry') {
    const market = payload.market || {};
    return {
      type: 'price',
      price: market.price,
      bid: market.bid,
      ask: market.ask,
      spread: market.bid != null && market.ask != null ? market.ask - market.bid : null,
      timestamp: market.timestamp || message.ts,
      telemetry: payload,
    };
  }
  if (topic === 'gateway_quote') {
    return {
      type: 'price',
      price: payload.price,
      bid: payload.bid,
      ask: payload.ask,
      spread: payload.bid != null && payload.ask != null ? payload.ask - payload.bid : null,
      timestamp: payload.timestamp || message.ts,
      source: 'gateway_quote',
    };
  }
  if (topic === 'gateway_trade') {
    return { type: 'activity', activity: payload, timestamp: payload.timestamp || message.ts };
  }
  if (topic === 'orb_snapshot') {
    return {
      type: 'orb_state',
      state: payload.state,
      status: payload.state,
      high: payload.range_high,
      low: payload.range_low,
      rangeHigh: payload.range_high,
      rangeLow: payload.range_low,
      orb: payload,
      timestamp: message.ts,
    };
  }
  if (topic === 'signals_snapshot') {
    return { type: 'strategy', strategy: payload, signals_snapshot: payload, timestamp: message.ts };
  }
  if (topic === 'status') {
    return { type: 'strategy', strategy: payload, status: payload.status, timestamp: message.ts };
  }
  if (topic === 'connection') {
    return { type: 'risk', risk: payload, connection: payload.connection, timestamp: message.ts };
  }
  if (topic === 'log' || topic === 'trade_log' || topic === 'orb_log') {
    return { type: 'activity', activity: payload, log: payload, timestamp: message.ts };
  }
  if (topic === 'strategy_event') {
    return {
      type: payload.type,
      price: payload.price,
      pnl: payload.pnl,
      timestamp: payload.timestamp || message.ts,
      meta: payload.meta || {},
    };
  }
  if (topic === 'activity') {
    // Normalize to always carry an `events` array, whether this is a single
    // live tick (_handle_activity broadcasts one event at a time) or the
    // bootstrap replay (ws_manager sends { events: [...] } on connect).
    // Tagged 'adapter_activity', not 'activity' -- that type string is
    // already used by the gateway_trade/log translations below and
    // TimeAndSalesPanel.js depends on that existing meaning.
    const events = Array.isArray(payload.events) ? payload.events : [payload];
    return { type: 'adapter_activity', events, timestamp: message.ts };
  }
  if (topic === 'pnl_monthly') {
    return {
      type: 'pnl_monthly',
      date: payload.date,
      realized: payload.realized,
      unrealized: payload.unrealized,
      net: payload.net,
      trades: payload.trades,
      strategy: payload.strategy,
      timestamp: message.ts,
    };
  }

  return payload;
}

const DEFAULT_OPTIONS = {
  url: BOT_WS_ROUTES.price,
  stream: 'price',
  reconnect: true,
  reconnectBaseDelayMs: 1000,
  reconnectMaxDelayMs: 30000,
  maxReconnectAttempts: Number.POSITIVE_INFINITY,
};

function authenticatedWebSocketUrl(rawUrl) {
  const token = getSessionToken();
  if (!token) return rawUrl;
  const url = new URL(rawUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

export class BotWebSocketClient {
  constructor(options = {}) {
    this.ws = null;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      url: options.url || (options.stream ? BOT_WS_ROUTES[options.stream] : DEFAULT_OPTIONS.url),
    };
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.manuallyStopped = false;
    this.status = 'disconnected';
  }

  connect() {
    this.manuallyStopped = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    // Browser WebSockets cannot attach the Authorization header used by
    // REST calls. The bot validates this query token before accepting the
    // socket; never log the resulting URL because it contains a live token.
    const socketUrl = authenticatedWebSocketUrl(this.options.url);
    console.debug(`[ws:${this.options.stream}] connecting -> ${this.options.url}`);
    try {
      this.ws = new WebSocket(socketUrl);
    } catch (err) {
      console.warn(`[ws:${this.options.stream}] failed to open: ${err.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.debug(`[ws:${this.options.stream}] connected`);
      this.reconnectAttempts = 0;
      this.setStatus('connected');
      const topics = this.options.stream ? STREAM_TOPICS[this.options.stream] : STREAM_TOPICS.price;
      this.send({ type: 'subscribe', topics, request_id: `sub-${Date.now()}` });
      this.send({ type: 'ping', request_id: `ping-${Date.now()}` });
    };

    this.ws.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'subscribed' || payload.type === 'unsubscribed' || payload.type === 'pong') {
          return;
        }
        const translated = payload.type === 'event' ? translateEventEnvelope(payload) : payload;
        this.options.onMessage && this.options.onMessage(translated);
      } catch {
        this.options.onMessage && this.options.onMessage({ type: 'raw', data: event.data });
      }
    };

    this.ws.onerror = event => {
      console.warn(`[ws:${this.options.stream}] error`, event);
      this.options.onError && this.options.onError(event);
    };

    this.ws.onclose = event => {
      console.debug(`[ws:${this.options.stream}] closed (code=${event.code})`);
      this.ws = null;
      if (this.manuallyStopped) {
        this.setStatus('stopped');
        return;
      }
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };
  }

  disconnect() {
    this.manuallyStopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('stopped');
  }

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify(message));
    return true;
  }

  getStatus() {
    return this.status;
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatusChange && this.options.onStatusChange(status);
  }

  scheduleReconnect() {
    if (!this.options.reconnect || this.manuallyStopped) {
      return;
    }
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      return;
    }
    this.reconnectAttempts += 1;
    const delay = Math.min(
      this.options.reconnectBaseDelayMs * 2 ** (this.reconnectAttempts - 1),
      this.options.reconnectMaxDelayMs,
    );
    console.debug(`[ws:${this.options.stream}] reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

export function createBotWebSocketClient(options = {}) {
  return new BotWebSocketClient(options);
}

export default createBotWebSocketClient;
