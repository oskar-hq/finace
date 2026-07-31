import fs from 'node:fs';
import path from 'node:path';

/**
 * Schreibt die JSON-Datei atomar (erst .tmp, dann rename). So sieht das
 * Frontend nie eine halb geschriebene Datei, selbst wenn jemand genau
 * waehrend des Cron-Laufs die Seite laedt.
 */
export function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}
