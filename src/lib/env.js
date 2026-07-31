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
  aiModel: process.env.AI_MODEL || 'claude-haiku-4-5',
  aiMaxTokens: num(process.env.AI_MAX_TOKENS, 8000),
  skipAi: process.env.SKIP_AI === '1',
  dbPath: abs(process.env.DB_PATH || './data/finance.db'),
  outputPath: abs(process.env.OUTPUT_PATH || './public/data/latest.json'),
  publicDir: abs(process.env.PUBLIC_DIR || './public'),
  historyDays: num(process.env.HISTORY_DAYS, 90),
  fetchDays: num(process.env.FETCH_DAYS, 180),
  port: num(process.env.PORT, 8080),
  host: process.env.HOST || '127.0.0.1',
};
