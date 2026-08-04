import { fetchText } from '../lib/http.js';

/**
 * CBOE - die Boerse, die den VIX selbst berechnet, stellt die komplette
 * Tageshistorie als CSV bereit. Kein Key, keine Bot-Sperre, offizielle Quelle.
 *
 *   https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv
 *
 * `symbol` ist der Indexname, z.B. "VIX" (auch "VIX9D", "VVIX", "VXN", "RVX").
 *
 * Achtung: die Datei enthaelt die Historie seit 1990 (einige hundert KB). Der
 * Provider schneidet direkt auf den angefragten Zeitraum zu, damit nicht bei
 * jedem Lauf 9000 Zeilen in die Datenbank wandern.
 */
export const id = 'cboe';
export const label = 'CBOE (offiziell)';
export const needsKey = false;

export async function fetchSeries({ symbol }, { from, to }) {
  const url = `https://cdn.cboe.com/api/global/us_indices/daily_prices/${encodeURIComponent(symbol)}_History.csv`;
  const csv = await fetchText(url, { headers: { accept: 'text/csv' } });

  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error(`CBOE: leere Datei fuer "${symbol}"`);

  const header = lines[0].split(',').map((h) => h.trim().toUpperCase());
  const iDate = header.indexOf('DATE');
  const iClose = header.indexOf('CLOSE');
  if (iDate < 0 || iClose < 0) {
    throw new Error(`CBOE: unerwartete Spalten (${lines[0].slice(0, 80)})`);
  }

  const series = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const date = normalizeDate(cols[iDate]);
    const value = Number(cols[iClose]);
    if (!date || !Number.isFinite(value)) continue;
    if (date < from || date > to) continue;
    series.push({ date, value });
  }

  if (series.length === 0) {
    throw new Error(`CBOE: keine Werte im Zeitraum ${from} bis ${to}`);
  }
  return series;
}

/** CBOE liefert je nach Datei "M/D/YYYY" oder bereits "YYYY-MM-DD". */
function normalizeDate(raw) {
  const value = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
