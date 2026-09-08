import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './env.js';

/**
 * SQLite-Zeitreihenspeicher.
 *
 * Nutzt node:sqlite (in Node >= 22.5 eingebaut) - damit hat das Projekt keine
 * nativen Abhaengigkeiten und laesst sich im LXC ohne Build-Toolchain betreiben.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS observations (
  metric_id  TEXT NOT NULL,
  obs_date   TEXT NOT NULL,           -- YYYY-MM-DD
  value      REAL NOT NULL,
  source     TEXT NOT NULL,           -- z.B. "fred:DGS10"
  variant    TEXT,                    -- welcher Index/Kontrakt genau
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (metric_id, obs_date)
);

CREATE INDEX IF NOT EXISTS idx_obs_metric_date ON observations (metric_id, obs_date DESC);

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  ok_count    INTEGER DEFAULT 0,
  fail_count  INTEGER DEFAULT 0,
  ai_status   TEXT,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS glossary_log (
  term    TEXT NOT NULL,
  used_on TEXT NOT NULL,
  PRIMARY KEY (term, used_on)
);
`;

export function openDb(dbPath = config.dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/**
 * Schreibt eine Zeitreihe. Vorhandene Tage werden aktualisiert (Kurse werden
 * nachtraeglich revidiert, gerade bei FRED).
 * @returns {number} Anzahl geschriebener Zeilen
 */
export function upsertSeries(db, metricId, series, { source, variant }) {
  const stmt = db.prepare(`
    INSERT INTO observations (metric_id, obs_date, value, source, variant, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (metric_id, obs_date) DO UPDATE SET
      value = excluded.value,
      source = excluded.source,
      variant = excluded.variant,
      fetched_at = excluded.fetched_at
  `);
  const now = new Date().toISOString();
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const point of series) {
      if (!point || !Number.isFinite(point.value) || !point.date) continue;
      stmt.run(
        metricId,
        point.date,
        point.value,
        point.source ?? source,
        point.variant ?? variant ?? null,
        now,
      );
      n++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return n;
}

/** Historie einer Kennzahl, aufsteigend nach Datum. */
export function readSeries(db, metricId, sinceDate = null) {
  const sql = sinceDate
    ? `SELECT obs_date AS date, value, source, variant FROM observations
       WHERE metric_id = ? AND obs_date >= ? ORDER BY obs_date ASC`
    : `SELECT obs_date AS date, value, source, variant FROM observations
       WHERE metric_id = ? ORDER BY obs_date ASC`;
  const stmt = db.prepare(sql);
  return sinceDate ? stmt.all(metricId, sinceDate) : stmt.all(metricId);
}

export function startRun(db) {
  const info = db
    .prepare('INSERT INTO runs (started_at) VALUES (?)')
    .run(new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function finishRun(db, runId, { okCount, failCount, aiStatus, note }) {
  db.prepare(
    `UPDATE runs SET finished_at = ?, ok_count = ?, fail_count = ?, ai_status = ?, note = ? WHERE id = ?`,
  ).run(new Date().toISOString(), okCount, failCount, aiStatus ?? null, note ?? null, runId);
}

/**
 * Wie oft ist der KI-Call heute schon fehlgeschlagen?
 *
 * Grundlage fuer das Nachholen in kurzen Laeufen (siehe src/update.js): ein
 * dauerhaft gestoerter Dienst soll nicht 96-mal am Tag angefragt werden.
 */
export function countFailedAiRuns(db, date) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM runs WHERE ai_status = 'error' AND started_at >= ?")
    .get(`${date}T00:00:00`).n;
}

/** Zuletzt verwendete Glossarbegriffe (neueste zuerst). */
export function recentGlossaryTerms(db, limit = 20) {
  return db
    .prepare('SELECT term FROM glossary_log ORDER BY used_on DESC LIMIT ?')
    .all(limit)
    .map((r) => r.term);
}

export function recordGlossaryTerm(db, term, date) {
  db.prepare('INSERT OR REPLACE INTO glossary_log (term, used_on) VALUES (?, ?)').run(term, date);
}
