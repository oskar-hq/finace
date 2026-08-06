import * as stooq from './stooq.js';
import * as yahoo from './yahoo.js';
import * as fred from './fred.js';
import * as frankfurter from './frankfurter.js';
import * as coingecko from './coingecko.js';
import * as twelvedata from './twelvedata.js';
import * as bundesbank from './bundesbank.js';
import * as ecb from './ecb.js';
import * as cboe from './cboe.js';
import * as alphavantage from './alphavantage.js';
import { log } from '../lib/log.js';

/**
 * Provider-Registry.
 *
 * Ein Provider ist ein Modul mit:
 *   id, label, needsKey, [isConfigured()], fetchSeries(spec, { from, to })
 * und liefert [{ date: 'YYYY-MM-DD', value: number }, ...].
 *
 * Eine neue Quelle ergaenzt man, indem man ein Modul nach diesem Muster
 * anlegt und es hier eintraegt - der Rest des Systems bleibt unberuehrt.
 */
export const PROVIDERS = Object.fromEntries(
  [stooq, yahoo, fred, frankfurter, coingecko, twelvedata, bundesbank, ecb, cboe, alphavantage].map((p) => [
    p.id,
    p,
  ]),
);

/**
 * Manche Anbieter deckeln die Anfragen pro Minute (Twelve Data: 8 im
 * kostenlosen Tarif). Ein Provider kann dafuer `minIntervalMs` exportieren;
 * hier wird der Abstand zwischen zwei Aufrufen desselben Providers gewahrt.
 */
const lastCallAt = new Map();

/**
 * Erster Wert ausserhalb des erlaubten Bereichs, sonst null.
 * Geprueft wird die ganze Reihe, nicht nur der letzte Wert - ein falsches
 * Symbol liefert durchgaengig falsche Zahlen, und so faellt es sofort auf.
 */
export function findImplausible(series, sanity) {
  if (!sanity) return null;
  const { min = -Infinity, max = Infinity } = sanity;
  return series.find((p) => p.value < min || p.value > max) ?? null;
}

async function respectRateLimit(provider) {
  const minInterval = provider.minIntervalMs ?? 0;
  if (minInterval <= 0) return;

  const previous = lastCallAt.get(provider.id) ?? 0;
  const waitMs = previous + minInterval - Date.now();
  if (waitMs > 0) {
    log.info(`  warte ${Math.ceil(waitMs / 1000)}s (Ratenlimit ${provider.label})`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastCallAt.set(provider.id, Date.now());
}

/**
 * Holt eine Kennzahl ueber ihre Provider-Kette: die erste Quelle, die
 * brauchbare Daten liefert, gewinnt. Faellt alles aus, wird ein Fehlerobjekt
 * zurueckgegeben statt zu werfen - das Dashboard soll den Rest trotzdem zeigen.
 *
 * @returns {{ ok: true, series, source, variant, providerId, note } |
 *           {  ok: false, attempts: {provider: string, error: string}[] }}
 */
export async function collectMetric(metric, range) {
  const attempts = [];

  for (const spec of metric.providers ?? []) {
    const provider = PROVIDERS[spec.source];
    if (!provider) {
      attempts.push({ provider: spec.source, error: 'unbekannter Provider' });
      continue;
    }
    if (provider.isConfigured && !provider.isConfigured()) {
      attempts.push({ provider: spec.source, error: 'nicht konfiguriert (kein API-Key)' });
      log.info(`  ${metric.id}: ${provider.label} uebersprungen (kein API-Key)`);
      continue;
    }

    try {
      await respectRateLimit(provider);
      const raw = await provider.fetchSeries(spec, range);
      const scale = Number.isFinite(spec.scale) ? spec.scale : 1;
      const series = raw
        .filter((p) => p && p.date && Number.isFinite(p.value))
        .map((p) => ({ date: p.date, value: p.value * scale }))
        .sort((a, b) => a.date.localeCompare(b.date));

      if (series.length === 0) throw new Error('leere Zeitreihe');

      // Plausibilitaetspruefung: Ein Symbol kann existieren und trotzdem etwas
      // ganz anderes meinen. Twelve Data liefert unter "DAX" z.B. den Global X
      // DAX Germany ETF in Dollar - rund 46 statt rund 26.000. Solche Werte
      // fallen ohne Pruefung niemandem auf, weil sie fuer sich genommen
      // plausibel aussehen.
      const bad = findImplausible(series, metric.sanity);
      if (bad) {
        throw new Error(
          `Wert ${bad.value.toLocaleString('de-DE')} vom ${bad.date} liegt ausserhalb des ` +
            `erwarteten Bereichs ${metric.sanity.min}...${metric.sanity.max} - ` +
            'vermutlich meint dieses Symbol eine andere Groesse',
        );
      }

      return {
        ok: true,
        series,
        source: `${spec.source}:${spec.symbol}`,
        providerId: spec.source,
        variant: spec.variant ?? null,
        note: spec.note ?? null,
      };
    } catch (err) {
      attempts.push({ provider: spec.source, error: err.message });
      log.warn(`  ${metric.id}: ${provider.label} fehlgeschlagen - ${err.message}`);
    }
  }

  return { ok: false, attempts };
}
