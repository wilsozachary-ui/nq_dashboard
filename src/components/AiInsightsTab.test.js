import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AiInsightsTab from './AiInsightsTab';
import botApi from '../services/botApi';

jest.mock('./TopstepAccountSelector', () => () => <div data-testid="account-selector" />);
jest.mock('../services/botApi', () => ({
  __esModule: true,
  default: {
    getWeekdayInsights: jest.fn(),
    getMorningStrategyAiRecommendations: jest.fn(),
    getMorningStrategyDailySummary: jest.fn(),
    getLiveBot: jest.fn(),
    getPracticeBot: jest.fn(),
    getMorningStrategyParameters: jest.fn(),
    saveMorningStrategyParameters: jest.fn(),
    armLiveBot: jest.fn(),
    offLiveBot: jest.fn(),
  },
}));

const SAVED_DRAFT = {
  contractSize: 3, takeProfit: 900, stopLoss: 450, trailingStop: true,
  trailingDistance: 7, spreadPoints: 15, breakevenTrigger: 100,
  profitLockTrigger: 150, profitLockRetainPct: 50,
};

const RECOMMENDATION = {
  model_version: 'heuristic-v1',
  evidence_methodology: 'Everything below is a simulated replay of recorded tick data.',
  summary: 'Based on 5 recent day(s) of opening-candle history.',
  data_quality_warning: null,
  confidence: 0.6,
  sample_count: 5,
  comparable_day_count: 4,
  incomplete_recording_days: 0,
  avg_range_10s_points: 6.5,
  avg_range_1m_points: 21.3,
  continuation_rate: 0.75,
  reversal_rate: 0.25,
  favorable_move_count: 4,
  continuation_count: 3,
  reversal_count: 1,
  high_first_count: 3,
  low_first_count: 2,
  recommended_spread_points: 15,
  recommended_tp_dollars: 900,
  recommended_sl_dollars: 450,
  recommended_trailing_points: 7,
  recommended_trailing_enabled: true,
  recommended_contract_size: 1,
  recommended_breakeven_dollars: 250,
  recommended_profit_lock_dollars: 550,
  recommended_profit_lock_retain_pct: 65,
  action: 'trade',
  reward_risk_ratio: 2.0,
  both_sides_triggered_rate: 0.2,
  parameter_reasons: {
    spread_points: 'Baseline retained; only three comparable days.',
    tp_dollars: 'Recent favorable movement is insufficient to justify widening.',
    sl_dollars: 'Preserves the tested 2:1 reward/risk geometry.',
    trailing_points: 'Recent reversals favor tighter profit protection.',
    trailing_enabled: 'Default on -- protects gains once a trade goes positive.',
    breakeven_dollars: 'Simulated replay evidence for breakeven.',
    profit_lock_dollars: 'Simulated replay evidence for profit lock.',
    profit_lock_retain_pct: 'Simulated replay evidence for profit lock.',
    contract_size: 'Confidence is below the threshold for scaling.',
  },
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
  botApi.getLiveBot.mockResolvedValue({ status: 'OFF' });
  botApi.getPracticeBot.mockResolvedValue({ status: 'OFF' });
  botApi.getMorningStrategyParameters.mockResolvedValue({ draft: SAVED_DRAFT, revision: 4 });
  botApi.saveMorningStrategyParameters.mockResolvedValue({ draft: SAVED_DRAFT, revision: 5 });
  botApi.armLiveBot.mockReset();
  botApi.offLiveBot.mockReset();
});

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('Recommended Setup — the hero card', () => {
  // Anchored on "Medium confidence" (loaded-state only) rather than the
  // card title, which also renders during the brief loading state with
  // identical text -- a query captured mid-race there can end up pointing
  // at a DOM node React has since unmounted and replaced.
  test('leads with the headline setup and confidence badge', async () => {
    render(<AiInsightsTab />);
    const badge = await screen.findByText('Medium confidence');
    const hero = badge.closest('.aic-hero');
    expect(hero.querySelector('.aic-hero-headline').textContent).toBe(
      'Spread 15 pts · TP $900 · SL $450 · Trail 7 pts · 1 contract'
    );
  });

  test('shows the sessions-recorded / usable breakdown, not just raw days', async () => {
    render(<AiInsightsTab />);
    const badge = await screen.findByText('Medium confidence');
    const hero = badge.closest('.aic-hero');
    expect(hero.querySelector('.aic-hero-confidence-line').textContent).toBe(
      'Medium confidence — based on 5 sessions recorded,  4 sessions usable for parameter evidence.'
    );
  });

  test('View reasoning expands a per-parameter explanation, hidden by default', async () => {
    render(<AiInsightsTab />);
    const badge = await screen.findByText('Medium confidence');
    const hero = badge.closest('.aic-hero');
    expect(hero.querySelector('.aic-reasoning')).toBeNull();

    fireEvent.click(within(hero).getByRole('button', { name: 'View reasoning' }));
    expect(hero.querySelector('.aic-reasoning')).not.toBeNull();
    expect(screen.getByText(/Preserves the tested 2:1 reward\/risk geometry/)).toBeInTheDocument();
    const terms = Array.from(hero.querySelectorAll('.aic-reasoning-term')).map(el => el.textContent);
    expect(terms).toContain('Spread 15 pts:');
  });

  test('Apply to Morning Strategy opens a diff dialog; only Confirm Changes persists and dispatches the sync event', async () => {
    render(<AiInsightsTab />);
    await screen.findByText('Medium confidence');

    const events = [];
    const listener = e => events.push(e.detail);
    window.addEventListener('nq:strategy-params-sync', listener);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply to Morning Strategy' }));
    });
    const dialog = await screen.findByRole('dialog', { name: 'Apply to Morning Strategy' });
    // Opening the dialog only reads the current saved draft -- never writes.
    expect(botApi.getMorningStrategyParameters).toHaveBeenCalledTimes(1);
    expect(botApi.saveMorningStrategyParameters).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
    expect(within(dialog).getByText(/This updates your saved Morning Strategy parameters/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Changes' }));
    });
    window.removeEventListener('nq:strategy-params-sync', listener);

    expect(botApi.saveMorningStrategyParameters).toHaveBeenCalledTimes(1);
    expect(botApi.saveMorningStrategyParameters.mock.calls[0][0]).toEqual({
      spreadPoints: 15,
      takeProfit: 900,
      stopLoss: 450,
      trailingDistance: 7,
      trailingStop: true,
      secureBE: false,
      contractSize: 1,
      breakevenTrigger: 250,
      profitLockTrigger: 550,
      profitLockRetainPct: 65,
    });
    expect(events).toHaveLength(1);
    expect(await screen.findByText('✓ Saved')).toBeInTheDocument();
  });

  test('Apply while armed shows the re-arm warning and confirming never arms/disarms', async () => {
    botApi.getLiveBot.mockResolvedValue({ status: 'ARMED' });
    render(<AiInsightsTab />);
    await screen.findByText('Medium confidence');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply to Morning Strategy' }));
    });
    await waitFor(() => {
      expect(screen.getByText(/Disarm and re-arm to use the new settings/)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Changes' }));
    });
    expect(botApi.armLiveBot).not.toHaveBeenCalled();
    expect(botApi.offLiveBot).not.toHaveBeenCalled();
  });

  test('shows a TRADE badge and reward-to-risk/both-sides-crossed/continuation stats', async () => {
    render(<AiInsightsTab />);
    const badge = await screen.findByText('Medium confidence');
    const hero = badge.closest('.aic-hero');
    expect(within(hero).getByText('TRADE')).toBeInTheDocument();
    expect(within(hero).getByText('2.00:1')).toBeInTheDocument();
    expect(within(hero).getByText('20%')).toBeInTheDocument();
    expect(within(hero).getByText('75%')).toBeInTheDocument();
  });

  test('shows a SKIP badge, skip reason, and disables Apply to Morning Strategy', async () => {
    botApi.getMorningStrategyAiRecommendations.mockResolvedValue({
      ...RECOMMENDATION,
      action: 'skip',
      skip_reason: 'No candidate preserved the required reward-to-risk and positive expectancy.',
    });
    render(<AiInsightsTab />);
    await screen.findByText('SKIP');

    expect(screen.getByText('Skip this setup')).toBeInTheDocument();
    expect(screen.getByText(/No candidate preserved the required reward-to-risk/)).toBeInTheDocument();

    const applyButton = screen.getByRole('button', { name: 'Apply to Morning Strategy' });
    expect(applyButton).toBeDisabled();
    fireEvent.click(applyButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(botApi.getMorningStrategyParameters).not.toHaveBeenCalled();
    expect(botApi.saveMorningStrategyParameters).not.toHaveBeenCalled();
  });

  test('flags a recommendation that violates the reward-to-risk constraint', async () => {
    botApi.getMorningStrategyAiRecommendations.mockResolvedValue({
      ...RECOMMENDATION,
      recommended_sl_dollars: 750,
      recommended_tp_dollars: 625,
      reward_risk_ratio: 625 / 750,
    });
    render(<AiInsightsTab />);
    await screen.findByText('Medium confidence');
    expect(screen.getByText(/violate the configured risk constraints/)).toBeInTheDocument();
  });
});

