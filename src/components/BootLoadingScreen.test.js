import { act, render, screen, fireEvent } from '@testing-library/react';
import BootLoadingScreen from './BootLoadingScreen';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test('shows the opening stage message and no escape hatch immediately', () => {
  render(<BootLoadingScreen missing={[]} onContinueAnyway={() => {}} />);
  expect(screen.getByText('Booting your trading engine…')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Continue to dashboard anyway' })).not.toBeInTheDocument();
});

test('omits the greeting entirely when no name is available yet', () => {
  render(<BootLoadingScreen missing={[]} onContinueAnyway={() => {}} />);
  expect(screen.queryByText(/^Hello,/)).not.toBeInTheDocument();
});

test('shows "Hello, <name>" when a first name is provided', () => {
  render(<BootLoadingScreen missing={[]} onContinueAnyway={() => {}} name="Zachary" />);
  expect(screen.getByText('Hello, Zachary')).toBeInTheDocument();
});

test('advances through the staged status messages over time and holds on the last one', () => {
  render(<BootLoadingScreen missing={[]} onContinueAnyway={() => {}} />);

  const stages = [
    'Booting your trading engine…',
    'Linking to the market feed…',
    'Syncing account data…',
    'Arming risk controls…',
    'Almost there…',
  ];

  for (let i = 1; i < stages.length; i += 1) {
    act(() => { jest.advanceTimersByTime(1400); });
    expect(screen.getByText(stages[i])).toBeInTheDocument();
  }

  // Holds on the final stage rather than looping back to the first --
  // a loading screen that visibly restarts after "Almost there…" reads
  // as stuck, not dramatic.
  act(() => { jest.advanceTimersByTime(1400); });
  expect(screen.getByText('Almost there…')).toBeInTheDocument();
});

test('shows the missing-dependency detail when provided', () => {
  render(<BootLoadingScreen missing={['adapter unreachable']} onContinueAnyway={() => {}} />);
  expect(screen.getByText('adapter unreachable')).toBeInTheDocument();
});

test('offers a way past the screen after the escape-hatch timeout', () => {
  const onContinueAnyway = jest.fn();
  render(<BootLoadingScreen missing={[]} onContinueAnyway={onContinueAnyway} />);
  expect(screen.queryByRole('button', { name: 'Continue to dashboard anyway' })).not.toBeInTheDocument();

  act(() => { jest.advanceTimersByTime(20_000); });
  const continueBtn = screen.getByRole('button', { name: 'Continue to dashboard anyway' });
  fireEvent.click(continueBtn);
  expect(onContinueAnyway).toHaveBeenCalledTimes(1);
});
