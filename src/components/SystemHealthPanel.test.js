import { act, render, screen } from '@testing-library/react';
import SystemHealthPanel from './SystemHealthPanel';
import botApi from '../services/botApi';
import { getDashboardConfig } from '../services/controlPlaneApi';

jest.mock('../services/botApi', () => ({
  __esModule: true,
  default: {
    getBackendStatus: jest.fn(),
    getHealth: jest.fn(),
    getRawTelemetry: jest.fn(),
    getRisk: jest.fn(),
  },
}));

jest.mock('../services/controlPlaneApi', () => ({
  __esModule: true,
  getDashboardConfig: jest.fn(),
}));

jest.mock('../services/sessionToken', () => ({
  __esModule: true,
  getSessionToken: () => null,
}));

// react-scripts' Jest config sets resetMocks: true, which wipes any
// implementation set inside a jest.mock() factory before every test -- so
// this has to be (re)configured per test, same as the botApi mocks below.
// Fake timers are also established here (rather than per-test) so React's
// own scheduler picks them up consistently from the very first test.
beforeEach(() => {
  jest.useFakeTimers();
  getDashboardConfig.mockRejectedValue(new Error('not cloud'));
});

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

function mockTelemetry(telemetry) {
  botApi.getBackendStatus.mockResolvedValue({ running: true });
  botApi.getHealth.mockResolvedValue({ ok: true, ws_clients: 1, clock_offset_ms: 100 });
  botApi.getRawTelemetry.mockResolvedValue(telemetry);
  botApi.getRisk.mockResolvedValue({ flatten: {}, fatal_errors: {}, safeguards: {}, bracket_mode: { mode: 'Native' } });
}

async function flushPoll() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

describe('SystemHealthPanel — Market Feed session-state handling', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('a market closure reads as an informational "Market Closed" state, not a warning or failure', async () => {
    jest.setSystemTime(new Date('2026-07-18T15:00:00Z')); // Saturday
    mockTelemetry(CLOSED_TELEMETRY);

    render(<SystemHealthPanel />);
    await flushPoll();

    expect(screen.getByText('Market Closed')).toBeInTheDocument();
    const row = screen.getByText('Feed Freshness').closest('.shp-row');
    expect(row.className).toContain('shp-row--neutral');
    expect(row.className).not.toContain('shp-row--bad');
    expect(row.className).not.toContain('shp-row--warn');
  });

  test('the reopen countdown is shown and ticks down live', async () => {
    jest.setSystemTime(new Date('2026-07-19T21:58:30Z')); // 90s before Sunday reopen
    mockTelemetry(CLOSED_TELEMETRY);

    render(<SystemHealthPanel />);
    await flushPoll();

    const before = screen.getByText(/Reopening in/).textContent;
    await act(async () => {
      jest.advanceTimersByTime(65_000);
      await Promise.resolve();
    });
    const after = screen.getByText(/Reopening in/).textContent;
    expect(after).not.toBe(before);
  });

  test('an open market with a fresh tick reads "Live Price" and a fresh feed', async () => {
    jest.setSystemTime(new Date('2026-07-20T23:00:00Z')); // Monday, well past reopen
    mockTelemetry(OPEN_TELEMETRY_FRESH);

    render(<SystemHealthPanel />);
    await flushPoll();

    expect(screen.getByText('Live Price')).toBeInTheDocument();
    const row = screen.getByText('Feed Freshness').closest('.shp-row');
    expect(row.className).toContain('shp-row--ok');
  });

  test('a closed market labels the price row "Last Price", not "Live Price"', async () => {
    jest.setSystemTime(new Date('2026-07-18T15:00:00Z'));
    mockTelemetry(CLOSED_TELEMETRY);

    render(<SystemHealthPanel />);
    await flushPoll();

    expect(screen.getByText('Last Price')).toBeInTheDocument();
    expect(screen.queryByText('Live Price')).not.toBeInTheDocument();
  });

  test('a genuinely stale feed during an open session is a real red failure, not neutral', async () => {
    // Comfortably past both the daily reopen and the first-tick grace window.
    jest.setSystemTime(new Date('2026-07-20T23:00:00Z'));
    mockTelemetry({
      bot: { connection: 'Connected' },
      feed: { stale: true, last_tick_age_ms: 300_000 },
      market: { price: 25000 },
    });

    render(<SystemHealthPanel />);
    await flushPoll();

    const row = screen.getByText('Feed Freshness').closest('.shp-row');
    expect(row.className).toContain('shp-row--bad');
    expect(row.className).not.toContain('shp-row--neutral');
  });

  test('does not infer freshness from Platform Connection alone', async () => {
    jest.setSystemTime(new Date('2026-07-20T23:00:00Z')); // open market
    mockTelemetry({
      bot: { connection: 'Connected' },
      feed: { stale: true, last_tick_age_ms: 300_000 }, // connected, but no current-session tick
      market: { price: 25000 },
    });

    render(<SystemHealthPanel />);
    await flushPoll();

    const platformRow = screen.getByText('Platform Connection').closest('.shp-row');
    const feedRow = screen.getByText('Feed Freshness').closest('.shp-row');
    expect(platformRow.className).toContain('shp-row--ok'); // connection itself is fine
    expect(feedRow.className).toContain('shp-row--bad'); // but freshness still fails on its own evidence
  });
});
