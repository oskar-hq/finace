import { fetchJson } from '../lib/http.js';

/**
 * frankfurter - EZB-Referenzkurse, kein Key.
 * Der Dienst ist von frankfurter.app auf frankfurter.dev umgezogen; beide
 * Hosts werden der Reihe nach probiert.
 *
 * symbol = Zielwaehrung (Basis ist immer EUR), z.B. "USD" fuer EUR/USD.
 */
export const id = 'frankfurter';
export const label = 'frankfurter (EZB)';
export const needsKey = false;

const HOSTS = ['https://api.frankfurter.dev/v1', 'https://api.frankfurter.app'];

export async function fetchSeries({ symbol }, { from, to }) {
  const errors = [];

  for (const host of HOSTS) {
    const url = `${host}/${from}..${to}?base=EUR&symbols=${encodeURIComponent(symbol)}`;
    try {
      const json = await fetchJson(url, { headers: { accept: 'application/json' }, retries: 1 });
      const rates = json?.rates;
      if (!rates || typeof rates !== 'object') throw new Error('Feld "rates" fehlt');

      const series = [];
      for (const [date, byCurrency] of Object.entries(rates)) {
        const value = Number(byCurrency?.[symbol]);
        if (Number.isFinite(value)) series.push({ date, value });
      }
      if (series.length === 0) throw new Error('leere Zeitreihe');
      series.sort((a, b) => a.date.localeCompare(b.date));
      return series;
    } catch (err) {
      errors.push(`${host}: ${err.message}`);
    }
  }
  throw new Error(`frankfurter nicht erreichbar - ${errors.join(' | ')}`);
}
