import { act, render, screen, waitFor } from '@testing-library/react';
import botApi from '../services/botApi';
import MorningStrategyLiveControl, { buildSavedArmPayload } from './MorningStrategyLiveControl';

jest.mock('../services/botApi', () => ({
  __esModule: true,
  default: {
    getMorningStrategyParameters: jest.fn(),
    getLiveBot: jest.fn(),
    getAccounts: jest.fn().mockResolvedValue([]),
  },
}));

beforeEach(() => {
  botApi.getAccounts.mockResolvedValue([]);
});

afterEach(() => {
  jest.clearAllMocks();
});

test('arming builds the complete snapshot from server-saved parameters', async () => {
  botApi.getMorningStrategyParameters.mockResolvedValue({
    revision: 8,
    draft: {
      contractSize: 5,
      spreadPoints: 12,
      takeProfit: 1250,
      stopLoss: 525,
      trailingStop: true,
      trailingDistance: 9,
      breakevenTrigger: 175,
      profitLockTrigger: 250,
      profitLockRetainPct: 65,
    },
  });

  window.nqMorningStrategyParams = { contractSize: 1, takeProfit: 100, stopLoss: 50 };

  await expect(buildSavedArmPayload(['11', '22'], 4)).resolves.toEqual({
    expected_arm_revision: 4,
    account_ids: ['11', '22'],
    contract_size: 5,
    spread_points: 12,
    tp_dollars: 1250,
    sl_dollars: 525,
    trailing_points: 9,
    trailing_enabled: true,
    breakeven_dollars: 175,
    profit_lock_dollars: 250,
    profit_lock_retain_pct: 65,
  });
});

test('arming fails closed when saved parameters cannot be read', async () => {
  botApi.getMorningStrategyParameters.mockResolvedValue(null);
  await expect(buildSavedArmPayload(['11'], 0)).rejects.toThrow('Saved parameters are unavailable');
});

// The snapshot store behind useTestBotSnapshot is a module-level singleton
// (shared across every consumer, by design -- see its own comments). This
// is the only test in the file that renders the component, so it's the
// first thing to ever touch the 'live' store -- order matters here.
test('shows a neutral loading state instead of a default OFF before the first status fetch resolves', async () => {
  let resolveFetch;
  botApi.getLiveBot.mockImplementation(() => new Promise(resolve => { resolveFetch = resolve; }));

  render(<MorningStrategyLiveControl />);

  // Before the first fetch resolves -- exactly the state right after a
  // hard refresh -- this must never render a confident OFF. That's the
  // bug: a customer's real armed state was never touched, but the panel
  // told them otherwise.
  expect(screen.getByText('Checking bot status…')).toBeInTheDocument();
  expect(screen.queryByText('OFF')).not.toBeInTheDocument();
  expect(screen.queryByText('ON')).not.toBeInTheDocument();

  await act(async () => {
    resolveFetch({ status: 'ARMED', armed: true, armed_params: { account_ids: ['11'] } });
    await Promise.resolve();
  });

  await waitFor(() => expect(screen.getByText('ON')).toBeInTheDocument());
  expect(screen.queryByText('Checking bot status…')).not.toBeInTheDocument();
});
