import fs from 'node:fs';
import path from 'node:path';

/**
 * Schreibt die JSON-Datei atomar (erst .tmp, dann rename). So sieht das
 * Frontend nie eine halb geschriebene Datei, selbst wenn jemand genau
 * waehrend des Cron-Laufs die Seite laedt.
 */
/** Vorherige Ausgabe lesen, oder null wenn es sie (noch) nicht gibt. */
export function readPreviousOutput(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}
