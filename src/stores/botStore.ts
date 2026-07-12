import botApi, { AnyObject } from '../services/botApi';
import { BotWebSocketClient, BotWsMessage, BotWsStatus } from '../services/websocket';

export type BotStoreState = {
  wsStatus: BotWsStatus;
  connected: boolean;
  loading: boolean;
  error: string | null;
  lastMessageAt: string | null;
  price: AnyObject | null;
  bidAsk: AnyObject | null;
  tick: AnyObject | null;
  feedStatus: AnyObject | null;
  feedLatency: AnyObject | null;
  accounts: AnyObject[];
  accountSettings: AnyObject | null;
  positions: AnyObject[];
  openOrders: AnyObject[];
  contract: AnyObject | null;
  authStatus: AnyObject | null;
  orbState: AnyObject | null;
  orbTrades: AnyObject[];
  orbBias: AnyObject | null;
  orbRange: AnyObject | null;
  orbBreakout: AnyObject | null;
  orbPnl: AnyObject | null;
  testbotSnapshot: AnyObject | null;
  trailingStatus: AnyObject | null;
  trailingExtreme: AnyObject | null;
  trailingStop: AnyObject | null;
  trailingUpdate: AnyObject | null;
  rawMessages: BotWsMessage[];
};

export type BotStoreListener = (state: BotStoreState) => void;

const INITIAL_STATE: BotStoreState = {
  wsStatus: 'disconnected',
  connected: false,
  loading: false,
  error: null,
  lastMessageAt: null,
  price: null,
  bidAsk: null,
  tick: null,
  feedStatus: null,
  feedLatency: null,
  accounts: [],
  accountSettings: null,
  positions: [],
  openOrders: [],
  contract: null,
  authStatus: null,
  orbState: null,
  orbTrades: [],
  orbBias: null,
  orbRange: null,
  orbBreakout: null,
  orbPnl: null,
  testbotSnapshot: null,
  trailingStatus: null,
  trailingExtreme: null,
  trailingStop: null,
  trailingUpdate: null,
  rawMessages: [],
};

class BotStore {
  private state: BotStoreState = { ...INITIAL_STATE };
  private listeners = new Set<BotStoreListener>();
  private wsClients = new Map<string, BotWebSocketClient>();

  getState(): BotStoreState {
    return this.state;
  }

