/**
 * Unplausible Werte aus der Datenbank raeumen:
 *
 *   npm run prune             nur anzeigen, was auffaellt (aendert nichts)
 *   npm run prune -- --yes    gefundene Werte wirklich loeschen
 *   npm run prune -- --metric dax --yes
 *
 * Hintergrund: Bevor es die sanity-Grenzen in config/metrics.js gab, konnte
 * eine Quelle mit falschem Symbol stillschweigend falsche Zahlen liefern -
 * etwa ein DAX-ETF in Dollar (rund 46) statt des Index (rund 26.000). Solche
 * Werte stehen dann dauerhaft in der Historie und verzerren die
 * Veraenderungen. Neue Laeufe koennen sie nicht ueberschreiben, weil sie an
 * anderen Tagen haengen.
 *
 * Ohne --yes wird nichts geloescht.
 */

import { METRICS } from '../config/metrics.js';
import { config } from './lib/env.js';
import { openDb } from './lib/db.js';
import { findImplausible } from './providers/index.js';

const args = process.argv.slice(2);
const apply = args.includes('--yes');
const metricArg = args.includes('--metric') ? args[args.indexOf('--metric') + 1] : null;

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const db = openDb();
const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

let totalBad = 0;
let totalDeleted = 0;

for (const metric of METRICS) {
  if (metricArg && metric.id !== metricArg) continue;
  if (!metric.sanity) continue;

  const rows = db
    .prepare('SELECT obs_date AS date, value, source FROM observations WHERE metric_id = ? ORDER BY obs_date')
    .all(metric.id);

  const bad = rows.filter((r) => findImplausible([r], metric.sanity));
  if (bad.length === 0) continue;

  totalBad += bad.length;
  const { min, max } = metric.sanity;
  console.log(
    `${metric.id}  ${DIM}${metric.label} - erwartet ${min}...${max}${RESET}\n` +
      `  ${RED}${bad.length} von ${rows.length} Werten unplausibel${RESET}`,
  );

  // Nach Quelle gruppieren - meist ist genau eine Quelle der Uebeltaeter.
  const bySource = new Map();
  for (const r of bad) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  for (const [source, count] of bySource) {
    const sample = bad.find((r) => r.source === source);
    console.log(`    ${source}: ${count}x, z.B. ${nf.format(sample.value)} am ${sample.date}`);
  }

  if (apply) {
    const stmt = db.prepare('DELETE FROM observations WHERE metric_id = ? AND obs_date = ?');
    db.exec('BEGIN');
    try {
      for (const r of bad) stmt.run(metric.id, r.date);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    totalDeleted += bad.length;
    console.log(`    ${GREEN}geloescht${RESET}`);
  }
  console.log('');
}

db.close();

if (totalBad === 0) {
  console.log(`${GREEN}Keine unplausiblen Werte in ${config.dbPath}.${RESET}`);
} else if (apply) {
  console.log(`${GREEN}${totalDeleted} Werte geloescht.${RESET}`);
  console.log('Danach einmal "npm run update" laufen lassen, um die Luecken neu zu fuellen.');
} else {
  console.log(`${totalBad} unplausible Werte gefunden. Zum Loeschen: npm run prune -- --yes`);
}
