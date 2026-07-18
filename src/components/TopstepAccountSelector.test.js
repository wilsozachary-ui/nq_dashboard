import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import botApi from '../services/botApi';
import TopstepAccountSelector from './TopstepAccountSelector';

jest.mock('../services/botApi', () => ({
  __esModule: true,
  default: {
    getAccounts: jest.fn(),
    getAccountSelection: jest.fn(),
    saveAccountSelection: jest.fn(),
    getHiddenAccounts: jest.fn(),
    saveHiddenAccounts: jest.fn(),
  },
}));

beforeEach(() => {
  botApi.getAccounts.mockResolvedValue([
    { account_id: 11, account_name: 'FUNDED-1', can_trade: true, is_visible: true, simulated: false },
    { account_id: 22, account_name: 'COMBINE-1', can_trade: true, is_visible: true, simulated: true },
    { account_id: 33, account_name: 'LOCKED', can_trade: false, is_visible: true },
  ]);
  botApi.getAccountSelection.mockResolvedValue({ account_ids: [], revision: 0 });
  botApi.saveAccountSelection.mockResolvedValue({ account_ids: ['11', '22'], revision: 1 });
  botApi.getHiddenAccounts.mockResolvedValue({ account_ids: [], revision: 0 });
  botApi.saveHiddenAccounts.mockResolvedValue({ account_ids: [], revision: 1 });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('All selects every tradeable funded/combine account; locked accounts never render at all', async () => {
  const { unmount } = render(<TopstepAccountSelector />);
  fireEvent.click(await screen.findByRole('button', { name: /Topstep Accounts/i }));
  expect(await screen.findByText('Funded')).toBeInTheDocument();
  expect(screen.getByText('Combine')).toBeInTheDocument();
  // A cancelled or MLL-locked account (can_trade: false) is hidden
  // entirely, not shown grayed-out -- the bot can never use it either way.
  expect(screen.queryByText('LOCKED')).not.toBeInTheDocument();
  expect(screen.queryByText('Not tradeable')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  await waitFor(() => {
    expect(botApi.saveAccountSelection).toHaveBeenCalledWith(['11', '22'], 0);
  });
  unmount();
});

test('loads the complete server selection instead of choosing only the first account', async () => {
  botApi.getAccountSelection.mockResolvedValue({ account_ids: ['11', '22'], revision: 7 });
  const { unmount } = render(<TopstepAccountSelector />);
  await waitFor(() => expect(window.topstepAccountsSelected).toEqual(['11', '22']));
  // 2/2, not 2/3 -- the locked account from the shared fixture is excluded
  // from the visible/selectable total entirely.
  expect(await screen.findByText('2/2')).toBeInTheDocument();
  unmount();
});

test('a stale polling response cannot overwrite a newer successful save', async () => {
  let resolveStalePoll;
  botApi.getAccountSelection.mockReset();
  botApi.getAccountSelection
    .mockResolvedValueOnce({ account_ids: ['11'], revision: 1 })
    .mockImplementationOnce(() => new Promise(resolve => { resolveStalePoll = resolve; }))
    .mockResolvedValue({ account_ids: ['11', '22'], revision: 2 });
  botApi.saveAccountSelection.mockResolvedValue({ account_ids: ['11', '22'], revision: 2 });

  const { unmount } = render(<TopstepAccountSelector pollMs={5} />);
  await waitFor(() => expect(window.topstepAccountsSelected).toEqual(['11']));
  await waitFor(() => expect(botApi.getAccountSelection.mock.calls.length).toBeGreaterThanOrEqual(2));

  fireEvent.click(screen.getByRole('button', { name: /Topstep Accounts/i }));
  fireEvent.click(await screen.findByRole('button', { name: 'All' }));
  await waitFor(() => expect(window.topstepAccountsSelected).toEqual(['11', '22']));

  await act(async () => {
    resolveStalePoll({ account_ids: ['11'], revision: 1 });
    await Promise.resolve();
  });
  expect(window.topstepAccountsSelected).toEqual(['11', '22']);
  unmount();
});

test('hiding an account removes it from the picker and, if selected, from the selection', async () => {
  botApi.getAccountSelection.mockResolvedValue({ account_ids: ['11'], revision: 3 });
  botApi.saveHiddenAccounts.mockResolvedValue({ account_ids: ['11'], revision: 1 });
  botApi.saveAccountSelection.mockResolvedValue({ account_ids: [], revision: 4 });

  const { unmount } = render(<TopstepAccountSelector />);
  fireEvent.click(await screen.findByRole('button', { name: /Topstep Accounts/i }));
  await screen.findByText('FUNDED-1');

  fireEvent.click(screen.getByRole('button', { name: 'Hide FUNDED-1' }));

  await waitFor(() => {
    expect(botApi.saveHiddenAccounts).toHaveBeenCalledWith(['11'], 0);
  });
  // Hiding a currently-selected account must also drop it from the live
  // selection -- a dismissed account can't stay silently armed.
  expect(botApi.saveAccountSelection).toHaveBeenCalledWith([], 3);
  unmount();
});

test('a hidden account is excluded from the picker and listed in the manage-hidden panel', async () => {
  botApi.getHiddenAccounts.mockResolvedValue({ account_ids: ['33'], revision: 2 });
  // account 33 is otherwise tradeable here (unlike the LOCKED fixture) so
  // this exercises hiding independent of canTrade/isVisible.
  botApi.getAccounts.mockResolvedValue([
    { account_id: 11, account_name: 'FUNDED-1', can_trade: true, is_visible: true, simulated: false },
    { account_id: 33, account_name: 'FAILED-EVAL', can_trade: true, is_visible: true, simulated: true },
  ]);

  const { unmount } = render(<TopstepAccountSelector />);
  fireEvent.click(await screen.findByRole('button', { name: /Topstep Accounts/i }));
  await screen.findByText('FUNDED-1');
  expect(screen.queryByText('FAILED-EVAL')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Hidden (1)' }));
  await screen.findByText('FAILED-EVAL');
  expect(screen.queryByText('FUNDED-1')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Unhide' }));
  await waitFor(() => {
    expect(botApi.saveHiddenAccounts).toHaveBeenCalledWith([], 2);
  });
  unmount();
});
