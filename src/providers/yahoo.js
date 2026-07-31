import { fetchJson } from '../lib/http.js';
import { toIsoDate } from '../lib/dates.js';

/**
 * Yahoo Finance Chart-API - inoffiziell, kein Key, kann sich jederzeit aendern.
 * Deshalb hier bewusst nur als Fallback konfiguriert (siehe config/metrics.js).
 *
 * Symbole: ^GDAXI, ^VIX, ^TNX, GC=F, BZ=F, DX-Y.NYB
 */
export const id = 'yahoo';
export const label = 'Yahoo Finance (inoffiziell)';
export const needsKey = false;

export async function fetchSeries({ symbol }, { from, to }) {
  const p1 = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
  const p2 = Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${p1}&period2=${p2}&interval=1d`;

  const json = await fetchJson(url, { headers: { accept: 'application/json' } });

  const err = json?.chart?.error;
  if (err) throw new Error(`Yahoo: ${err.code || 'Fehler'} - ${err.description || ''}`);

  const result = json?.chart?.result?.[0];
  const stamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(stamps) || !Array.isArray(closes)) {
    throw new Error(`Yahoo: keine Zeitreihe fuer "${symbol}"`);
  }

  const series = [];
  for (let i = 0; i < stamps.length; i++) {
    const value = closes[i];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    const date = toIsoDate(new Date(stamps[i] * 1000));
    if (date) series.push({ date, value });
  }
  return series;
}
