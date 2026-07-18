import { isFuturesMarketOpenNow } from './marketOpenMode';

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