describe("Today's Opening Candle", () => {
  test('shows a compact strip before 8:30 CT instead of an empty full-size card', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T13:00:00Z')); // 08:00 CT
    botApi.getMorningStrategyDailySummary.mockResolvedValue({ date: '2026-07-18', candle: null, trade: null, realized_pnl: null });
    render(<AiInsightsTab />);
    expect(await screen.findByText("Today's candle begins recording at 8:30 AM CT.")).toBeInTheDocument();
    expect(screen.queryByText("Today's Opening Candle")).not.toBeInTheDocument();
  });

  test('shows a different compact message once market hours have started with still no candle', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T15:00:00Z')); // 10:00 CT
    botApi.getMorningStrategyDailySummary.mockResolvedValue({ date: '2026-07-18', candle: null, trade: null, realized_pnl: null });
    render(<AiInsightsTab />);
    expect(await screen.findByText('No candle recorded for today yet.')).toBeInTheDocument();
  });

  test('expands into the full candle story once recorded, including one-minute body/wicks', async () => {
    render(<AiInsightsTab />);
    await screen.findByText('Completed 08:30 Candle (One Minute)');

    expect(screen.getByText('17.25 pts')).toBeInTheDocument(); // one-minute range (headline)
    expect(screen.getByText(/body 7\.75 pts/)).toBeInTheDocument();
    expect(screen.getByText('First 10 Seconds (Decision Window)')).toBeInTheDocument();
  });

  test('shows an incomplete-recording warning when flagged', async () => {
    botApi.getMorningStrategyDailySummary.mockResolvedValue({
      date: '2026-07-18',
      candle: { ...TODAY_CANDLE, feed_quality: { recording_complete: false } },
      trade: null, realized_pnl: null,
    });
    render(<AiInsightsTab />);
    await screen.findByText(/Recording was incomplete/);
  });
});

