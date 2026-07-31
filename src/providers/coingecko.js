import { fetchJson } from '../lib/http.js';
import { toIsoDate, daysBetween } from '../lib/dates.js';

/**
 * CoinGecko - kostenlos, kein Key (Free-Tier ist rate-limitiert, fuer einen
 * Lauf pro Tag voellig ausreichend).
 *
 * symbol = CoinGecko-Coin-ID, z.B. "bitcoin".
 */
export const id = 'coingecko';
export const label = 'CoinGecko';
export const needsKey = false;

export async function fetchSeries({ symbol }, { from, to }) {
  const days = Math.max(2, Math.min(365, daysBetween(from, to)));
  const url =
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(symbol)}/market_chart` +
    `?vs_currency=usd&days=${days}&interval=daily`;

  const json = await fetchJson(url, { headers: { accept: 'application/json' } });
  if (!Array.isArray(json?.prices)) throw new Error(`CoinGecko: keine Preise fuer "${symbol}"`);

  // Pro Tag den letzten gelieferten Punkt behalten.
  const byDate = new Map();
  for (const [ms, price] of json.prices) {
    const date = toIsoDate(new Date(ms));
    if (date && Number.isFinite(price)) byDate.set(date, price);
  }

  return [...byDate.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
