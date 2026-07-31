/**
 * Generator-Skript - Einstiegspunkt fuer den taeglichen Cron-Lauf.
 *
 *   npm run update            normaler Lauf (Daten + KI)
 *   npm run update:no-ai      nur Daten holen und speichern
 *
 * Ablauf: Marktdaten holen -> in SQLite speichern -> Veraenderungen berechnen
 *         -> ein Anthropic-Call fuer alle Erklaerungen -> public/data/latest.json
 */

import { METRICS, CHANGE_WINDOWS } from '../config/metrics.js';
import { config } from './lib/env.js';
import { log } from './lib/log.js';
import { openDb, upsertSeries, readSeries, startRun, finishRun } from './lib/db.js';
import { collectMetric } from './providers/index.js';
import { buildSnapshot, deriveSeries } from './lib/analyze.js';
import { writeJsonAtomic } from './lib/output.js';
import { generateExplanations } from './ai/explain.js';
import { pickGlossaryTerm } from './ai/glossary.js';
import { today, shiftDays } from './lib/dates.js';

const noAiFlag = process.argv.includes('--no-ai');

async function main() {
  const startedAt = new Date();
  const runDate = today();
  const range = { from: shiftDays(runDate, -config.fetchDays), to: runDate };

  log.info(`Lauf gestartet - Zeitraum ${range.from} bis ${range.to}`);
  if (noAiFlag) config.skipAi = true;

  const db = openDb();
  const runId = startRun(db);

  const metricsById = new Map(METRICS.map((m) => [m.id, m]));
  const fetchResults = new Map();
  let okCount = 0;
  let failCount = 0;

  // --- 1. Direkt abrufbare Kennzahlen -------------------------------------
  for (const metric of METRICS) {
    if (!metric.providers) continue;

    const result = await collectMetric(metric, range);
    fetchResults.set(metric.id, result);

    if (result.ok) {
      const written = upsertSeries(db, metric.id, result.series, {
        source: result.source,
        variant: result.variant,
      });
      okCount++;
      log.ok(`${metric.id.padEnd(14)} ${written} Werte via ${result.source}`);
    } else {
      failCount++;
      log.error(
        `${metric.id.padEnd(14)} keine Quelle erreichbar ` +
          `(${result.attempts.map((a) => `${a.provider}: ${a.error}`).join(' | ')})`,
      );
    }
  }

  // --- 2. Abgeleitete Kennzahlen ------------------------------------------
  for (const metric of METRICS) {
    if (!metric.derived) continue;
    const { op, a, b } = metric.derived;
    const rowsA = readSeries(db, a);
    const rowsB = readSeries(db, b);
    const derived = deriveSeries(op, rowsA, rowsB);

    if (derived.length > 0) {
      upsertSeries(db, metric.id, derived, { source: `derived:${a}/${b}`, variant: null });
      okCount++;
      log.ok(`${metric.id.padEnd(14)} ${derived.length} Werte berechnet aus ${a} und ${b}`);
    } else {
      failCount++;
      log.error(`${metric.id.padEnd(14)} nicht berechenbar (${a} oder ${b} fehlt)`);
    }
  }

  // --- 3. Snapshots bauen --------------------------------------------------
  const snapshots = METRICS.map((metric) => {
    const rows = readSeries(db, metric.id);
    const snap = buildSnapshot(metric, rows, { historyDays: config.historyDays, asOfToday: runDate });

    if (snap.status === 'unavailable') {
      const result = fetchResults.get(metric.id);
      snap.note = 'Daten aktuell nicht verfuegbar';
      snap.error_detail = result?.attempts?.map((x) => `${x.provider}: ${x.error}`).join(' | ') ?? null;
    } else if (snap.status === 'stale') {
      snap.note = `Letzter verfuegbarer Wert vom ${snap.as_of}`;
      const result = fetchResults.get(metric.id);
      if (result && !result.ok) {
        snap.note += ' - aktuelle Abfrage ist fehlgeschlagen';
        snap.error_detail = result.attempts.map((x) => `${x.provider}: ${x.error}`).join(' | ');
      }
    }
    return snap;
  });

  // --- 4. KI-Erklaerungen (genau ein Call) --------------------------------
  const glossaryTerm = pickGlossaryTerm(db, runDate);
  const ai = await generateExplanations(
    snapshots,
    metricsById,
    glossaryTerm,
    new Date(`${runDate}T12:00:00Z`).toLocaleDateString('de-DE', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  );

  for (const snap of snapshots) {
    snap.explanation = ai.explanations.get(snap.id) ?? null;
  }

  // --- 5. Ausgabe ----------------------------------------------------------
  const payload = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    data_date: runDate,
    windows: CHANGE_WINDOWS,
    ai: {
      status: ai.status,
      model: ai.status === 'ok' ? config.aiModel : null,
      error: ai.error,
      usage: ai.usage,
      summary: ai.summary,
      disclaimer:
        'Die Erklaerungen sind KI-generiert und beruhen ausschliesslich auf den angezeigten ' +
        'Zahlen sowie allgemeinen Marktzusammenhaengen - nicht auf aktuellen Nachrichten. ' +
        'Keine Anlageberatung.',
    },
    glossary: glossaryTerm ? { term: glossaryTerm, text: ai.glossary } : null,
    stats: { ok: okCount, failed: failCount, duration_ms: Date.now() - startedAt.getTime() },
    metrics: snapshots,
  };

  writeJsonAtomic(config.outputPath, payload);
  finishRun(db, runId, {
    okCount,
    failCount,
    aiStatus: ai.status,
    note: ai.error ?? null,
  });
  db.close();

  log.info(
    `Fertig: ${okCount} ok, ${failCount} fehlgeschlagen, KI ${ai.status}, ` +
      `${Math.round((Date.now() - startedAt.getTime()) / 100) / 10}s -> ${config.outputPath}`,
  );

  // Exit-Code 1, wenn gar nichts geklappt hat - damit Cron/Monitoring anschlaegt.
  if (okCount === 0) {
    log.error('Keine einzige Kennzahl konnte aktualisiert werden.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  log.error(err.stack || err.message);
  process.exit(1);
});
