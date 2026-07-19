import { act, render, screen, fireEvent } from '@testing-library/react';
import BootLoadingScreen from './BootLoadingScreen';

afterEach(() => {
  jest.useRealTimers();
});

test('shows a connecting message and no escape hatch immediately', () => {
  render(<BootLoadingScreen missing={[]} onContinueAnyway={() => {}} />);
  expect(screen.getByText('Connecting to your bot…')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Continue to dashboard anyway' })).not.toBeInTheDocument();
});

test('shows the missing-dependency detail when provided', () => {
  render(<BootLoadingScreen missing={['adapter unreachable']} onContinueAnyway={() => {}} />);
  expect(screen.getByText('adapter unreachable')).toBeInTheDocument();
});

test('offers a way past the screen after the escape-hatch timeout', () => {
  jest.useFakeTimers();
  const onContinueAnyway = jest.fn();
  render(<BootLoadingScreen missing={[]} onContinueAnyway={onContinueAnyway} />);
  expect(screen.queryByRole('button', { name: 'Continue to dashboard anyway' })).not.toBeInTheDocument();

  act(() => { jest.advanceTimersByTime(20_000); });
  const continueBtn = screen.getByRole('button', { name: 'Continue to dashboard anyway' });
  fireEvent.click(continueBtn);
  expect(onContinueAnyway).toHaveBeenCalledTimes(1);
});
