import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import AiSuggestedParametersPanel from './AiSuggestedParametersPanel';
import botApi from '../services/botApi';

jest.mock('../CockpitIntegrator', () => ({
  __esModule: true,
  integratedFetch: jest.fn(),
}));
jest.mock('../api/pnlApi', () => ({
  __esModule: true,
  API_ROOT: 'http://test-api',
  USE_MOCK: false,
}));
jest.mock('../services/botApi', () => ({
  __esModule: true,
  default: {
    getLiveBot: jest.fn(),
    getPracticeBot: jest.fn(),
    getMorningStrategyParameters: jest.fn(),
    saveMorningStrategyParameters: jest.fn(),
    armLiveBot: jest.fn(),
    offLiveBot: jest.fn(),
    flattenLiveBot: jest.fn(),
    startPracticeBot: jest.fn(),
    stopPracticeBot: jest.fn(),
    flattenPracticeBot: jest.fn(),
  },
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
  action: 'trade',
  reward_risk_ratio: 2.0,
  both_sides_triggered_rate: 0.2,
  continuation_rate: 0.75,
};

const SKIP_RECOMMENDATION = {
  ...FULL_RECOMMENDATION,
  action: 'skip',
  skip_reason: 'No candidate preserved the required reward-to-risk and positive expectancy.',
  recommended_spread_points: 15,
  recommended_tp_dollars: 900,
  recommended_sl_dollars: 450,
  reward_risk_ratio: 2.0,
  summary: 'No candidate preserved the required reward-to-risk and positive expectancy.',
};

const SAVED_DRAFT = {
  contractSize: 3, takeProfit: 900, stopLoss: 450, trailingStop: true,
  trailingDistance: 7, spreadPoints: 15, breakevenTrigger: 100,
  profitLockTrigger: 150, profitLockRetainPct: 50,
};

function mockFetchResponse(data) {
  integratedFetch.mockResolvedValue({
    json: () => Promise.resolve({ ok: true, ts: '2026-07-18T00:00:00Z', data }),
  });
}

beforeEach(() => {
  integratedFetch.mockReset();
  delete window.nqMorningStrategyParams;
  botApi.getLiveBot.mockReset().mockResolvedValue({ status: 'OFF' });
  botApi.getPracticeBot.mockReset().mockResolvedValue({ status: 'OFF' });
  botApi.getMorningStrategyParameters.mockReset().mockResolvedValue({ draft: SAVED_DRAFT, revision: 4 });
  botApi.saveMorningStrategyParameters.mockReset().mockResolvedValue({ draft: SAVED_DRAFT, revision: 5 });
  botApi.armLiveBot.mockReset();
  botApi.offLiveBot.mockReset();
  botApi.flattenLiveBot.mockReset();
  botApi.startPracticeBot.mockReset();
  botApi.stopPracticeBot.mockReset();
  botApi.flattenPracticeBot.mockReset();
});

afterEach(() => {
  jest.clearAllMocks();
});

function noArmDisarmCallsMade() {
  expect(botApi.armLiveBot).not.toHaveBeenCalled();
  expect(botApi.offLiveBot).not.toHaveBeenCalled();
  expect(botApi.flattenLiveBot).not.toHaveBeenCalled();
  expect(botApi.startPracticeBot).not.toHaveBeenCalled();
  expect(botApi.stopPracticeBot).not.toHaveBeenCalled();
  expect(botApi.flattenPracticeBot).not.toHaveBeenCalled();
}

async function openDetails() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
  });
}

test('shows a compact headline of just the recommended numbers and a one-line summary by default', async () => {
  mockFetchResponse(FULL_RECOMMENDATION);
  render(<AiSuggestedParametersPanel />);

  await screen.findByRole('button', { name: 'View details' });
  expect(screen.getByText('Spread 18 pts · TP $950 · SL $475 · Trail 8 pts · 2 contracts')).toBeInTheDocument();
  expect(screen.getByText('Based on 5 recent day(s) of opening-candle history.')).toBeInTheDocument();

  // The full per-parameter breakdown is not forced on the reader by default.
  expect(screen.queryByText('Take Profit')).not.toBeInTheDocument();
});

test('View details reveals every recommended parameter with a suggested value and a reason', async () => {
  mockFetchResponse(FULL_RECOMMENDATION);
  render(<AiSuggestedParametersPanel />);
  await screen.findByRole('button', { name: 'View details' });
  await openDetails();

  expect(screen.getByText('$950')).toBeInTheDocument();
  expect(screen.getByText(/median favorable move was 15\.83 points/)).toBeInTheDocument();

  for (const label of [
    'Spread', 'Take Profit', 'Stop Loss', 'Trailing Enabled', 'Trailing Distance',
    'Breakeven Trigger', 'Profit Lock Trigger', 'Profit Lock Retain', 'Contract Size',
  ]) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }

  // Hide details toggles it back off.
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }));
  });
  expect(screen.queryByText('Take Profit')).not.toBeInTheDocument();
});

