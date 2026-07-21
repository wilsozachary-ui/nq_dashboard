import { act, render, screen, fireEvent } from '@testing-library/react';
import botApi from '../services/botApi';
import PracticeBotPanel from './PracticeBotPanel';

jest.mock('../services/botApi', () => ({
  __esModule: true,
  default: {
    getPracticeBot: jest.fn(),
    getLiveBot: jest.fn(),
    getAccounts: jest.fn(),
    startPracticeBot: jest.fn(),
    stopPracticeBot: jest.fn(),
  },
}));

const practiceAccount = { account_id: 'practice-1', account_name: 'Practice Account (Sim)' };

beforeEach(() => {
  jest.clearAllMocks();
  window.nqMorningStrategyParams = {
    contractSize: 2, spreadPoints: 15, takeProfit: 900, stopLoss: 450,
    trailingStop: true, trailingDistance: 7, breakevenTrigger: 100,
    profitLockTrigger: 200, profitLockRetainPct: 50,
  };
  window.topstepAccountsSelected = ['practice-1'];
  botApi.getAccounts.mockResolvedValue([practiceAccount]);
});

test('shows a neutral loading state before the first status fetch resolves', async () => {
  let resolveFetch;
  botApi.getPracticeBot.mockImplementation(() => new Promise(resolve => { resolveFetch = resolve; }));

  render(<PracticeBotPanel />);
  expect(screen.getByText(/Checking bot status/i)).toBeInTheDocument();

  await act(async () => { resolveFetch({ status: 'OFF' }); });
});

test('FIRE sends the currently-set Morning Strategy parameters for the practice account only', async () => {
  botApi.getPracticeBot.mockResolvedValue({ status: 'OFF' });
  botApi.startPracticeBot.mockResolvedValue({ ok: true });

  render(<PracticeBotPanel />);
  await act(async () => {});
  await act(async () => {});

  const fireButton = screen.getByRole('button', { name: /fire/i });
  expect(fireButton).not.toBeDisabled();

  await act(async () => { fireEvent.click(fireButton); });

  expect(botApi.startPracticeBot).toHaveBeenCalledTimes(1);
  expect(botApi.startPracticeBot).toHaveBeenCalledWith({
    account_id: 'practice-1',
    contract_size: 2,
    spread_points: 15,
    tp_dollars: 900,
    sl_dollars: 450,
    trailing_points: 7,
    trailing_enabled: true,
    breakeven_dollars: 100,
    profit_lock_dollars: 200,
    profit_lock_retain_pct: 50,
  });
  expect(await screen.findByText(/Fired at/i)).toBeInTheDocument();
});

test('OFF is disabled when not armed/active, and enabled once ARMED', async () => {
  botApi.getPracticeBot.mockResolvedValue({ status: 'ARMED' });

  render(<PracticeBotPanel />);
  await act(async () => {});
  await act(async () => {});

  const offButton = screen.getByRole('button', { name: /off/i });
  expect(offButton).not.toBeDisabled();
  const fireButton = screen.getByRole('button', { name: /fire/i });
  expect(fireButton).toBeDisabled();
});

test('OFF calls stopPracticeBot', async () => {
  botApi.getPracticeBot.mockResolvedValue({ status: 'ACTIVE' });
  botApi.stopPracticeBot.mockResolvedValue({ ok: true });

  render(<PracticeBotPanel />);
  await act(async () => {});
  await act(async () => {});

  const offButton = screen.getByRole('button', { name: /off/i });
  await act(async () => { fireEvent.click(offButton); });

  expect(botApi.stopPracticeBot).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/canceled, position flattened/i)).toBeInTheDocument();
});

test('FIRE is disabled without a resolvable practice account', async () => {
  window.topstepAccountsSelected = [];
  botApi.getAccounts.mockResolvedValue([]);
  botApi.getPracticeBot.mockResolvedValue({ status: 'OFF' });

  render(<PracticeBotPanel />);
  await act(async () => {});
  await act(async () => {});

  expect(screen.getByRole('button', { name: /fire/i })).toBeDisabled();
});
