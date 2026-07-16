import { resolveSinglePracticeAccount } from './morningStrategyShared';

test('Practice chooses the one selected practice account even when it is not first', () => {
  const result = resolveSinglePracticeAccount([
    { account_id: 11, account_name: 'FUNDED-1' },
    { account_id: 22, account_name: 'PRAC-22' },
  ]);
  expect(result.count).toBe(1);
  expect(result.account.account_id).toBe(22);
});

test('Practice rejects an ambiguous multi-practice selection', () => {
  const result = resolveSinglePracticeAccount([
    { account_id: 22, account_name: 'PRAC-22' },
    { account_id: 33, account_name: 'Practice 33' },
  ]);
  expect(result).toEqual({ account: null, count: 2 });
});