  subscribe(listener: BotStoreListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setState(patch: Partial<BotStoreState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  async refresh(): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      const [
        price,
        bidAsk,
        tick,
        feedStatus,
        feedLatency,
        accounts,
        accountSettings,
        positions,
        openOrders,
        contract,
        authStatus,
        orbState,
        orbTrades,
        orbBias,
        orbRange,
        orbBreakout,
        orbPnl,
        testbotSnapshot,
        trailingStatus,
        trailingExtreme,
        trailingStop,
        trailingUpdate,
      ] = await Promise.all([
        botApi.getPrice().catch(() => null),
        botApi.getBidAsk().catch(() => null),
        botApi.getTick().catch(() => null),
        botApi.getFeedStatus().catch(() => null),
        botApi.getFeedLatency().catch(() => null),
        botApi.getAccounts().catch(() => []),
        botApi.getAccountSettings().catch(() => null),
        botApi.getPositions().catch(() => []),
        botApi.getOpenOrders().catch(() => []),
        botApi.getContract().catch(() => null),
        botApi.getAuthStatus().catch(() => null),
        botApi.getOrbState().catch(() => null),
        botApi.getOrbTrades().catch(() => []),
        botApi.getOrbBias().catch(() => null),
        botApi.getOrbRange().catch(() => null),
        botApi.getOrbBreakout().catch(() => null),
        botApi.getOrbPnl().catch(() => null),
        botApi.getTestbotSnapshot().catch(() => null),
        botApi.getTrailingStatus().catch(() => null),
        botApi.getTrailingExtreme().catch(() => null),
        botApi.getTrailingStop().catch(() => null),
        botApi.getTrailingUpdate().catch(() => null),
      ]);

      this.setState({
        price,
        bidAsk,
        tick,
        feedStatus,
        feedLatency,
        accounts: Array.isArray(accounts) ? accounts : [],
        accountSettings,
        positions: Array.isArray(positions) ? positions : [],
        openOrders: Array.isArray(openOrders) ? openOrders : [],
        contract,
        authStatus,
        orbState,
        orbTrades: Array.isArray(orbTrades) ? orbTrades : [],
        orbBias,
        orbRange,
        orbBreakout,
        orbPnl,
        testbotSnapshot,
        trailingStatus,
        trailingExtreme,
        trailingStop,
        trailingUpdate,
        loading: false,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh bot store';
      this.setState({ loading: false, error: message });
    }
  }

  initialize(): void {
    if (this.wsClients.size > 0) return;

    const streams = ['price', 'activity', 'pnl', 'risk', 'strategy', 'orb_price', 'orb_activity'] as const;
    streams.forEach(stream => {
      const client = new BotWebSocketClient({
        stream,
        onStatusChange: status => {
          const connected = Array.from(this.wsClients.values()).some(c => c.getStatus() === 'connected');
          this.setState({ wsStatus: status, connected });
        },
        onMessage: message => {
          this.applyMessage(message);
        },
        onError: () => {
          this.setState({ error: 'WebSocket error' });
        },
      });
      this.wsClients.set(stream, client);
      client.connect();
    });

    this.refresh().catch(() => {});
  }

  destroy(): void {
    this.wsClients.forEach(client => client.disconnect());
    this.wsClients.clear();
    this.setState({ wsStatus: 'stopped', connected: false });
  }

  send(message: BotWsMessage): boolean {
    const strategyClient = this.wsClients.get('strategy');
    if (strategyClient?.getStatus() === 'connected') {
      return strategyClient.send(message);
    }
    const firstConnected = Array.from(this.wsClients.values()).find(c => c.getStatus() === 'connected');
    return firstConnected?.send(message) ?? false;
  }

  reset(): void {
    this.state = { ...INITIAL_STATE };
    this.emit();
  }

  private applyMessage(message: BotWsMessage): void {
    const type = String(message.type || message.event || message.topic || '').toLowerCase();
    const nextRawMessages = [...this.state.rawMessages, message].slice(-200);
    const patch: Partial<BotStoreState> = {
      rawMessages: nextRawMessages,
      lastMessageAt: new Date().toISOString(),
      error: null,
    };

    if (message.price != null || type.includes('price')) {
      patch.price = {
        price: message.price,
        bid: message.bid,
        ask: message.ask,
        spread: message.spread,
        timestamp: message.timestamp,
      };
    }
    if (message.bid != null || message.ask != null || type.includes('bid_ask') || type === 'bidask') {
      patch.bidAsk = {
        bid: message.bid,
        ask: message.ask,
        spread: message.spread,
        timestamp: message.timestamp,
      };
    }
    if (message.tick != null || type.includes('tick')) patch.tick = message;
    if (type.includes('feed_status') || type === 'feedstatus') patch.feedStatus = message;
    if (type.includes('feed_latency') || type === 'feedlatency') patch.feedLatency = message;
    if (message.orb && typeof message.orb === 'object') {
      patch.orbState = message.orb;
    }
    if (type.includes('orb_state') || type === 'orbstate') patch.orbState = message;
    if (type.includes('orb_trade') || type === 'orbtrades') {
      patch.orbTrades = [...this.state.orbTrades, message].slice(-200);
    }
    if (type.includes('orb_bias') || type === 'orbbias') patch.orbBias = message;
    if (type.includes('orb_range') || type === 'orbrange') patch.orbRange = message;
    if (type.includes('orb_breakout') || type === 'orbbreakout') patch.orbBreakout = message;
    if (message.pnl != null || type.includes('pnl')) patch.orbPnl = message.pnl != null ? { pnl: message.pnl, ...message } : message;
    if (type.includes('testbot')) patch.testbotSnapshot = message;
    if (type.includes('trailing_status') || type === 'trailingstatus') patch.trailingStatus = message;
    if (type.includes('trailing_extreme') || type === 'trailingextreme') patch.trailingExtreme = message;
    if (type.includes('trailing_stop') || type === 'trailingstop') patch.trailingStop = message;
    if (type.includes('trailing_update') || type === 'trailingupdate') patch.trailingUpdate = message;
    if (message.activity != null || type.includes('activity')) {
      patch.orbTrades = [...this.state.orbTrades, message.activity != null ? message.activity : message].slice(-200);
    }
    if (message.strategy != null || type.includes('strategy')) {
      patch.contract = message.strategy != null ? message.strategy : message;
    }
    if (message.risk != null || type.includes('risk')) {
      patch.trailingStatus = message.risk != null ? message.risk : message;
    }

    this.setState(patch);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export const botStore = new BotStore();
export default botStore;
