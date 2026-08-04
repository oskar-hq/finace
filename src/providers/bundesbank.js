import { fetchText } from '../lib/http.js';
import { parseSdmxCsv } from '../lib/sdmx.js';

/**
 * Deutsche Bundesbank - Zeitreihen-Datenbank ueber die offene REST-Schnittstelle.
 * Kein Key, keine Registrierung, offizielle Quelle.
 *
 * `symbol` ist der komplette Reihenschluessel inklusive Datenstruktur, z.B.
 *   BBSIS/D.I.ZST.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A
 *   = Rendite boersennotierter Bundeswertpapiere, 10 Jahre Restlaufzeit, taeglich.
 *
 * Reihen findet man ueber https://www.bundesbank.de/dynamic/action/de/statistiken
 * (Zeitreihe waehlen -> "Datenschnittstelle" zeigt den Schluessel).
 */
export const id = 'bundesbank';
export const label = 'Deutsche Bundesbank';
export const needsKey = false;

export async function fetchSeries({ symbol }, { from, to }) {
  const [flow, ...rest] = symbol.split('/');
  const key = rest.join('/');
  if (!flow || !key) {
    throw new Error(`Bundesbank: Reihenschluessel muss "FLOW/KEY" lauten, bekommen: "${symbol}"`);
  }

  const url =
    `https://api.statistiken.bundesbank.de/rest/data/${encodeURIComponent(flow)}/${key}` +
    `?startPeriod=${from}&endPeriod=${to}&format=csv&lang=de`;

  const csv = await fetchText(url, { headers: { accept: 'text/csv, application/vnd.sdmx.data+csv' } });
  return parseSdmxCsv(csv);
}
