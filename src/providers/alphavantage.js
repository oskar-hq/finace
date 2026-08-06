import { fetchJson } from '../lib/http.js';
import { config } from '../lib/env.js';

/**
 * Alpha Vantage - kostenloser Key: https://www.alphavantage.co/support/#api-key
 *
 * ACHTUNG Kontingent: der kostenlose Tarif erlaubt nur **25 Abrufe pro Tag**.
 * Deshalb steht Alpha Vantage ueberall hinten in der Kette - es wird nur
 * angefragt, wenn die Quellen davor ausfallen. Fuer den 15-Minuten-Takt ist es
 * ungeeignet; als Reserve fuer den taeglichen Lauf ist es gut.
 *
 * Kein Ersatz fuer Aktienindizes: den DAX-Index liefert Alpha Vantage nicht.
 *
 * `symbol` kodiert Funktion und Argument, getrennt durch ":".
 *   BRENT                    Brent-Rohoel, taeglich
 *   WTI                      WTI-Rohoel, taeglich
 *   TREASURY_YIELD:10year    US-Rendite, taeglich
 *   FX_DAILY:EUR/USD         Wechselkurs
 *   TIME_SERIES_DAILY:IBM    Aktie oder ETF
 */
export const id = 'alphavantage';
export const label = 'Alpha Vantage';
export const needsKey = true;
// Kostenloser Tarif: 5 Anfragen pro Minute.
export const minIntervalMs = 13000;

export function isConfigured() {
  return Boolean(config.alphaVantageApiKey);
}

export async function fetchSeries({ symbol }, { from, to }) {
  if (!isConfigured()) {
    throw Object.assign(new Error('ALPHAVANTAGE_API_KEY ist nicht gesetzt'), { skipped: true });
  }

  const [fn, arg] = String(symbol).split(':');
  const params = new URLSearchParams({ function: fn, apikey: config.alphaVantageApiKey });

  switch (fn) {
    case 'BRENT':
    case 'WTI':
    case 'NATURAL_GAS':
      params.set('interval', 'daily');
      break;
    case 'TREASURY_YIELD':
      params.set('interval', 'daily');
      params.set('maturity', arg || '10year');
      break;
    case 'FX_DAILY': {
      const [base, quote] = (arg || '').split('/');
      if (!base || !quote) throw new Error(`Alpha Vantage: FX_DAILY braucht "BASIS/ZIEL", nicht "${arg}"`);
      params.set('from_symbol', base);
      params.set('to_symbol', quote);
      params.set('outputsize', 'compact');
      break;
    }
    case 'TIME_SERIES_DAILY':
      if (!arg) throw new Error('Alpha Vantage: TIME_SERIES_DAILY braucht ein Symbol');
      params.set('symbol', arg);
      params.set('outputsize', 'compact');
      break;
    default:
      throw new Error(`Alpha Vantage: unbekannte Funktion "${fn}"`);
  }

  const json = await fetchJson(`https://www.alphavantage.co/query?${params}`, {
    headers: { accept: 'application/json' },
  });

  // Alpha Vantage meldet Fehler und Limits mit HTTP 200 und einem Textfeld.
  for (const field of ['Note', 'Information', 'Error Message']) {
    if (json?.[field]) {
      const hint = /limit|frequency/i.test(json[field])
        ? ' (Tageskontingent von 25 Abrufen erschoepft?)'
        : '';
      throw new Error(`Alpha Vantage: ${json[field]}${hint}`);
    }
  }

  const series = extract(json, fn);
  const inRange = series.filter((p) => p.date >= from && p.date <= to);
  if (inRange.length === 0) {
    throw new Error(`Alpha Vantage: keine Werte im Zeitraum ${from} bis ${to}`);
  }
  return inRange;
}

function extract(json, fn) {
  // Rohstoff- und Zinsreihen: flaches {data: [{date, value}]}
  if (Array.isArray(json?.data)) {
    return json.data
      .map((row) => ({ date: String(row.date ?? '').slice(0, 10), value: Number(row.value) }))
      .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value));
  }

  // Kurs- und FX-Reihen: verschachteltes Objekt, Schluesselname variiert.
  const key = Object.keys(json ?? {}).find((k) => /time series/i.test(k));
  if (!key) throw new Error(`Alpha Vantage: unerwartete Antwortform bei ${fn}`);

  return Object.entries(json[key])
    .map(([date, row]) => ({
      date: date.slice(0, 10),
      value: Number(row?.['4. close'] ?? row?.['4a. close'] ?? NaN),
    }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}