test('labels simulated evidence distinctly from actual-outcome evidence', async () => {
  mockFetchResponse(FULL_RECOMMENDATION);
  render(<AiSuggestedParametersPanel />);
  await screen.findByRole('button', { name: 'View details' });
  await openDetails();

  const simBadges = screen.getAllByText('Simulated');
  const actualBadges = screen.getAllByText('Actual');
  expect(simBadges.length).toBeGreaterThan(0);
  expect(actualBadges.length).toBe(1);
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
  await screen.findByRole('button', { name: 'View details' });
  await openDetails();

  expect(screen.getByText('$900')).toBeInTheDocument(); // current TP
  expect(screen.getByText('$950')).toBeInTheDocument(); // suggested TP
});

test('shows the data quality warning when present', async () => {
  mockFetchResponse({ ...FULL_RECOMMENDATION, data_quality_warning: 'Only 1 comparable day.' });
  render(<AiSuggestedParametersPanel />);
  await screen.findByText(/Only 1 comparable day/);
});

test('shows an error state when the recommendation fetch fails', async () => {
  integratedFetch.mockRejectedValue(new Error('network down'));
  render(<AiSuggestedParametersPanel />);
  await screen.findByText(/AI recommendations unavailable right now/);
});

test('shows a TRADE badge always, and reward-to-risk/both-sides-crossed/continuation stats behind View details', async () => {
  mockFetchResponse(FULL_RECOMMENDATION);
  render(<AiSuggestedParametersPanel />);
  await screen.findByRole('button', { name: 'View details' });

  expect(screen.getByText('TRADE')).toBeInTheDocument();
  expect(screen.queryByText('2.00:1')).not.toBeInTheDocument();

  await openDetails();
  expect(screen.getByText('2.00:1')).toBeInTheDocument();
  expect(screen.getByText('20%')).toBeInTheDocument();
  expect(screen.getByText('75%')).toBeInTheDocument();
});

test('flags a recommendation that violates the reward-to-risk constraint', async () => {
  mockFetchResponse({
    ...FULL_RECOMMENDATION,
    recommended_sl_dollars: 750,
    recommended_tp_dollars: 625,
    reward_risk_ratio: 625 / 750,
  });
  render(<AiSuggestedParametersPanel />);
  await screen.findByRole('button', { name: 'View details' });
  expect(screen.getByText(/violate the configured risk constraints/)).toBeInTheDocument();
});

