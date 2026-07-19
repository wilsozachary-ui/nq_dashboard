import { act, render, screen } from '@testing-library/react';
import botApi from '../services/botApi';
import PracticeBotStatus from './PracticeBotStatus';

jest.mock('../services/botApi', () => ({
  __esModule: true,
  default: { getBotHealthSnapshot: jest.fn() },
}));

const healthy = apiLatency => ({
  apiLatency,
  strategy: true,
  risk: true,
  execution: true,
  position: true,
});

describe('PracticeBotStatus', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    botApi.getBotHealthSnapshot.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses one telemetry-backed health request per polling cycle', async () => {
    botApi.getBotHealthSnapshot.mockResolvedValue(healthy(120));
    render(<PracticeBotStatus />);

    await act(async () => {});
    expect(botApi.getBotHealthSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByText('120ms')).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(botApi.getBotHealthSnapshot).toHaveBeenCalledTimes(2);
  });

  it('shows the rolling median and only warns above 750ms', async () => {
    botApi.getBotHealthSnapshot
      .mockResolvedValueOnce(healthy(100))
      .mockResolvedValueOnce(healthy(900))
      .mockResolvedValueOnce(healthy(200));
    render(<PracticeBotStatus />);

    await act(async () => {});
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(screen.getByText('500ms')).not.toHaveClass('pbs-metric-val--warn');

    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(screen.getByText('200ms')).not.toHaveClass('pbs-metric-val--warn');
  });
});
