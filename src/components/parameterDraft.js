export const PARAMETER_DEFAULTS = {
  contractSize: 3,
  takeProfit: 900,
  stopLoss: 450,
  trailingStop: true,
  trailingDistance: 7,
  spreadPoints: 15,
  breakevenTrigger: 100,
  profitLockTrigger: 150,
  profitLockRetainPct: 50,
};

export function normalizeParameterDraft(draft) {
  return { ...PARAMETER_DEFAULTS, ...(draft || {}) };
}

export function armPayloadFromDraft(draft, accountIds, armRevision) {
  const p = normalizeParameterDraft(draft);
  const normalizedAccountIds = (Array.isArray(accountIds) ? accountIds : [accountIds])
    .filter(value => value != null && String(value).trim() !== '')
    .map(String);
  return {
    expected_arm_revision: armRevision,
    account_ids: [...new Set(normalizedAccountIds)],
    contract_size: p.contractSize,
    spread_points: p.spreadPoints,
    tp_dollars: p.takeProfit,
    sl_dollars: p.stopLoss,
    trailing_points: p.trailingDistance,
    trailing_enabled: !!p.trailingStop,
    breakeven_dollars: p.trailingStop && p.breakevenTrigger > 0 ? p.breakevenTrigger : null,
    profit_lock_dollars: p.trailingStop && p.profitLockTrigger > 0 ? p.profitLockTrigger : null,
    profit_lock_retain_pct: p.trailingStop ? p.profitLockRetainPct : null,
  };
}
