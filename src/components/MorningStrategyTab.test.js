import { render, screen } from '@testing-library/react';
import MorningStrategyTab from './MorningStrategyTab';
import { cpGet } from '../services/controlPlaneApi';

jest.mock('../services/controlPlaneApi', () => ({ cpGet: jest.fn() }));
jest.mock('./MorningStrategyLiveControl', () => () => <div data-testid="live-control" />);
jest.mock('./TradeParameterPanel', () => () => <div data-testid="trade-parameters" />);
jest.mock('./AiSuggestedParametersPanel', () => () => <div data-testid="ai-parameters" />);
jest.mock('./MarketContextPanel', () => () => <div data-testid="market-context" />);
jest.mock('./LiveTicker', () => () => <div data-testid="live-ticker" />);
jest.mock('./ActivityPanel', () => () => <div data-testid="activity-panel" />);
jest.mock('./MarketOverviewStrip', () => () => <div data-testid="market-overview" />);
jest.mock('./TopstepAccountSelector', () => () => <div data-testid="account-selector" />);
jest.mock('./PracticeBotStatus', () => () => <div data-testid="practice-status" />);

test('renders ticker and activity in the right column without the paused lounge', () => {
  cpGet.mockReturnValue(new Promise(() => {}));
  render(<MorningStrategyTab />);
  const ticker = screen.getByTestId('live-ticker');
  const activity = screen.getByTestId('activity-panel');

  expect(activity.parentElement).toHaveClass('column-right');
  expect(ticker.parentElement).toBe(activity.parentElement);
  expect(ticker.nextElementSibling).toBe(activity);
  expect(activity.nextElementSibling).toBeNull();
  expect(screen.queryByTestId('doberman-lounge')).not.toBeInTheDocument();
});
