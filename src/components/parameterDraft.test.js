import { armPayloadFromDraft, normalizeParameterDraft } from './parameterDraft';

test('a second device loads the saved server draft without changing armed truth', () => {
  const saved = normalizeParameterDraft({ contractSize: 2, takeProfit: 700 });
  const armed = { contract_size: 1, tp_dollars: 500 };
  expect(saved.contractSize).toBe(2);
  expect(saved.takeProfit).toBe(700);
  expect(armed).toEqual({ contract_size: 1, tp_dollars: 500 });
});

test('update armed bot sends the complete saved draft and arm revision', () => {
  expect(armPayloadFromDraft({ contractSize: 4 }, 'acct-1', 8)).toMatchObject({
    expected_arm_revision: 8,
    account_ids: ['acct-1'],
    contract_size: 4,
    tp_dollars: 900,
    sl_dollars: 450,
  });
});

test('Secure BE uses the first profitable NQ tick for the selected quantity', () => {
  expect(armPayloadFromDraft({ contractSize: 2, secureBE: true }, 'acct-1', 8)).toMatchObject({
    breakeven_dollars: 10,
    profit_lock_dollars: null,
    profit_lock_retain_pct: null,
  });
  expect(armPayloadFromDraft({ contractSize: 5, secureBE: true }, 'acct-1', 8)).toMatchObject({
    breakeven_dollars: 25,
    profit_lock_dollars: null,
    profit_lock_retain_pct: null,
  });
});

test('Secure BE off disables hidden advanced tiers even for a legacy draft', () => {
  expect(armPayloadFromDraft({
    contractSize: 2,
    secureBE: false,
    breakevenTrigger: 100,
    profitLockTrigger: 150,
    profitLockRetainPct: 75,
  }, 'acct-1', 8)).toMatchObject({
    breakeven_dollars: null,
    profit_lock_dollars: null,
    profit_lock_retain_pct: null,
  });
});

test('legacy drafts without Secure BE load with the toggle safely off', () => {
  expect(normalizeParameterDraft({ contractSize: 2 }).secureBE).toBe(false);
});
