import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import AiSuggestedParametersPanel from './AiSuggestedParametersPanel';

jest.mock('../CockpitIntegrator', () => ({
  __esModule: true,
  integratedFetch: jest.fn(),
}));
jest.mock('../api/pnlApi', () => ({
  __esModule: true,
  API_ROOT: 'http://test-api',
  USE_MOCK: false,
}));

const { integratedFetch } = require('../CockpitIntegrator');

const FULL_RECOMMENDATION = {
  model_version: 'heuristic-v1',
  recommended_spread_points: 18,
  recommended_tp_dollars: 950,
  recommended_sl_dollars: 475,
  recommended_trailing_points: 8,
  recommended_trailing_enabled: true,
  recommended_contract_size: 2,
  recommended_breakeven_dollars: 250,
  recommended_profit_lock_dollars: 550,
  recommended_profit_lock_retain_pct: 65,
  parameter_reasons: {
    spread_points: 'Simulated replay: both sides triggered on 1/5 recent days.',
    tp_dollars: 'Simulated replay: median favorable move was 15.83 points.',
    sl_dollars: 'Simulated replay: adverse excursion reached up to 6 points.',
    trailing_points: 'Simulated replay: median pullback was 4.2 points.',
    trailing_enabled: 'Default on -- protects gains once a trade goes positive.',
    breakeven_dollars: 'Simulated replay: 1/5 days that went positive later reversed.',
    profit_lock_dollars: 'Simulated replay: median peak-profit giveback was 22%.',
    profit_lock_retain_pct: 'Simulated replay: median peak-profit giveback was 22%.',
    contract_size: 'Based on actual closed trades: no active streak signal.',
  },
  summary: 'Based on 5 recent day(s) of opening-candle history.',
  confidence: 0.55,
  sample_count: 5,
  comparable_day_count: 5,
  data_quality_warning: null,
};

function mockFetchResponse(data) {
  integratedFetch.mockResolvedValue({
    json: () => Promise.resolve({ ok: true, ts: '2026-07-18T00:00:00Z', data }),
  });
}

beforeEach(() => {
  integratedFetch.mockReset();
  delete window.nqMorningStrategyParams;
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders every recommended parameter with a suggested value and a reason', async () => {
  mockFetchResponse(FULL_RECOMMENDATION);
  render(<AiSuggestedParametersPanel />);

  await screen.findByText('Take Profit');
  expect(screen.getByText('$950')).toBeInTheDocument();
  expect(screen.getByText(/median favorable move was 15\.83 points/)).toBeInTheDocument();

  // Every one of the 9 parameters this panel must surface.
  for (const label of [
    'Spread', 'Take Profit', 'Stop Loss', 'Trailing Enabled', 'Trailing Distance',
    'Breakeven Trigger', 'Profit Lock Trigger', 'Profit Lock Retain', 'Contract Size',
  ]) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
});

test('labels simulated evidence distinctly from actual-outcome evidence', async () => {
  mockFetchResponse(FULL_RECOMMENDATION);
  render(<AiSuggestedParametersPanel />);
  await screen.findByText('Take Profit');

  const simBadges = screen.getAllByText('Simulated');
  const actualBadges = screen.getAllByText('Actual');
  expect(simBadges.length).toBeGreaterThan(0);
  expect(actualBadges.length).toBe(1); // only contract_size is actual-outcome based
  // trailing_enabled's reason is neither simulated-replay nor actual-
  // outcome evidence (a static default-on note) -- it must show no badge,
  // not be misclassified into either bucket.
  expect(simBadges.length + actualBadges.length).toBeLessThan(9);
});

test('shows the current value read from window.nqMorningStrategyParams', async () => {
  window.nqMorningStrategyParams = {
    spreadPoints: 15, takeProfit: 900, stopLoss: 450, trailingStop: true,
    trailingDistance: 7, breakevenTrigger: 100, profitLockTrigger: 150,
    profitLockRetainPct: 50, contractSize: 3,
  };
  mockFetchResponse(FULL_RECOMMENDATION);
  render(<AiSuggestedParametersPanel />);
  await screen.findByText('Take Profit');

  expect(screen.getByText('$900')).toBeInTheDocument(); // current TP
  expect(screen.getByText('$950')).toBeInTheDocument(); // suggested TP
});

test('shows the data quality warning when present', async () => {
  mockFetchResponse({ ...FULL_RECOMMENDATION, data_quality_warning: 'Only 1 comparable day.' });
  render(<AiSuggestedParametersPanel />);
  await screen.findByText(/Only 1 comparable day/);
});

test('Apply copies every parameter (including trailing/breakeven/profit-lock) and never calls an arm/save endpoint', async () => {
  mockFetchResponse(FULL_RECOMMENDATION);
  const events = [];
  const listener = e => events.push(e.detail);
  window.addEventListener('nq:strategy-params-sync', listener);

  render(<AiSuggestedParametersPanel />);
  await screen.findByText('Take Profit');

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Apply AI-suggested values/i }));
  });

  window.removeEventListener('nq:strategy-params-sync', listener);

  expect(events).toHaveLength(1);
  expect(events[0]).toEqual({
    spreadPoints: 18,
    takeProfit: 950,
    stopLoss: 475,
    trailingDistance: 8,
    trailingStop: true,
    contractSize: 2,
    breakevenTrigger: 250,
    profitLockTrigger: 550,
    profitLockRetainPct: 65,
  });

  // The only network call this whole component ever makes is the GET for
  // recommendations -- Apply must never itself call fetch/integratedFetch
  // again (no arm, no save, no order placement).
  expect(integratedFetch).toHaveBeenCalledTimes(1);
  expect(integratedFetch.mock.calls[0][0]).toContain('/morning_strategy/ai/recommendations');

  await waitFor(() => {
    expect(screen.getByText('✓ Applied to Trade Parameters')).toBeInTheDocument();
  });
});

test('shows an error state when the recommendation fetch fails', async () => {
  integratedFetch.mockRejectedValue(new Error('network down'));
  render(<AiSuggestedParametersPanel />);
  await screen.findByText(/AI recommendations unavailable right now/);
});
