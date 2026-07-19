import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import botApi from '../services/botApi';
import RemovedAccountsCard from './RemovedAccountsCard';

jest.mock('../services/botApi', () => ({
  __esModule: true,
  default: {
    getRemovedAccounts: jest.fn(),
    restoreAccountToPicker: jest.fn(),
  },
}));

afterEach(() => {
  jest.clearAllMocks();
});

test('shows the empty state when nothing has been removed', async () => {
  botApi.getRemovedAccounts.mockResolvedValue({ removed_accounts: [], revision: 0 });
  render(<RemovedAccountsCard />);
  expect(await screen.findByText('No recently removed accounts.')).toBeInTheDocument();
});

test('displays name, type, masked id, balance, removed timestamp for an available account', async () => {
  botApi.getRemovedAccounts.mockResolvedValue({
    removed_accounts: [{
      account_id: '25113971',
      name: 'Practice Account',
      type: 'Practice',
      removed_at: '2026-07-19T12:34:56Z',
      balance: 50000,
      availability: 'available',
      can_trade: true,
      is_visible: true,
    }],
    revision: 3,
  });
  render(<RemovedAccountsCard />);
  expect(await screen.findByText('Practice Account')).toBeInTheDocument();
  expect(screen.getByText('Practice')).toBeInTheDocument();
  expect(screen.getByText('•••• 3971')).toBeInTheDocument();
  expect(screen.getByText(/Balance: \$50,000/)).toBeInTheDocument();
  expect(screen.getByText(/Removed Jul/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  // No stale-tradeability badge for a normal, currently-available account.
  expect(screen.queryByText('Unavailable at Topstep')).not.toBeInTheDocument();
});

test('a non-tradeable Topstep account is shown as unavailable, offering Dismiss not Restore', async () => {
  botApi.getRemovedAccounts.mockResolvedValue({
    removed_accounts: [{
      account_id: '5',
      name: 'Failed Combine',
      type: 'Combine',
      removed_at: '2026-07-19T12:00:00Z',
      balance: 0,
      availability: 'unavailable_at_topstep',
      can_trade: false,
      is_visible: true,
    }],
    revision: 1,
  });
  render(<RemovedAccountsCard />);
  expect(await screen.findByText('Unavailable at Topstep')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
});

test('an account Topstep no longer returns is labeled and preserved, not erased', async () => {
  botApi.getRemovedAccounts.mockResolvedValue({
    removed_accounts: [{
      account_id: '9',
      name: 'Old Account',
      type: 'Funded',
      removed_at: '2026-07-19T09:00:00Z',
      balance: null,
      availability: 'not_returned_by_topstep',
      can_trade: null,
      is_visible: null,
    }],
    revision: 1,
  });
  render(<RemovedAccountsCard />);
  expect(await screen.findByText('Old Account')).toBeInTheDocument();
  expect(screen.getByText('No longer available from Topstep')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  expect(screen.getByText(/Balance: —/)).toBeInTheDocument();
});

test('restoring an available account removes it from the list and shows success', async () => {
  botApi.getRemovedAccounts.mockResolvedValue({
    removed_accounts: [{
      account_id: '5',
      name: 'Practice 5',
      type: 'Practice',
      removed_at: '2026-07-19T12:00:00Z',
      balance: 1000,
      availability: 'available',
    }],
    revision: 2,
  });
  botApi.restoreAccountToPicker.mockResolvedValue({
    account_ids: [],
    revision: 3,
  });
  render(<RemovedAccountsCard />);
  await screen.findByText('Practice 5');

  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  await waitFor(() => {
    expect(botApi.restoreAccountToPicker).toHaveBeenCalledWith('5', 2);
  });
  await screen.findByText('Practice 5 restored to the picker.');
  expect(screen.queryByText('Practice 5')).not.toBeInTheDocument();
});

test('a 409 conflict during restore retries once with fresh server state', async () => {
  botApi.getRemovedAccounts.mockResolvedValue({
    removed_accounts: [{
      account_id: '5',
      name: 'Practice 5',
      type: 'Practice',
      removed_at: '2026-07-19T12:00:00Z',
      balance: 1000,
      availability: 'available',
    }],
    revision: 2,
  });
  const conflict = new Error('conflict');
  conflict.status = 409;
  conflict.detail = { account_ids: ['5'], revision: 4 };
  botApi.restoreAccountToPicker
    .mockRejectedValueOnce(conflict)
    .mockResolvedValueOnce({ account_ids: [], revision: 5 });

  render(<RemovedAccountsCard />);
  await screen.findByText('Practice 5');
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

  await waitFor(() => expect(botApi.restoreAccountToPicker).toHaveBeenCalledTimes(2));
  expect(botApi.restoreAccountToPicker).toHaveBeenNthCalledWith(1, '5', 2);
  expect(botApi.restoreAccountToPicker).toHaveBeenNthCalledWith(2, '5', 4);
  await screen.findByText('Practice 5 restored to the picker.');
});

test('a stale poll while a restore is in flight does not resurrect the item mid-restore', async () => {
  let resolveSecondPoll;
  botApi.getRemovedAccounts
    .mockResolvedValueOnce({
      removed_accounts: [{ account_id: '5', name: 'Practice 5', type: 'Practice', removed_at: 't', balance: 1, availability: 'available' }],
      revision: 2,
    })
    .mockImplementationOnce(() => new Promise(resolve => { resolveSecondPoll = resolve; }));
  botApi.restoreAccountToPicker.mockResolvedValue({ account_ids: [], revision: 3 });

  render(<RemovedAccountsCard pollMs={5} />);
  await screen.findByText('Practice 5');

  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  await waitFor(() => expect(botApi.restoreAccountToPicker).toHaveBeenCalled());

  // The in-flight second poll (issued before the restore completed) must
  // not repopulate the just-restored account once it resolves.
  await act(async () => {
    resolveSecondPoll({
      removed_accounts: [{ account_id: '5', name: 'Practice 5', type: 'Practice', removed_at: 't', balance: 1, availability: 'available' }],
      revision: 2,
    });
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.queryByText('Practice 5')).not.toBeInTheDocument());
});