describe('Apply to Morning Strategy — consent flow', () => {
  test('mount, refresh, and account changes never write parameters', async () => {
    mockFetchResponse(FULL_RECOMMENDATION);
    render(<AiSuggestedParametersPanel />);
    await screen.findByRole('button', { name: 'View details' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Refresh AI recommendation/i }));
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent('nq:accounts-changed', { detail: { selected: ['acc-2'] } }));
    });

    expect(botApi.getMorningStrategyParameters).not.toHaveBeenCalled();
    expect(botApi.saveMorningStrategyParameters).not.toHaveBeenCalled();
  });

  test('clicking Apply opens a confirmation dialog with the diff but does not persist yet', async () => {
    mockFetchResponse(FULL_RECOMMENDATION);
    render(<AiSuggestedParametersPanel />);
    await screen.findByRole('button', { name: 'View details' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply to Morning Strategy' }));
    });

    const dialog = await screen.findByRole('dialog', { name: 'Apply to Morning Strategy' });
    // Reads the current saved draft to build the diff, but never writes.
    expect(botApi.getMorningStrategyParameters).toHaveBeenCalledTimes(1);
    expect(botApi.saveMorningStrategyParameters).not.toHaveBeenCalled();

    expect(within(dialog).getByText('Take Profit')).toBeInTheDocument();
    expect(within(dialog).getByText('$900')).toBeInTheDocument(); // from (saved)
    expect(within(dialog).getByText('$950')).toBeInTheDocument(); // to (recommended)
    expect(within(dialog).getByText('Stop Loss')).toBeInTheDocument();
    expect(within(dialog).getByText('$450')).toBeInTheDocument(); // saved SL, unchanged so far
    expect(within(dialog).getByText('$475')).toBeInTheDocument(); // recommended SL
    expect(within(dialog).getByText(/This updates your saved Morning Strategy parameters/)).toBeInTheDocument();

    // The $450 saved SL is still $450 -- nothing has been persisted by
    // merely opening the dialog.
    expect(botApi.saveMorningStrategyParameters).not.toHaveBeenCalled();
  });

  test('only Confirm Changes persists the complete draft, exactly once, through the parameter endpoint', async () => {
    mockFetchResponse(FULL_RECOMMENDATION);
    const events = [];
    const listener = e => events.push(e.detail);
    window.addEventListener('nq:strategy-params-sync', listener);

    render(<AiSuggestedParametersPanel />);
    await screen.findByRole('button', { name: 'View details' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply to Morning Strategy' }));
    });
    await screen.findByRole('dialog', { name: 'Apply to Morning Strategy' });
    expect(events).toHaveLength(0); // no sync before Confirm

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Changes' }));
    });

    window.removeEventListener('nq:strategy-params-sync', listener);

    expect(botApi.saveMorningStrategyParameters).toHaveBeenCalledTimes(1);
    const [savedDraft, expectedRevision] = botApi.saveMorningStrategyParameters.mock.calls[0];
    expect(expectedRevision).toBe(4); // the revision read when the dialog opened
    expect(savedDraft).toEqual({
      contractSize: 2, takeProfit: 950, stopLoss: 475, trailingStop: true,
      trailingDistance: 8, spreadPoints: 18, breakevenTrigger: 250,
      profitLockTrigger: 550, profitLockRetainPct: 65,
    });

    // The sync/broadcast only happens AFTER the persisted save succeeds.
    expect(events).toHaveLength(1);
    expect(events[0].stopLoss).toBe(475);

    noArmDisarmCallsMade();
    await waitFor(() => expect(screen.getByText('✓ Saved')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('Apply while armed shows the stale-snapshot/re-arm warning and does not auto re-arm', async () => {
    botApi.getLiveBot.mockResolvedValue({ status: 'ARMED' });
    mockFetchResponse(FULL_RECOMMENDATION);
    render(<AiSuggestedParametersPanel />);
    await screen.findByRole('button', { name: 'View details' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply to Morning Strategy' }));
    });

    await waitFor(() => {
      expect(screen.getByText(/currently armed strategy will continue using its existing snapshot/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Disarm and re-arm to use the new settings/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Changes' }));
    });

    // Confirming saves the draft only -- it must never itself arm/disarm.
    expect(botApi.saveMorningStrategyParameters).toHaveBeenCalledTimes(1);
    noArmDisarmCallsMade();
  });

  test('Apply failure leaves saved parameters unchanged and reports the error', async () => {
    botApi.saveMorningStrategyParameters.mockRejectedValue(new Error('Revision conflict'));
    mockFetchResponse(FULL_RECOMMENDATION);
    const events = [];
    const listener = e => events.push(e.detail);
    window.addEventListener('nq:strategy-params-sync', listener);

    render(<AiSuggestedParametersPanel />);
    await screen.findByRole('button', { name: 'View details' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply to Morning Strategy' }));
    });
    await screen.findByRole('dialog', { name: 'Apply to Morning Strategy' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Changes' }));
    });

    window.removeEventListener('nq:strategy-params-sync', listener);

    await screen.findByText('Revision conflict');
    // A failed save must never broadcast as if it had succeeded, and the
    // dialog stays open so the user isn't left thinking it worked.
    expect(events).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Apply to Morning Strategy' })).toBeInTheDocument();
    expect(screen.queryByText('✓ Saved')).not.toBeInTheDocument();
  });

  test('SKIP shows "Skip this setup" and the skip reason as the compact summary, not the numbers', async () => {
    mockFetchResponse(SKIP_RECOMMENDATION);
    render(<AiSuggestedParametersPanel />);
    await screen.findByText('SKIP');

    expect(screen.getByText('Skip this setup')).toBeInTheDocument();
    expect(screen.getByText(SKIP_RECOMMENDATION.skip_reason)).toBeInTheDocument();
  });

  test('SKIP disables Apply -- the dialog can never even be opened', async () => {
    mockFetchResponse(SKIP_RECOMMENDATION);
    render(<AiSuggestedParametersPanel />);
    await screen.findByText('SKIP');

    const applyButton = screen.getByRole('button', { name: 'Apply to Morning Strategy' });
    expect(applyButton).toBeDisabled();
    expect(screen.getByText(/Apply disabled — no trade recommended/)).toBeInTheDocument();

    fireEvent.click(applyButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(botApi.getMorningStrategyParameters).not.toHaveBeenCalled();
    expect(botApi.saveMorningStrategyParameters).not.toHaveBeenCalled();
  });

  test('Cancel closes the dialog without saving', async () => {
    mockFetchResponse(FULL_RECOMMENDATION);
    render(<AiSuggestedParametersPanel />);
    await screen.findByRole('button', { name: 'View details' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply to Morning Strategy' }));
    });
    await screen.findByRole('dialog', { name: 'Apply to Morning Strategy' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(botApi.saveMorningStrategyParameters).not.toHaveBeenCalled();
  });
});
