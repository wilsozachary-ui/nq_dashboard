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
jest.mock('./DobermanLounge', () => () => <div data-testid="doberman-lounge" />);
jest.mock('./MarketOverviewStrip', () => () => <div data-testid="market-overview" />);
jest.mock('./TopstepAccountSelector', () => () => <div data-testid="account-selector" />);
jest.mock('./PracticeBotStatus', () => () => <div data-testid="practice-status" />);

test('renders Doberman Lounge immediately beneath Activity in the right column', () => {
  cpGet.mockReturnValue(new Promise(() => {}));
  render(<MorningStrategyTab />);
  const activity = screen.getByTestId('activity-panel');
  const lounge = screen.getByTestId('doberman-lounge');

  expect(activity.parentElement).toHaveClass('column-right');
  expect(lounge.parentElement).toBe(activity.parentElement);
  expect(activity.nextElementSibling).toBe(lounge);
});
