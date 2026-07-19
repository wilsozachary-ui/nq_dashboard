import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import botApi from '../services/botApi';
import { ToastProvider } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import TopstepAccountSelector from './TopstepAccountSelector';

jest.mock('../services/botApi', () => ({
  __esModule: true,
  default: {
    getAccounts: jest.fn(),
    getAccountSelection: jest.fn(),
    saveAccountSelection: jest.fn(),
    getHiddenAccounts: jest.fn(),
    removeAccountFromPicker: jest.fn(),
    restoreAccountToPicker: jest.fn(),
  },
}));

function renderSelector(props) {
  return render(
    <ToastProvider>
      <TopstepAccountSelector {...props} />
      <ToastContainer />
    </ToastProvider>
  );
}

beforeEach(() => {
  botApi.getAccounts.mockResolvedValue([
    { account_id: 11, account_name: 'FUNDED-1', can_trade: true, is_visible: true, simulated: false },
    { account_id: 22, account_name: 'COMBINE-1', can_trade: true, is_visible: true, simulated: true },
    { account_id: 33, account_name: 'LOCKED', can_trade: false, is_visible: true },
  ]);
  botApi.getAccountSelection.mockResolvedValue({ account_ids: [], revision: 0 });
  botApi.saveAccountSelection.mockResolvedValue({ account_ids: ['11', '22'], revision: 1 });
  botApi.getHiddenAccounts.mockResolvedValue({ account_ids: [], revision: 0 });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('All selects every tradeable funded/combine account; locked accounts never render at all', async () => {
  renderSelector();
  fireEvent.click(await screen.findByRole('button', { name: /Topstep Accounts/i }));
  expect(await screen.findByText('Funded')).toBeInTheDocument();
  expect(screen.getByText('Combine')).toBeInTheDocument();
  // A cancelled or MLL-locked account (can_trade: false) is hidden
  // entirely, not shown grayed-out -- the bot can never use it either way.
  expect(screen.queryByText('LOCKED')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  await waitFor(() => {
    expect(botApi.saveAccountSelection).toHaveBeenCalledWith(['11', '22'], 0);
  });
});

test('loads the complete server selection instead of choosing only the first account', async () => {
  botApi.getAccountSelection.mockResolvedValue({ account_ids: ['11', '22'], revision: 7 });
  renderSelector();
  await waitFor(() => expect(window.topstepAccountsSelected).toEqual(['11', '22']));
  // 2/2, not 2/3 -- the locked account from the shared fixture is excluded
  // from the visible/selectable total entirely.
  expect(await screen.findByText('2/2')).toBeInTheDocument();
});

test('a stale polling response cannot overwrite a newer successful save', async () => {
  let resolveStalePoll;
  botApi.getAccountSelection.mockReset();
  botApi.getAccountSelection
    .mockResolvedValueOnce({ account_ids: ['11'], revision: 1 })
    .mockImplementationOnce(() => new Promise(resolve => { resolveStalePoll = resolve; }))
    .mockResolvedValue({ account_ids: ['11', '22'], revision: 2 });
  botApi.saveAccountSelection.mockResolvedValue({ account_ids: ['11', '22'], revision: 2 });

  renderSelector({ pollMs: 5 });
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
});

describe('removing an unselected account (light confirmation)', () => {
  test('requires a second click before calling remove-from-picker', async () => {
    botApi.removeAccountFromPicker.mockResolvedValue({
      outcome: 'removed',
      selection_changed: false,
      selection: { account_ids: [], revision: 0 },
      hidden: { account_ids: ['11'], removed_accounts: {}, revision: 1 },
    });
    renderSelector();
    fireEvent.click(await screen.findByRole('button', { name: /Topstep Accounts/i }));
    await screen.findByText('FUNDED-1');

    const removeBtn = screen.getByRole('button', { name: 'Remove FUNDED-1 from account picker' });
    fireEvent.click(removeBtn);
    expect(botApi.removeAccountFromPicker).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm remove FUNDED-1 from account picker' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove FUNDED-1 from account picker' }));
    await waitFor(() => {
      expect(botApi.removeAccountFromPicker).toHaveBeenCalledWith('11', 0, 0);
    });
  });

  test('shows a success toast with Undo after removal', async () => {
    botApi.removeAccountFromPicker.mockResolvedValue({
      outcome: 'removed',
      selection_changed: false,
      selection: { account_ids: [], revision: 0 },
      hidden: { account_ids: ['11'], removed_accounts: {}, revision: 1 },
    });
    renderSelector();
    fireEvent.click(await screen.findByRole('button', { name: /Topstep Accounts/i }));
    await screen.findByText('FUNDED-1');

    const removeBtn = screen.getByRole('button', { name: 'Remove FUNDED-1 from account picker' });
    fireEvent.click(removeBtn);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove FUNDED-1 from account picker' }));

    await screen.findByText('Account removed from the picker.');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    // The account disappears from the active picker once hidden.
    expect(screen.queryByText('FUNDED-1')).not.toBeInTheDocument();
  });

  test('Undo restores the account using the shared restore helper', async () => {
    botApi.removeAccountFromPicker.mockResolvedValue({
      outcome: 'removed',
      selection_changed: false,
      selection: { account_ids: [], revision: 0 },
      hidden: { account_ids: ['11'], removed_accounts: {}, revision: 1 },
    });
    botApi.restoreAccountToPicker.mockResolvedValue({
      hidden: { account_ids: [], removed_accounts: {}, revision: 2 },
    });
    renderSelector();
    fireEvent.click(await screen.findByRole('button', { name: /Topstep Accounts/i }));
    await screen.findByText('FUNDED-1');
    fireEvent.click(screen.getByRole('button', { name: 'Remove FUNDED-1 from account picker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove FUNDED-1 from account picker' }));
    await screen.findByText('Account removed from the picker.');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(botApi.restoreAccountToPicker).toHaveBeenCalledWith('11', 1);
    });
    await screen.findByText('Account restored to the picker.');
    expect(await screen.findByText('FUNDED-1')).toBeInTheDocument();
  });
});

