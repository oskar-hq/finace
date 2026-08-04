import { fetchJson } from '../lib/http.js';
import { config } from '../lib/env.js';
import { daysBetween } from '../lib/dates.js';

/**
 * Twelve Data - kostenloser Tier, funktioniert im Gegensatz zu stooq und Yahoo
 * auch von Rechenzentrums-IPs aus. Key holen: https://twelvedata.com/pricing
 *
 * Grenzen des Free-Tiers (Stand der Anbieter-Doku):
 *   - 800 Credits pro Tag, 8 Anfragen pro Minute
 *   - eine time_series-Abfrage kostet 1 Credit
 *   - Forex, Krypto und US-Werte sind abgedeckt; Indizes und einzelne
 *     Auslandsboersen koennen je nach Plan gesperrt sein. Genau deshalb
 *     bleiben stooq und Yahoo als weitere Glieder in der Kette stehen.
 *
 * Der 8-pro-Minute-Deckel wird ueber minIntervalMs in der Registry
 * eingehalten - siehe src/providers/index.js.
 */
export const id = 'twelvedata';
export const label = 'Twelve Data';
export const needsKey = true;
export const minIntervalMs = 8000;

export function isConfigured() {
  return Boolean(config.twelveDataApiKey);
}

export async function fetchSeries({ symbol, exchange }, { from, to }) {
  if (!isConfigured()) {
    throw Object.assign(new Error('TWELVEDATA_API_KEY ist nicht gesetzt'), { skipped: true });
  }

  // outputsize zaehlt Datenpunkte, nicht Kalendertage. Grosszuegig aufrunden
  // (Wochenenden/Feiertage), aber innerhalb des Free-Tier-Maximums bleiben.
  const outputsize = Math.min(5000, Math.max(10, daysBetween(from, to) + 10));

  const params = new URLSearchParams({
    symbol,
    interval: '1day',
    outputsize: String(outputsize),
    order: 'ASC',
    format: 'JSON',
    apikey: config.twelveDataApiKey,
  });
  if (exchange) params.set('exchange', exchange);

  const json = await fetchJson(`https://api.twelvedata.com/time_series?${params}`, {
    headers: { accept: 'application/json' },
  });

  // Fehler kommen mit HTTP 200 und status:"error" zurueck.
  if (json?.status === 'error') {
    const hint =
      json.code === 403 || /plan|upgrade|not available/i.test(json.message ?? '')
        ? ' (Symbol vermutlich nicht im kostenlosen Tarif enthalten)'
        : '';
    throw new Error(`Twelve Data: ${json.message ?? 'unbekannter Fehler'}${hint}`);
  }
  if (!Array.isArray(json?.values)) {
    throw new Error(`Twelve Data: keine Zeitreihe fuer "${symbol}"`);
  }

  const series = [];
  for (const row of json.values) {
    const date = String(row?.datetime ?? '').slice(0, 10);
    const value = Number(row?.close);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value)) series.push({ date, value });
  }
  return series;
}