describe('Historical Evidence', () => {
  test('shows continuation/reversal as counts, not just a bare percentage', async () => {
    render(<AiInsightsTab />);
    await screen.findByText('Historical Evidence');
    expect(screen.getByRole('img', { name: 'Continuation 3 of 4, Reversal 1 of 4' })).toBeInTheDocument();
    expect(screen.getByText(/3 of 4/)).toBeInTheDocument();
  });

  test('treats a small favorable-move sample honestly instead of an alarming 100% bar', async () => {
    botApi.getMorningStrategyAiRecommendations.mockResolvedValue({
      ...RECOMMENDATION, favorable_move_count: 1, continuation_count: 0, reversal_count: 1,
    });
    render(<AiInsightsTab />);
    await screen.findByText('Historical Evidence');
    expect(screen.queryByRole('img', { name: /Continuation/ })).not.toBeInTheDocument();
    expect(screen.getByText(/insufficient evidence to compare continuation vs\. reversal/)).toBeInTheDocument();
  });

  test('shows a low-data warning when the recommender flags one', async () => {
    botApi.getMorningStrategyAiRecommendations.mockResolvedValue({
      ...RECOMMENDATION, data_quality_warning: 'Only 1 comparable day.',
    });
    render(<AiInsightsTab />);
    await screen.findByText(/Only 1 comparable day/);
  });

  test('shows a complete-tick-capture badge when nothing was partial', async () => {
    render(<AiInsightsTab />);
    await screen.findByText('Historical Evidence');
    expect(screen.getByText('Complete tick capture')).toBeInTheDocument();
  });

  test('shows a partial-recording badge when some days were incomplete', async () => {
    botApi.getMorningStrategyAiRecommendations.mockResolvedValue({
      ...RECOMMENDATION, incomplete_recording_days: 2,
    });
    render(<AiInsightsTab />);
    await screen.findByText('Historical Evidence');
    expect(screen.getByText('2 partial recording(s)')).toBeInTheDocument();
  });
});

