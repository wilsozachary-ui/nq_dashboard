import { render, screen, waitFor } from '@testing-library/react';
import AiInsightsTab from './AiInsightsTab';
import botApi from '../services/botApi';

jest.mock('./TopstepAccountSelector', () => () => <div data-testid="account-selector" />);
jest.mock('../services/botApi', () => ({
  __esModule: true,
  default: {
    getWeekdayInsights: jest.fn(),
    getMorningStrategyAiRecommendations: jest.fn(),
    getMorningStrategyDailySummary: jest.fn(),
  },
}));

const RECOMMENDATION = {
  summary: 'Based on 5 recent day(s) of opening-candle history.',
  data_quality_warning: null,
  confidence: 0.6,
  sample_count: 5,
  comparable_day_count: 4,
  avg_range_10s_points: 6.5,
  avg_range_1m_points: 21.3,
  continuation_rate: 0.75,
  reversal_rate: 0.25,
  high_first_count: 3,
  low_first_count: 2,
};

const TODAY_CANDLE = {
  range_points: 6.25, signed_move_points: 6.25, extreme_first: 'high', direction_changes_first_10s: 1,
  feed_quality: { recording_complete: true },
  one_minute: {
    range_points: 17.25, body_points: 7.75, upper_wick_points: 3.0, lower_wick_points: 6.5,
    close_location_pct: 0.12, tick_count: 340,
  },
};

beforeEach(() => {
  botApi.getWeekdayInsights.mockResolvedValue({ weekdays: [] });
  botApi.getMorningStrategyAiRecommendations.mockResolvedValue(RECOMMENDATION);
  botApi.getMorningStrategyDailySummary.mockResolvedValue({
    date: '2026-07-18', candle: TODAY_CANDLE, trade: null, realized_pnl: null,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows the evidence overview: continuation/reversal rate, sample size, confidence', async () => {
  render(<AiInsightsTab />);
  await screen.findByText('Recommendation Evidence Overview');

  expect(screen.getByText('60%')).toBeInTheDocument(); // confidence
  expect(screen.getByText('5 days')).toBeInTheDocument(); // sample_count
  expect(screen.getByText('4 days')).toBeInTheDocument(); // comparable_day_count
  expect(screen.getByText('75%')).toBeInTheDocument(); // continuation_rate
  expect(screen.getByText('25%')).toBeInTheDocument(); // reversal_rate
});

test('shows todays completed candle once available, including one-minute body/wicks', async () => {
  render(<AiInsightsTab />);
  await screen.findByText('Completed 08:30 Candle (One Minute)');

  expect(screen.getByText('17.25 pts')).toBeInTheDocument(); // one-minute range
  expect(screen.getByText('7.75 pts')).toBeInTheDocument(); // body
  expect(screen.getByText('First 10 Seconds (Decision Window)')).toBeInTheDocument();
});

test('shows a plain not-yet-recorded message when today has no candle', async () => {
  botApi.getMorningStrategyDailySummary.mockRejectedValue(new Error('404'));
  render(<AiInsightsTab />);
  await screen.findByText(/Not recorded yet/);
});

test('shows a low-data warning when the recommender flags one', async () => {
  botApi.getMorningStrategyAiRecommendations.mockResolvedValue({
    ...RECOMMENDATION, data_quality_warning: 'Only 1 comparable day.',
  });
  render(<AiInsightsTab />);
  await screen.findByText(/Only 1 comparable day/);
});

test('shows an incomplete-recording warning on todays candle when flagged', async () => {
  botApi.getMorningStrategyDailySummary.mockResolvedValue({
    date: '2026-07-18',
    candle: { ...TODAY_CANDLE, feed_quality: { recording_complete: false } },
    trade: null, realized_pnl: null,
  });
  render(<AiInsightsTab />);
  await screen.findByText(/Recording was incomplete/);
});

test('still renders the weekday cards section alongside the new overview', async () => {
  botApi.getWeekdayInsights.mockResolvedValue({
    weekdays: [{ weekday: 'Monday', sample_days: 3, confidence: 0.5, note: 'test note' }],
  });
  render(<AiInsightsTab />);
  await waitFor(() => expect(screen.getByText('Monday')).toBeInTheDocument());
});
