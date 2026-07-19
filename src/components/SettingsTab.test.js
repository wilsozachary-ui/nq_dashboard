import { act, render, screen, fireEvent } from '@testing-library/react';
import SettingsTab from './SettingsTab';
import { cpGet, cpPost } from '../services/controlPlaneApi';

jest.mock('../services/controlPlaneApi', () => ({
  __esModule: true,
  cpGet: jest.fn(),
  cpPost: jest.fn(),
}));

beforeEach(() => {
  cpGet.mockReset();
  cpPost.mockReset();
  cpGet.mockImplementation(path => {
    if (path === '/me') {
      return Promise.resolve({ email: 'zach@example.com', first_name: 'Zachary', last_name: 'Wilson' });
    }
    if (path === '/credentials') {
      return Promise.resolve({ discord_webhook_url: '', email_alerts_enabled: false, saved: false });
    }
    return Promise.reject(new Error(`unexpected cpGet(${path})`));
  });
  cpPost.mockResolvedValue({ first_name: 'Zachary', last_name: 'Wilson' });
});

test('pre-fills the name fields from GET /me', async () => {
  render(<SettingsTab />);
  expect(await screen.findByDisplayValue('Zachary')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Wilson')).toBeInTheDocument();
});

test('leaves the name fields blank when the account has none on file', async () => {
  cpGet.mockImplementation(path => {
    if (path === '/me') return Promise.resolve({ email: 'zach@example.com', first_name: null, last_name: null });
    if (path === '/credentials') return Promise.resolve({ discord_webhook_url: '', email_alerts_enabled: false, saved: false });
    return Promise.reject(new Error('unexpected'));
  });
  render(<SettingsTab />);
  await screen.findByText('Your name');
  const firstNameInput = screen.getByLabelText('First name');
  expect(firstNameInput.value).toBe('');
});

test('saving the name calls POST /auth/update-profile with the trimmed values', async () => {
  render(<SettingsTab />);
  const firstNameInput = await screen.findByLabelText('First name');
  const lastNameInput = screen.getByLabelText('Last name');

  fireEvent.change(firstNameInput, { target: { value: '  Zach  ' } });
  fireEvent.change(lastNameInput, { target: { value: 'Wilson' } });

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  });

  expect(cpPost).toHaveBeenCalledWith('/auth/update-profile', { first_name: 'Zach', last_name: 'Wilson' });
  expect(await screen.findByText('Saved.')).toBeInTheDocument();
});

test('shows an error and does not claim success when the save fails', async () => {
  cpPost.mockRejectedValue(new Error('Name is required.'));
  render(<SettingsTab />);
  await screen.findByLabelText('First name');

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  });

  expect(await screen.findByText('Name is required.')).toBeInTheDocument();
  expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
});
