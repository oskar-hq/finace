import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Minimaler .env-Loader (KEY=VALUE, # als Kommentar).
 * Bereits gesetzte Umgebungsvariablen gewinnen - so kann man einzelne Werte
 * beim Cron-Aufruf ueberschreiben, ohne die Datei anzufassen.
 */
export function loadEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  fredApiKey: process.env.FRED_API_KEY || '',
  twelveDataApiKey: process.env.TWELVEDATA_API_KEY || '',
  alphaVantageApiKey: process.env.ALPHAVANTAGE_API_KEY || '',
  // Google liest beide Namen; sind beide gesetzt, hat laut Googles Doku
  // GOOGLE_API_KEY Vorrang.
  geminiApiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
  // 'auto' nimmt den ersten Anbieter, fuer den ein Key hinterlegt ist -
  // Reihenfolge siehe src/ai/explain.js. 'gemini' oder 'anthropic' erzwingen.
  aiProvider: process.env.AI_PROVIDER || 'auto',
  aiModel: process.env.AI_MODEL || 'claude-haiku-4-5',
  // Leer = Standardmodell des Providers samt Ausweichkette bei Ueberlastung
  // (siehe src/ai/providers/gemini.js).
  geminiModel: process.env.GEMINI_MODEL || '',
  aiMaxTokens: num(process.env.AI_MAX_TOKENS, 8000),
  // Wie oft ein Tag hoechstens einen fehlgeschlagenen KI-Call nachholen darf.
  aiMaxAttempts: num(process.env.AI_MAX_ATTEMPTS, 6),
  skipAi: process.env.SKIP_AI === '1',
  dbPath: abs(process.env.DB_PATH || './data/finance.db'),
  outputPath: abs(process.env.OUTPUT_PATH || './public/data/latest.json'),
  publicDir: abs(process.env.PUBLIC_DIR || './public'),
  historyDays: num(process.env.HISTORY_DAYS, 90),
  fetchDays: num(process.env.FETCH_DAYS, 180),
  // Kurzer Zeitraum fuer haeufige Laeufe (npm run update:quick), damit ein
  // 15-Minuten-Takt die Tageskontingente der Anbieter nicht aufbraucht.
  quickFetchDays: num(process.env.QUICK_FETCH_DAYS, 10),
  port: num(process.env.PORT, 8080),
  host: process.env.HOST || '127.0.0.1',
};
