export const PARAMETER_DEFAULTS = {
  contractSize: 3,
  takeProfit: 900,
  stopLoss: 450,
  trailingStop: true,
  secureBE: false,
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
  // One NQ tick is worth $5 per contract. Secure BE activates on the
  // first favorable tick and keeps the advanced tier values internal so
  // customers cannot accidentally create contradictory trigger settings.
  const firstProfitableTickDollars = 5 * Math.max(1, Number(p.contractSize) || 1);
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
    breakeven_dollars: p.trailingStop && p.secureBE ? firstProfitableTickDollars : null,
    // Secure BE is one deterministic floor: move to entry on the first
    // favorable tick, then let the existing fixed-distance trailer ratchet.
    // Do not create a second profit-lock tier at the same activation point;
    // TrailingStopEngine correctly rejects duplicate tier activations.
    profit_lock_dollars: null,
    profit_lock_retain_pct: null,
  };
}
