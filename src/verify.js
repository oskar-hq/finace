/**
 * Quellen-Check:  npm run verify
 *
 * Probiert JEDE in config/metrics.js hinterlegte Quelle einzeln aus und zeigt,
 * welche erreichbar ist, wie aktuell sie ist und welchen Wert sie liefert.
 * Schreibt nichts in die Datenbank.
 *
 * Genau dafuer gedacht, bevor man den Cronjob scharf schaltet - und immer dann,
 * wenn eine Kennzahl im Dashboard auf "nicht verfuegbar" steht.
 */

import { METRICS } from '../config/metrics.js';
import { config } from './lib/env.js';
import { PROVIDERS } from './providers/index.js';
import { today, shiftDays, daysBetween } from './lib/dates.js';

const range = { from: shiftDays(today(), -30), to: today() };
const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 });

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

console.log(`Quellen-Check, Zeitraum ${range.from} .. ${range.to}`);
console.log(`FRED_API_KEY: ${config.fredApiKey ? 'gesetzt' : 'NICHT gesetzt (FRED wird uebersprungen)'}`);
console.log(`ANTHROPIC_API_KEY: ${config.anthropicApiKey ? 'gesetzt' : 'NICHT gesetzt (keine Erklaerungen)'}`);
console.log('');

let anyChainOk = true;

for (const metric of METRICS) {
  if (metric.derived) {
    console.log(`${metric.id}  ${DIM}(berechnet aus ${metric.derived.a} und ${metric.derived.b})${RESET}`);
    console.log('');
    continue;
  }

  console.log(`${metric.id}  ${DIM}${metric.label}${RESET}`);
  let chainOk = false;

  for (const spec of metric.providers) {
    const provider = PROVIDERS[spec.source];
    const name = `  ${spec.source}:${spec.symbol}`.padEnd(34);

    if (!provider) {
      console.log(`${name}${RED}unbekannter Provider${RESET}`);
      continue;
    }
    if (provider.isConfigured && !provider.isConfigured()) {
      console.log(`${name}${YELLOW}uebersprungen - kein API-Key${RESET}`);
      continue;
    }

    try {
      const series = await provider.fetchSeries(spec, range);
      if (series.length === 0) throw new Error('leere Zeitreihe');

      const scale = Number.isFinite(spec.scale) ? spec.scale : 1;
      const last = series.at(-1);
      const value = last.value * scale;
      const age = daysBetween(last.date, today());
      const ageTag = age > 5 ? `${YELLOW}(${age} Tage alt)${RESET}` : '';

      console.log(
        `${name}${GREEN}ok${RESET}  ${series.length} Werte, letzter ${last.date}: ` +
          `${nf.format(value)} ${ageTag}`,
      );
      chainOk = true;
    } catch (err) {
      console.log(`${name}${RED}Fehler${RESET} - ${err.message}`);
    }
  }

  if (!chainOk) {
    anyChainOk = false;
    console.log(`  ${RED}=> Keine Quelle fuer "${metric.id}" erreichbar.${RESET}`);
  }
  console.log('');
}

if (!anyChainOk) {
  console.log(`${RED}Mindestens eine Kennzahl hat gar keine funktionierende Quelle.${RESET}`);
  console.log('Tipp: Symbol in config/metrics.js pruefen oder eine andere Quelle nach vorne stellen.');
  process.exitCode = 1;
} else {
  console.log(`${GREEN}Fuer jede Kennzahl ist mindestens eine Quelle erreichbar.${RESET}`);
}