describe('Weekday breakdown', () => {
  test('still renders the weekday cards section', async () => {
    botApi.getWeekdayInsights.mockResolvedValue({
      weekdays: [{ weekday: 'Monday', sample_days: 5, confidence: 0.5, note: 'test note', insufficient_evidence: false, avg_range_points: 20 }],
    });
    render(<AiInsightsTab />);
    await waitFor(() => expect(screen.getByText('Monday')).toBeInTheDocument());
  });

  test('a sparse weekday shows insufficient-evidence, not a statistically-established pattern', async () => {
    botApi.getWeekdayInsights.mockResolvedValue({
      weekdays: [{ weekday: 'Thursday', sample_days: 1, confidence: 0.3, note: '1 sample recorded -- insufficient evidence for a Thursday pattern yet.', insufficient_evidence: true, avg_range_points: 30 }],
    });
    render(<AiInsightsTab />);
    await screen.findByText('Thursday');
    expect(screen.getByText('— insufficient evidence for a pattern yet')).toBeInTheDocument();
    // Suggested-parameters/context sections don't render for a sparse card.
    expect(screen.queryByText('Suggested Parameters')).not.toBeInTheDocument();
  });

  test('renders the avg-opening-range comparison chart, excluding sparse weekdays', async () => {
    botApi.getWeekdayInsights.mockResolvedValue({
      weekdays: [
        { weekday: 'Monday', sample_days: 3, confidence: 0.5, note: 'n', insufficient_evidence: false, avg_range_points: 18.4 },
        { weekday: 'Tuesday', sample_days: 1, confidence: 0.3, note: 'n', insufficient_evidence: true, avg_range_points: 99 },
      ],
    });
    render(<AiInsightsTab />);
    const heading = await screen.findByText('Avg Opening Range by Weekday');
    const chart = within(heading.closest('.aic-range-chart'));
    expect(chart.getByText('Mon')).toBeInTheDocument();
    expect(chart.queryByText('Tue')).not.toBeInTheDocument();
    expect(chart.getByText('18.40 pts')).toBeInTheDocument();
    expect(screen.getByText(/Tuesday \(1 day\) not shown/)).toBeInTheDocument();
  });

  test('does not render the range chart when every weekday is sparse', async () => {
    botApi.getWeekdayInsights.mockResolvedValue({
      weekdays: [{ weekday: 'Monday', sample_days: 1, confidence: 0.3, note: 'n', insufficient_evidence: true, avg_range_points: 20 }],
    });
    render(<AiInsightsTab />);
    await waitFor(() => expect(screen.getByText('Monday')).toBeInTheDocument());
    expect(screen.queryByText('Avg Opening Range by Weekday')).not.toBeInTheDocument();
  });
});

describe('Methodology drawer', () => {
  test('is collapsed by default and expands on click', async () => {
    render(<AiInsightsTab />);
    await screen.findByText('How this recommendation was calculated');
    expect(screen.queryByText(RECOMMENDATION.evidence_methodology)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /How this recommendation was calculated/ }));
    expect(screen.getByText(RECOMMENDATION.evidence_methodology)).toBeInTheDocument();
    expect(screen.getByText('heuristic-v1')).toBeInTheDocument();
  });
});
