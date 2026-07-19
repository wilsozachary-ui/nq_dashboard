import { act, render, screen } from '@testing-library/react';
import SessionStartChecklist from './SessionStartChecklist';
import botApi from '../services/botApi';

jest.mock('../services/botApi', () => ({
  __esModule: true,
  default: {
    getHealth: jest.fn(),
    getRawTelemetry: jest.fn(),
    getRisk: jest.fn(),
    getLiveBot: jest.fn(),
    getSignals: jest.fn(),
  },
  BOT_WS_URL: 'ws://test-bot',
}));

jest.mock('../services/websocket', () => ({
  __esModule: true,
  authenticatedWebSocketUrl: url => url,
}));

class FakeWebSocket {
  constructor() {
    setTimeout(() => { if (this.onopen) this.onopen(); }, 0);
  }
  close() {}
}

const OPEN_TELEMETRY_FRESH = {
  bot: { connection: 'Connected' },
  feed: { stale: false, last_tick_age_ms: 1500 },
  market: { price: 25000 },
};

const CLOSED_TELEMETRY = {
  bot: { connection: 'Connected' },
  feed: { stale: true, last_tick_age_ms: 3_642_000 },
  market: { price: 25000 },
};

function mockHappyBackend(telemetry) {
  botApi.getHealth.mockResolvedValue({ ok: true, adapter: 'bot', ws_clients: 1 });
  botApi.getRawTelemetry.mockResolvedValue(telemetry);
  botApi.getRisk.mockResolvedValue({ flatten: {}, fatal_errors: {}, safeguards: {} });
  botApi.getLiveBot.mockResolvedValue({ armed: true, next_fire_at: new Date(Date.now() + 3_600_000).toISOString() });
  botApi.getSignals.mockResolvedValue({ vix: 15, volatility_regime: 'normal', overnight_high: 100, overnight_low: 90 });
}

// Advances fake timers and drains the microtask queue between each step, so
// the checklist's staggered `await new Promise(r => setTimeout(r, ...))`
// delays and its mocked-promise-based checks (botApi.*) both resolve
// deterministically without a real multi-second wait.
async function flushChecklist() {
  for (let i = 0; i < 40; i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

describe('SessionStartChecklist — Feed Freshness market-closure handling', () => {
  beforeEach(() => {
    global.WebSocket = FakeWebSocket;
    window.topstepAccountsSelected = ['ACC1'];
    window.nqMorningStrategyParams = { stopLoss: 100, takeProfit: 200 };
    document.body.innerHTML = `
      <div class="mos-strip"></div>
      <div class="ltk-panel"></div>
      <div class="tp-panel"></div>
      <div class="mstb-panel--live"></div>
      <div class="ap-panel"></div>
    `;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    delete window.topstepAccountsSelected;
    delete window.nqMorningStrategyParams;
  });

  test('a market closure shows an informational state, not a red failure', async () => {
    jest.setSystemTime(new Date('2026-07-18T15:00:00Z')); // Saturday -- market closed
    mockHappyBackend(CLOSED_TELEMETRY);

    render(<SessionStartChecklist />);
    await flushChecklist();

    expect(screen.getByText(/Market Closed/)).toBeInTheDocument();
    const row = screen.getByText('Feed Freshness').closest('.ssc-check');
    expect(row.className).toContain('ssc-check--neutral');
    expect(row.className).not.toContain('ssc-check--fail');
    expect(row.className).not.toContain('ssc-check--warn');
  });

  test('closed state is excluded from the failure/warning totals', async () => {
    jest.setSystemTime(new Date('2026-07-18T15:00:00Z'));
    mockHappyBackend(CLOSED_TELEMETRY);

    render(<SessionStartChecklist />);
    await flushChecklist();

    const failChip = document.querySelector('.ssc-sc--fail b');
    const warnChip = document.querySelector('.ssc-sc--warn b');
    expect(failChip.textContent).toBe('0');
    expect(warnChip.textContent).toBe('0');
  });

  test('closed state is excluded from Recommended Actions', async () => {
    jest.setSystemTime(new Date('2026-07-18T15:00:00Z'));
    mockHappyBackend(CLOSED_TELEMETRY);

    render(<SessionStartChecklist />);
    await flushChecklist();

    expect(screen.queryByText('Recommended Actions')).not.toBeInTheDocument();
  });

  test('pre-flight remains READY when market closure is the only thing that would otherwise have failed', async () => {
    jest.setSystemTime(new Date('2026-07-18T15:00:00Z'));
    mockHappyBackend(CLOSED_TELEMETRY);

    render(<SessionStartChecklist />);
    await flushChecklist();

    expect(screen.getByText('MORNING STRATEGY READY FOR SESSION')).toBeInTheDocument();
  });

  test('open market with a fresh tick reports pass, not the closed/neutral state', async () => {
    jest.setSystemTime(new Date('2026-07-20T23:00:00Z')); // Monday, well past reopen
    mockHappyBackend(OPEN_TELEMETRY_FRESH);

    render(<SessionStartChecklist />);
    await flushChecklist();

    const row = screen.getByText('Feed Freshness').closest('.ssc-check');
    expect(row.className).toContain('ssc-check--pass');
    expect(screen.getByText('MORNING STRATEGY READY FOR SESSION')).toBeInTheDocument();
  });

  test('the reopen countdown ticks down on its own without a re-run', async () => {
    // 90 seconds before Sunday's 17:00 CT reopen -- close enough that the
    // minute figure changes within a short, deterministic fake-timer advance.
    jest.setSystemTime(new Date('2026-07-19T21:58:30Z'));
    mockHappyBackend(CLOSED_TELEMETRY);

    render(<SessionStartChecklist />);
    await flushChecklist();

    const detailBefore = screen.getByText(/Reopening in/).textContent;

    await act(async () => {
      jest.advanceTimersByTime(65_000); // cross the one-minute boundary
      await Promise.resolve();
    });

    const detailAfter = screen.getByText(/Reopening in/).textContent;
    expect(detailAfter).not.toBe(detailBefore);
  });
});
