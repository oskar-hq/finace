import { fetchText } from '../lib/http.js';
import { parseSdmxCsv } from '../lib/sdmx.js';

/**
 * EZB Data Portal - offene SDMX-Schnittstelle, kein Key.
 *
 * `symbol` ist "FLOW/KEY", z.B.
 *   YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y
 *   = Zinsstrukturkurve Euroraum, AAA-Staatsanleihen, 10 Jahre, taeglich.
 *
 * Hinweis zur Bedeutung: Diese Kurve bildet die AAA-Emittenten des Euroraums ab.
 * Sie laeuft sehr nah an der Bundesanleihe, ist aber nicht dasselbe - deshalb
 * traegt sie in config/metrics.js eine eigene `variant`, damit Veraenderungen
 * nicht ueber einen Quellenwechsel hinweg berechnet werden.
 */
export const id = 'ecb';
export const label = 'EZB Data Portal';
export const needsKey = false;

export async function fetchSeries({ symbol }, { from, to }) {
  const [flow, ...rest] = symbol.split('/');
  const key = rest.join('/');
  if (!flow || !key) {
    throw new Error(`EZB: Reihenschluessel muss "FLOW/KEY" lauten, bekommen: "${symbol}"`);
  }

  const url =
    `https://data-api.ecb.europa.eu/service/data/${encodeURIComponent(flow)}/${key}` +
    `?startPeriod=${from}&endPeriod=${to}&format=csvdata`;

  const csv = await fetchText(url, { headers: { accept: 'text/csv' } });
  return parseSdmxCsv(csv);
}
