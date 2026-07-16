import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import {
  aggregateSelectedDailyRealizedPnl,
  DobermanLoungeView,
  getDobermanState,
  isDobermanArmed,
} from './DobermanLounge';

describe('getDobermanState', () => {
  test.each([
    [{ isArmed: false, dailyPnl: 250 }, 'celebrate'],
    [{ isArmed: true, dailyPnl: 250 }, 'celebrate'],
    [{ isArmed: false, dailyPnl: -75 }, 'lose'],
    [{ isArmed: true, dailyPnl: -75 }, 'lose'],
    [{ isArmed: true, dailyPnl: 0 }, 'run'],
    [{ isArmed: false, dailyPnl: 0 }, 'sit'],
    [{ isArmed: true, dailyPnl: null }, 'run'],
  ])('%p returns %s', (input, expected) => {
    expect(getDobermanState(input)).toBe(expected);
  });
});

describe('isDobermanArmed', () => {
  test.each([
    [{ armed: true, status: 'OFF' }, true],
    [{ armed: false, status: 'ARMED' }, true],
    [{ armed: false, status: 'ACTIVE' }, true],
    [{ armed: false, status: 'OFF' }, false],
    [{ armed: true, status: 'ACTIVE', _snapshotMeta: { stale: true } }, false],
  ])('%p returns %s', (snapshot, expected) => {
    expect(isDobermanArmed(snapshot)).toBe(expected);
  });
});

test('aggregates only selected live-account realized Morning Strategy PnL', () => {
  const result = aggregateSelectedDailyRealizedPnl({
    date: '2026-07-16',
    accountIds: [101, '202', '303'],
    accounts: [
      { account_id: '101', account_name: '50KTC-V2-101' },
      { id: 202, name: '150K-FUNDED-202' },
      { accountId: '303', accountName: 'PRAC-V2-303' },
    ],
    rows: [
      { date: '2026-07-16', strategy: 'morning_strategy', account_id: '101', realized: 200, unrealized: 900 },
      { date: '2026-07-16', strategy: 'morning_strategy', account_id: 202, realized: -50, unrealized: -500 },
      { date: '2026-07-16', strategy: 'morning_strategy', account_id: '303', realized: 1000 },
      { date: '2026-07-16', strategy: 'orb', account_id: '101', realized: 500 },
      { date: '2026-07-15', strategy: 'morning_strategy', account_id: '101', realized: 400 },
      { date: '2026-07-16', strategy: 'morning_strategy', account_id: 'not-selected', realized: 700 },
    ],
  });

  expect(result).toBe(150);
});

test.each([
  [{ isArmed: true, dailyPnl: 0 }, 'run', /bot armed, Doberman running/i],
  [{ isArmed: false, dailyPnl: 0 }, 'sit', /bot disarmed, Doberman sitting/i],
  [{ isArmed: false, dailyPnl: 12 }, 'celebrate', /profitable day, Doberman celebrating/i],
  [{ isArmed: true, dailyPnl: -12 }, 'lose', /losing day, Doberman lying down/i],
])('renders an accessible %s state', (props, state, label) => {
  render(<DobermanLoungeView {...props} />);
  const lounge = screen.getByRole('region', { name: label });
  expect(lounge).toHaveAttribute('data-state', state);
  expect(screen.getByText('Doberman Lounge')).toBeInTheDocument();
});

test('does not render full brokerage account identifiers', () => {
  const { container } = render(<DobermanLoungeView isArmed dailyPnl={0} />);
  expect(container.textContent).not.toMatch(/\d{5,}/);
});

test('defines every required animation and a reduced-motion override', () => {
  const css = fs.readFileSync(path.join(__dirname, 'DobermanLounge.css'), 'utf8');
  [
    'dobermanRun',
    'dobermanSit',
    'dobermanCelebrate',
    'dobermanLose',
    'greenGlow',
    'redGlow',
    'pixelSparkle',
  ].forEach(name => expect(css).toContain(`@keyframes ${name}`));
  expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  expect(css).toMatch(/prefers-reduced-motion[\s\S]*animation:\s*none\s*!important/);
});
