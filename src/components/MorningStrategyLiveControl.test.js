import botApi from '../services/botApi';
import { buildSavedArmPayload } from './MorningStrategyLiveControl';

jest.mock('../services/botApi', () => ({
  __esModule: true,
  default: {
    getMorningStrategyParameters: jest.fn(),
  },
}));

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
