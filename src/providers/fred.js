import { fetchJson } from '../lib/http.js';
import { config } from '../lib/env.js';

/**
 * FRED (Federal Reserve Bank of St. Louis) - offizielle Quelle, kostenloser Key.
 * Key holen: https://fredaccount.stlouisfed.org/apikeys
 *
 * Serien: DTWEXBGS (handelsgewichteter Dollar-Index, breit),
 *         DGS10 (10J-Rendite), DCOILBRENTEU (Brent Spot)
 *
 * Ohne FRED_API_KEY meldet sich der Provider als "nicht konfiguriert" und die
 * naechste Quelle in der Kette uebernimmt.
 */
export const id = 'fred';
export const label = 'FRED (St. Louis Fed)';
export const needsKey = true;

export function isConfigured() {
  return Boolean(config.fredApiKey);
}

export async function fetchSeries({ symbol }, { from, to }) {
  if (!isConfigured()) {
    throw Object.assign(new Error('FRED_API_KEY ist nicht gesetzt'), { skipped: true });
  }

  const url =
    'https://api.stlouisfed.org/fred/series/observations' +
    `?series_id=${encodeURIComponent(symbol)}` +
    `&api_key=${encodeURIComponent(config.fredApiKey)}` +
    `&file_type=json&observation_start=${from}&observation_end=${to}`;

  const json = await fetchJson(url, { headers: { accept: 'application/json' } });
  if (!Array.isArray(json?.observations)) {
    throw new Error(`FRED: keine Beobachtungen fuer "${symbol}"`);
  }

  const series = [];
  for (const obs of json.observations) {
    // FRED markiert fehlende Werte (Feiertage) mit "."
    const value = Number(obs.value);
    if (obs.value === '.' || !Number.isFinite(value)) continue;
    series.push({ date: obs.date, value });
  }
  return series;
}
