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

// stooq.com und stooq.pl liegen hinter unterschiedlichen Schutzmechanismen -
// wenn der eine Host eine JS-Challenge ausliefert, klappt der andere manchmal.
const HOSTS = ['https://stooq.com', 'https://stooq.pl'];

export async function fetchSeries({ symbol }, { from, to }) {
  const query =
    `/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${compactDate(from)}&d2=${compactDate(to)}&i=d`;

  let csv = null;
  const errors = [];
  for (const host of HOSTS) {
    try {
      const body = await fetchText(`${host}${query}`, {
        retries: 1,
        headers: { accept: 'text/csv,text/plain,*/*', referer: `${host}/q/d/?s=${encodeURIComponent(symbol)}` },
      });
      if (/^\s*<!doctype|^\s*<html/i.test(body)) {
        throw new Error('Bot-Schutz: HTML-Seite statt CSV');
      }
      csv = body;
      break;
    } catch (err) {
      // Nur den Kern der Meldung - die volle URL steht sonst zweimal drin.
      errors.push(`${new URL(host).host}: ${err.message.replace(/\s*\(https?:\/\/[^)]*\)/, '')}`);
    }
  }

  if (csv === null) {
    throw new Error(
      `stooq lieferte keine CSV-Daten fuer "${symbol}" - ${errors.join(' | ')}. ` +
        'Von Rechenzentrums-IPs blockt stooq praktisch immer; eine andere Quelle nach vorne stellen.',
    );
  }

  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2 || !/^date,/i.test(lines[0])) {
    throw new Error(`stooq lieferte keine CSV-Daten fuer "${symbol}": ${csv.slice(0, 100)}`);
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
