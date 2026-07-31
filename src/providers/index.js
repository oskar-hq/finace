import * as stooq from './stooq.js';
import * as yahoo from './yahoo.js';
import * as fred from './fred.js';
import * as frankfurter from './frankfurter.js';
import * as coingecko from './coingecko.js';
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
  [stooq, yahoo, fred, frankfurter, coingecko].map((p) => [p.id, p]),
);

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
      const raw = await provider.fetchSeries(spec, range);
      const scale = Number.isFinite(spec.scale) ? spec.scale : 1;
      const series = raw
        .filter((p) => p && p.date && Number.isFinite(p.value))
        .map((p) => ({ date: p.date, value: p.value * scale }))
        .sort((a, b) => a.date.localeCompare(b.date));

      if (series.length === 0) throw new Error('leere Zeitreihe');

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
