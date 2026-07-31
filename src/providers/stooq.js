import { fetchText } from '../lib/http.js';
import { compactDate, toIsoDate } from '../lib/dates.js';

/**
 * stooq.com - CSV-Download, kein Key noetig.
 * Beispiel: https://stooq.com/q/d/l/?s=xauusd&d1=20260101&d2=20260731&i=d
 *
 * Symbole: xauusd (Gold), ^dax, ^vix, eurusd, btcusd, cb.f (Brent Future)
 */
export const id = 'stooq';
export const label = 'stooq.com';
export const needsKey = false;

export async function fetchSeries({ symbol }, { from, to }) {
  const url =
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}` +
    `&d1=${compactDate(from)}&d2=${compactDate(to)}&i=d`;

  const csv = await fetchText(url);
  const lines = csv.trim().split(/\r?\n/);

  if (lines.length < 2 || !/^date,/i.test(lines[0])) {
    // stooq liefert bei unbekannten Symbolen oder Drosselung Klartext
    throw new Error(`stooq lieferte keine CSV-Daten fuer "${symbol}": ${csv.slice(0, 120)}`);
  }

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iDate = header.indexOf('date');
  const iClose = header.indexOf('close');
  if (iDate < 0 || iClose < 0) throw new Error(`stooq: unerwartete Spalten (${lines[0]})`);

  const series = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const date = toIsoDate(cols[iDate]);
    const value = Number(cols[iClose]);
    if (date && Number.isFinite(value)) series.push({ date, value });
  }
  return series;
}
