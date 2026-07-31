/**
 * Demo-Daten:  npm run demo
 *
 * Erzeugt eine public/data/latest.json aus SYNTHETISCHEN Zahlen - ohne
 * Internet und ohne API-Key. Damit laesst sich das Frontend ansehen und
 * anpassen, bevor die echten Quellen konfiguriert sind.
 *
 * Nutzt eine eigene Datenbank (data/demo.db) und fasst die echte nicht an.
 * Die VIX-Kennzahl bleibt absichtlich leer, um die Anzeige "Daten aktuell
 * nicht verfuegbar" zu zeigen.
 */

import path from 'node:path';
import { METRICS, CHANGE_WINDOWS } from '../config/metrics.js';
import { config, ROOT } from './lib/env.js';
import { log } from './lib/log.js';
import { openDb, upsertSeries, readSeries } from './lib/db.js';
import { buildSnapshot, deriveSeries } from './lib/analyze.js';
import { writeJsonAtomic } from './lib/output.js';
import { today, shiftDays } from './lib/dates.js';

const START_LEVEL = {
  gold_usd: 2350,
  brent: 78,
  us10y: 4.25,
  dollar_index: 121,
  eurusd: 1.08,
  dax: 18500,
  btc_usd: 62000,
};

const DAILY_VOL = {
  gold_usd: 0.008,
  brent: 0.018,
  us10y: 0.012,
  dollar_index: 0.003,
  eurusd: 0.004,
  dax: 0.009,
  btc_usd: 0.03,
};

// Fester Startwert, damit die Demo reproduzierbar ist.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomWalk(metricId, days) {
  const rng = makeRng([...metricId].reduce((a, c) => a + c.charCodeAt(0), 7));
  const vol = DAILY_VOL[metricId] ?? 0.01;
  let value = START_LEVEL[metricId];
  const out = [];

  for (let i = days; i >= 0; i--) {
    const date = shiftDays(today(), -i);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    // Boersendaten gibt es nur werktags - Bitcoin laeuft durch.
    if (metricId !== 'btc_usd' && (weekday === 0 || weekday === 6)) continue;
    value *= 1 + (rng() - 0.5) * 2 * vol;
    out.push({ date, value: Number(value.toFixed(6)) });
  }
  return out;
}

const db = openDb(path.join(ROOT, 'data', 'demo.db'));
db.exec('DELETE FROM observations');

for (const metric of METRICS) {
  if (!metric.providers) continue;
  if (metric.id === 'vix') continue; // absichtlich ausgelassen
  const series = randomWalk(metric.id, 120);
  upsertSeries(db, metric.id, series, {
    source: `demo:${metric.id}`,
    variant: 'Synthetische Demo-Daten',
  });
  log.ok(`${metric.id.padEnd(14)} ${series.length} Demo-Werte`);
}

for (const metric of METRICS) {
  if (!metric.derived) continue;
  const { op, a, b } = metric.derived;
  const derived = deriveSeries(op, readSeries(db, a), readSeries(db, b));
  upsertSeries(db, metric.id, derived, { source: `demo:${metric.id}`, variant: null });
  log.ok(`${metric.id.padEnd(14)} ${derived.length} Demo-Werte berechnet`);
}

const snapshots = METRICS.map((metric) => {
  const snap = buildSnapshot(metric, readSeries(db, metric.id), {
    historyDays: config.historyDays,
  });
  snap.explanation =
    snap.status === 'unavailable'
      ? null
      : `Beispieltext. Im echten Betrieb steht hier die KI-Erklaerung zu "${metric.label}": ` +
        'was sich bewegt hat, welcher Mechanismus typischerweise dahintersteckt und was die ' +
        'Kennzahl grundsaetzlich aussagt.';
  if (snap.status === 'unavailable') snap.note = 'Daten aktuell nicht verfuegbar';
  return snap;
});

writeJsonAtomic(config.outputPath, {
  schema_version: 1,
  demo: true,
  generated_at: new Date().toISOString(),
  data_date: today(),
  windows: CHANGE_WINDOWS,
  ai: {
    status: 'skipped',
    model: null,
    error: null,
    usage: null,
    summary:
      'Demo-Modus: Alle Zahlen auf dieser Seite sind synthetisch erzeugt und haben nichts mit ' +
      'echten Marktdaten zu tun. Sie dienen nur dazu, das Layout zu pruefen.',
    disclaimer:
      'Die Erklaerungen sind KI-generiert und beruhen ausschliesslich auf den angezeigten Zahlen ' +
      'sowie allgemeinen Marktzusammenhaengen - nicht auf aktuellen Nachrichten. Keine Anlageberatung.',
  },
  glossary: {
    term: 'Realzins',
    text:
      'Demo-Text: Der Realzins ist der Nominalzins abzueglich der erwarteten Inflation. Er zeigt, ' +
      'was eine Anlage nach Kaufkraftverlust tatsaechlich einbringt.',
  },
  stats: { ok: snapshots.filter((s) => s.status !== 'unavailable').length, failed: 1, duration_ms: 0 },
  metrics: snapshots,
});

db.close();
log.info(`Demo-Daten geschrieben nach ${config.outputPath}`);
log.info('Jetzt "npm run serve" starten und http://127.0.0.1:8080 oeffnen.');