describe('removing a selected account (strong confirmation)', () => {
  test('requires the modal confirmation, not a second click', async () => {
    botApi.getAccountSelection.mockResolvedValue({ account_ids: ['11'], revision: 3 });
    botApi.removeAccountFromPicker.mockResolvedValue({
      outcome: 'removed',
      selection_changed: true,
      selection: { account_ids: [], revision: 4 },
      hidden: { account_ids: ['11'], removed_accounts: {}, revision: 1 },
    });
    renderSelector();
    fireEvent.click(await screen.findByRole('button', { name: /Topstep Accounts/i }));
    await screen.findByText('FUNDED-1');

    fireEvent.click(screen.getByRole('button', { name: 'Remove FUNDED-1 from account picker' }));
    expect(botApi.removeAccountFromPicker).not.toHaveBeenCalled();
    expect(screen.getByText('Remove FUNDED-1 from the picker?')).toBeInTheDocument();
    expect(screen.getByText(/It will be deselected and cannot be used by Morning Strategy until restored\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(botApi.removeAccountFromPicker).toHaveBeenCalledWith('11', 0, 3);
    });
  });

  test('Cancel dismisses the dialog without removing anything', async () => {
    botApi.getAccountSelection.mockResolvedValue({ account_ids: ['11'], revision: 3 });
    renderSelector();
    fireEvent.click(await screen.findByRole('button', { name: /Topstep Accounts/i }));
    await screen.findByText('FUNDED-1');

    fireEvent.click(screen.getByRole('button', { name: 'Remove FUNDED-1 from account picker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Remove FUNDED-1 from the picker?')).not.toBeInTheDocument();
    expect(botApi.removeAccountFromPicker).not.toHaveBeenCalled();
  });
});

test('a 409 revision conflict during removal refreshes state instead of reporting success', async () => {
  const conflictError = new Error('conflict');
  conflictError.status = 409;
  conflictError.detail = {
    code: 'stale_account_selection_revision',
    account_ids: ['11', '22'],
    revision: 5,
  };
  botApi.removeAccountFromPicker.mockRejectedValue(conflictError);
  botApi.getAccountSelection.mockResolvedValue({ account_ids: ['11'], revision: 3 });

  renderSelector();
  fireEvent.click(await screen.findByRole('button', { name: /Topstep Accounts/i }));
  await screen.findByText('FUNDED-1');
  fireEvent.click(screen.getByRole('button', { name: 'Remove FUNDED-1 from account picker' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

  await screen.findByText(/changed on another device/i);
  // Never claims the account was removed.
  expect(screen.queryByText('Account removed from the picker.')).not.toBeInTheDocument();
});

test('a stale hidden-accounts poll cannot resurrect a just-removed account', async () => {
  let resolveStalePoll;
  botApi.getHiddenAccounts.mockReset();
  botApi.getHiddenAccounts
    .mockResolvedValueOnce({ account_ids: [], revision: 0 })
    .mockImplementationOnce(() => new Promise(resolve => { resolveStalePoll = resolve; }))
    .mockResolvedValue({ account_ids: ['11'], revision: 1 });
  botApi.removeAccountFromPicker.mockResolvedValue({
    outcome: 'removed',
    selection_changed: false,
    selection: { account_ids: [], revision: 0 },
    hidden: { account_ids: ['11'], removed_accounts: {}, revision: 1 },
  });

  renderSelector({ pollMs: 5 });
  fireEvent.click(await screen.findByRole('button', { name: /Topstep Accounts/i }));
  await screen.findByText('FUNDED-1');
  await waitFor(() => expect(botApi.getHiddenAccounts.mock.calls.length).toBeGreaterThanOrEqual(2));

  fireEvent.click(screen.getByRole('button', { name: 'Remove FUNDED-1 from account picker' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm remove FUNDED-1 from account picker' }));
  await waitFor(() => expect(screen.queryByText('FUNDED-1')).not.toBeInTheDocument());

  await act(async () => {
    resolveStalePoll({ account_ids: [], revision: 0 }); // stale -- predates the removal
    await Promise.resolve();
  });
  expect(screen.queryByText('FUNDED-1')).not.toBeInTheDocument();
});
