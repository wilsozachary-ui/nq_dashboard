/**
 * pnlApi.js — Monthly P&L data layer
 *
 * Environment configuration:
 *   REACT_APP_API_URL=http://localhost:8080      (adapter, local dev)
 *   REACT_APP_API_URL=https://api.yourdomain.com  (production)
 *
 * Real endpoint contract:
 *   GET /pnl/monthly?month=6&year=2026&strategy=overall&account_id=123
 *   Response: Array<{ date: string, realized: number, unrealized: number, net: number, trades: number, strategy: string, account_id: string|null }>
 *
 * strategy values: "overall" | "morning_strategy" | "orb"
 * account_id: omit for all accounts combined; pass a specific id to filter to one account
*/
import { getSessionToken } from '../services/sessionToken';
import { readJsonResponse, unwrapApiBody } from '../services/apiContract';

export const USE_MOCK = false; // live mode — all components use real WS + REST feeds
// Same-origin fallback -- see botApi.js for the rationale (identical
// behavior for the desktop exe, generalizes correctly per cloud tenant).
// Local `npm start` overrides this via .env.development.
export const API_ROOT = process.env.REACT_APP_API_URL
  || `${window.location.protocol}//${window.location.host}`;

const RETRY_DELAY_MS = 500;

// ── Internal helpers ──────────────────────────────────────────────────────────

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

async function attempt(url, signal) {
  const token = getSessionToken();
  const res = await fetch(url, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`Failed to fetch monthly PnL (${res.status})`);
  const data = unwrapApiBody(await readJsonResponse(res, 'GET /pnl/monthly'), 'GET /pnl/monthly');
  if (!Array.isArray(data)) throw new Error('GET /pnl/monthly returned a non-array payload');
  return data;
}

// ── Public export ─────────────────────────────────────────────────────────────

/**
 * Fetch monthly P&L records for the given period and strategy.
 *
 * Calls GET /pnl/monthly?month=M&year=Y&strategy=S,
 * with one automatic retry after RETRY_DELAY_MS on failure.
 *
 * @param {number}      month     1-indexed (1 = January)
 * @param {number}      year      e.g. 2026
 * @param {string}      strategy  "overall" | "morning_strategy" | "orb"
 * @param {string|null} [accountId] optional account filter; omit/null for all accounts
 * @param {AbortSignal} [signal]  optional cancellation token
 * @returns {Promise<Array<{date:string, pnl:number, trades:number, strategy:string}>>}
 */
export async function getMonthlyPnL(month, year, strategy, accountId, signal) {
  const params = new URLSearchParams({ month, year, strategy });
  if (accountId) params.set('account_id', accountId);
  const url = `${API_ROOT}/pnl/monthly?${params.toString()}`;
  try {
    return await attempt(url, signal);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    await sleep(RETRY_DELAY_MS, signal);
    return attempt(url, signal);
  }
}
