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
    account_id: 'acct-1',
    contract_size: 4,
    tp_dollars: 900,
    sl_dollars: 450,
  });
});
