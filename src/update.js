/**
 * Generator-Skript - Einstiegspunkt fuer den taeglichen Cron-Lauf.
 *
 *   npm run update            voller Lauf (lange Historie + KI, falls Key da)
 *   npm run update:no-ai      voller Lauf, ohne KI
 *   npm run update:quick      kurzer Lauf fuer haeufige Takte (z.B. alle 15 min)
 *
 * Ablauf: Marktdaten holen -> in SQLite speichern -> Veraenderungen berechnen
 *         -> ein Anthropic-Call fuer alle Erklaerungen -> public/data/latest.json
 *
 * --quick holt nur wenige Tage (QUICK_FETCH_DAYS) und laesst die KI aus. Die
 * Historie bleibt trotzdem vollstaendig, weil sie in der Datenbank steht - der
 * kurze Lauf frischt nur die juengsten Tage auf. Damit bleibt ein
 * 15-Minuten-Takt innerhalb der Tageskontingente der Anbieter.
 */

import { METRICS, CHANGE_WINDOWS } from '../config/metrics.js';
import { config } from './lib/env.js';
import { log } from './lib/log.js';
import {
  openDb,
  upsertSeries,
  readSeries,
  startRun,
  finishRun,
  countFailedAiRuns,
} from './lib/db.js';
import { collectMetric } from './providers/index.js';
import { buildSnapshot, deriveSeries } from './lib/analyze.js';
import { writeJsonAtomic, readPreviousOutput } from './lib/output.js';
import { generateExplanations } from './ai/explain.js';
import { chooseGlossaryTerm, markGlossaryTermUsed } from './ai/glossary.js';
import { today, shiftDays } from './lib/dates.js';

const noAiFlag = process.argv.includes('--no-ai');
const quickFlag = process.argv.includes('--quick');

async function main() {
  const startedAt = new Date();
  const runDate = today();
  const days = quickFlag ? config.quickFetchDays : config.fetchDays;
  const range = { from: shiftDays(runDate, -days), to: runDate };

  log.info(
    `Lauf gestartet (${quickFlag ? 'quick' : 'voll'}) - Zeitraum ${range.from} bis ${range.to}`,
  );
  if (noAiFlag) log.info('KI-Erklaerungen abgeschaltet (--no-ai)');
  if (config.skipAi) log.info('KI-Erklaerungen abgeschaltet (SKIP_AI=1)');
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
  // Ein kurzer Lauf ruft die KI normalerweise nicht auf, sondern reicht die
  // Texte des Volllaufs weiter. Ausnahme: fuer heute gibt es noch keine. Dann
  // holt er den Call nach, statt das Dashboard bis zum naechsten Morgen ohne
  // Texte zu lassen - der Morgenlauf faellt z.B. aus, wenn der Anbieter gerade
  // ueberlastet ist. Sobald ein Versuch klappt, ist wieder Ruhe.
  const previous = readPreviousOutput(config.outputPath);
  const hasTodaysTexts = previous?.data_date === runDate && Boolean(previous.ai?.summary);

  if (quickFlag && !config.skipAi) {
    const failedToday = countFailedAiRuns(db, runDate);
    if (hasTodaysTexts) {
      log.info('Texte von heute liegen vor - kurzer Lauf reicht sie weiter, ohne KI-Call');
      config.skipAi = true;
    } else if (failedToday >= config.aiMaxAttempts) {
      // Deckel gegen einen dauerhaft gestoerten Dienst: sonst unternaehmen die
      // 96 kurzen Laeufe eines Tages auch 96 Anlaeufe - bei Gemini waere das
      // Tageskontingent des kostenlosen Tarifs danach fuer nichts verbraucht.
      log.info(
        `KI heute schon ${failedToday}x fehlgeschlagen (AI_MAX_ATTEMPTS=${config.aiMaxAttempts}) - ` +
          'kein weiterer Versuch bis morgen',
      );
      config.skipAi = true;
    } else {
      log.info(`Noch keine Texte fuer heute - kurzer Lauf holt den KI-Call nach (Versuch ${failedToday + 1})`);
    }
  }

  let glossaryTerm = chooseGlossaryTerm(db);
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

  // Ohne Erklaerung bleibt das Feld ganz weg - das Frontend soll keinen
  // leeren Kasten rendern muessen.
  for (const snap of snapshots) {
    const text = ai.explanations.get(snap.id);
    if (text) snap.explanation = text;
  }

  // Der Begriff des Tages gilt erst als verbraucht, wenn er auch erklaert
  // wurde. Sonst wandert die Rotation bei jedem Lauf ohne Key weiter.
  let hasGlossaryText = Boolean(glossaryTerm && ai.glossary);
  if (hasGlossaryText) markGlossaryTermUsed(db, glossaryTerm, runDate);

  // Texte des heutigen Tages uebernehmen, wenn dieser Lauf keine erzeugt hat.
  // Ohne das wuerde jeder 15-Minuten-Lauf die Erklaerungen vom Morgen loeschen.
  // Bewusst nur fuer denselben Kalendertag: eine Einschaetzung von gestern
  // wuerde zu den heutigen Zahlen nicht mehr passen.
  let reusedTexts = null;
  if (ai.status !== 'ok') {
    if (hasTodaysTexts) {
      reusedTexts = previous;
      const previousById = new Map((previous.metrics ?? []).map((m) => [m.id, m]));
      for (const snap of snapshots) {
        const text = previousById.get(snap.id)?.explanation;
        // Kein Text zu einer Kennzahl, die gerade gar keinen Wert hat.
        if (text && !snap.explanation && snap.status !== 'unavailable') snap.explanation = text;
      }
      if (previous.glossary?.text) {
        glossaryTerm = previous.glossary.term;
        ai.glossary = previous.glossary.text;
        hasGlossaryText = true;
      }
      ai.summary = previous.ai.summary;
      log.info(`Erklaerungen vom Lauf um ${previous.generated_at} uebernommen`);
    }
  }

  // --- 5. Ausgabe ----------------------------------------------------------
  const payload = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    data_date: runDate,
    windows: CHANGE_WINDOWS,
    ai: {
      // "reused" = dieser Lauf hat keine Texte erzeugt, zeigt aber die vom
      // heutigen Volllauf weiter.
      status: reusedTexts ? 'reused' : ai.status,
      // Modell und Anbieter kommen aus dem Lauf selbst - nicht aus der
      // Konfiguration, sonst stuende bei einem Gemini-Lauf der Claude-Name da.
      model: ai.status === 'ok' ? ai.model : (reusedTexts?.ai?.model ?? null),
      provider: ai.status === 'ok' ? ai.provider : (reusedTexts?.ai?.provider ?? null),
      generated_at: reusedTexts ? reusedTexts.generated_at : null,
      error: ai.error,
      usage: ai.usage,
      summary: ai.summary,
      // Der Hinweis gehoert nur dorthin, wo es auch KI-Texte gibt.
      disclaimer:
        ai.status === 'ok' || reusedTexts
          ? 'Die Erklaerungen sind KI-generiert und beruhen ausschliesslich auf den angezeigten ' +
            'Zahlen sowie allgemeinen Marktzusammenhaengen - nicht auf aktuellen Nachrichten. ' +
            'Keine Anlageberatung.'
          : null,
    },
    glossary: hasGlossaryText ? { term: glossaryTerm, text: ai.glossary } : null,
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
