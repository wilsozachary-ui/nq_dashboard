import {
  isFuturesMarketOpenNow,
  getNextFuturesOpenAt,
  computeSessionState,
  formatHoursMinutes,
  SESSION_STATES,
  FIRST_TICK_GRACE_SECONDS,
} from './marketOpenMode';

describe('NQ futures session awareness', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test.each([
    ['Friday before close', '2026-07-17T20:59:00Z', true],
    ['Friday at close', '2026-07-17T21:00:00Z', false],
    ['Saturday', '2026-07-18T15:00:00Z', false],
    ['Sunday before reopen', '2026-07-19T21:59:00Z', false],
    ['Sunday at reopen', '2026-07-19T22:00:00Z', true],
    ['Monday maintenance halt', '2026-07-20T21:30:00Z', false],
    ['Monday after maintenance', '2026-07-20T22:00:00Z', true],
  ])('%s', (_label, instant, expected) => {
    jest.useFakeTimers().setSystemTime(new Date(instant));
    expect(isFuturesMarketOpenNow()).toBe(expected);
  });
});

describe('getNextFuturesOpenAt / reopen countdown', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test.each([
    ['Friday after market close', '2026-07-17T21:05:00Z', '2026-07-19T22:00:00.000Z'],
    ['Saturday', '2026-07-18T15:00:00Z', '2026-07-19T22:00:00.000Z'],
    ['Sunday before reopen', '2026-07-19T21:00:00Z', '2026-07-19T22:00:00.000Z'],
    ['Daily maintenance break', '2026-07-21T21:30:00Z', '2026-07-21T22:00:00.000Z'],
  ])('%s -> next open %s', (_label, instant, expectedIso) => {
    jest.useFakeTimers().setSystemTime(new Date(instant));
    const next = getNextFuturesOpenAt();
    expect(next).not.toBeNull();
    expect(next.toISOString()).toBe(expectedIso);
  });

  test('open market has no next-open instant', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-20T22:00:00Z')); // Monday after maintenance
    expect(getNextFuturesOpenAt()).toBeNull();
  });

  test('Sunday immediately after reopen is open, not closed', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-19T22:00:00Z'));
    expect(isFuturesMarketOpenNow()).toBe(true);
    expect(getNextFuturesOpenAt()).toBeNull();
  });

  test('countdown shrinks as time advances toward the same reopen instant', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T15:00:00Z')); // Saturday
    const first = computeSessionState({ telemetryAvailable: true }).seconds_until_open;
    jest.setSystemTime(new Date('2026-07-18T16:00:00Z')); // one hour later, same Saturday
    const second = computeSessionState({ telemetryAvailable: true }).seconds_until_open;
    expect(second).toBe(first - 3600);
  });

  describe('DST transition weeks', () => {
    test('spring-forward Sunday (2026-03-08) reopens at 17:00 CDT (UTC-5)', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-07T20:00:00Z')); // Saturday, still CST
      const next = getNextFuturesOpenAt();
      expect(next.toISOString()).toBe('2026-03-08T22:00:00.000Z');
      jest.setSystemTime(new Date('2026-03-08T21:59:00Z'));
      expect(isFuturesMarketOpenNow()).toBe(false);
      jest.setSystemTime(new Date('2026-03-08T22:00:00Z'));
      expect(isFuturesMarketOpenNow()).toBe(true);
    });

    test('fall-back Sunday (2026-11-01) reopens at 17:00 CST (UTC-6)', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-31T20:00:00Z')); // Saturday, still CDT
      const next = getNextFuturesOpenAt();
      expect(next.toISOString()).toBe('2026-11-01T23:00:00.000Z');
      jest.setSystemTime(new Date('2026-11-01T22:59:00Z'));
      expect(isFuturesMarketOpenNow()).toBe(false);
      jest.setSystemTime(new Date('2026-11-01T23:00:00Z'));
      expect(isFuturesMarketOpenNow()).toBe(true);
    });
  });
});

describe('computeSessionState', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('closed market never requires freshness and reports the reopen countdown', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T15:00:00Z')); // Saturday
    const state = computeSessionState({ tickAgeMs: 3642_000, feedStale: true, telemetryAvailable: true });
    expect(state.session_state).toBe(SESSION_STATES.CLOSED);
    expect(state.freshness_required).toBe(false);
    expect(state.next_open_at).toBe('2026-07-19T22:00:00.000Z');
    expect(state.seconds_until_open).toBeGreaterThan(0);
    expect(state.feed_age_seconds).toBe(3642);
  });

  test('open market with a fresh tick', () => {
    // Well inside Monday's session, comfortably past the first-tick grace window.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-20T23:00:00Z')); // Monday 18:00 CT
    const state = computeSessionState({ tickAgeMs: 2_000, feedStale: false, telemetryAvailable: true });
    expect(state.session_state).toBe(SESSION_STATES.OPEN_FRESH);
    expect(state.freshness_required).toBe(true);
  });

  test('open market during the first-tick grace window shows an informational awaiting-tick state, not a failure', () => {
    // 30s after Monday's 17:00 CT reopen -- well under FIRST_TICK_GRACE_SECONDS.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-20T22:00:30Z'));
    const state = computeSessionState({ tickAgeMs: null, feedStale: true, telemetryAvailable: true });
    expect(state.session_state).toBe(SESSION_STATES.OPEN_AWAITING_FIRST_TICK);
  });

  test('open market with a genuinely stale feed once the grace window has elapsed', () => {
    const graceElapsed = FIRST_TICK_GRACE_SECONDS + 30;
    jest.useFakeTimers().setSystemTime(new Date(new Date('2026-07-20T22:00:00Z').getTime() + graceElapsed * 1000));
    const state = computeSessionState({ tickAgeMs: (graceElapsed + 10) * 1000, feedStale: true, telemetryAvailable: true });
    expect(state.session_state).toBe(SESSION_STATES.OPEN_STALE);
    expect(state.freshness_required).toBe(true);
  });

  test('a tick that predates the current session reopen does not count as fresh', () => {
    // Just after reopen, but the only tick on record is from before the halt -- must not read as fresh.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-20T22:05:00Z')); // 5 min after 17:00 CT reopen
    const state = computeSessionState({ tickAgeMs: 20 * 60 * 1000, feedStale: false, telemetryAvailable: true });
    expect(state.session_state).not.toBe(SESSION_STATES.OPEN_FRESH);
  });

  test('unknown state when telemetry has not loaded yet', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-20T23:00:00Z'));
    const state = computeSessionState({ telemetryAvailable: false });
    expect(state.session_state).toBe(SESSION_STATES.UNKNOWN);
    expect(state.freshness_required).toBe(false);
  });
});

describe('formatHoursMinutes', () => {
  test('formats hours and zero-padded minutes', () => {
    expect(formatHoursMinutes(34 * 3600 + 6 * 60)).toBe('34h 06m');
  });

  test('formats sub-hour durations', () => {
    expect(formatHoursMinutes(5 * 60)).toBe('0h 05m');
  });

  test('returns null for missing or invalid input', () => {
    expect(formatHoursMinutes(null)).toBeNull();
    expect(formatHoursMinutes(-5)).toBeNull();
    expect(formatHoursMinutes(undefined)).toBeNull();
  });
});
