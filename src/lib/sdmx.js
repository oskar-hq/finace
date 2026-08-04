/**
 * Toleranter Parser fuer SDMX-CSV, wie ihn EZB und Bundesbank ausliefern.
 *
 * Beide Portale liefern grundsaetzlich Spalten TIME_PERIOD und OBS_VALUE,
 * unterscheiden sich aber im Trennzeichen und in der Anzahl der Kopfzeilen.
 * Deshalb erst der saubere Weg ueber die Kopfzeile, danach ein Notnagel, der
 * einfach jede Zeile "Datum, Zahl" einsammelt.
 */

function splitLine(line, delimiter) {
  // Reicht fuer diese Portale: Werte enthalten keine eingebetteten Trenner.
  return line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''));
}

export function parseSdmxCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error('leere Antwort');

  // 1. Kopfzeile mit TIME_PERIOD / OBS_VALUE suchen.
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    for (const delimiter of [',', ';']) {
      const header = splitLine(lines[i], delimiter).map((c) => c.toUpperCase());
      const iDate = header.indexOf('TIME_PERIOD');
      const iValue = header.indexOf('OBS_VALUE');
      if (iDate < 0 || iValue < 0) continue;

      const series = [];
      for (const line of lines.slice(i + 1)) {
        const cols = splitLine(line, delimiter);
        const date = normalizeDate(cols[iDate]);
        const value = parseNumber(cols[iValue]);
        if (date && value !== null) series.push({ date, value });
      }
      if (series.length > 0) return series;
    }
  }

  // 2. Notnagel: jede Zeile, die mit einem Datum beginnt und eine Zahl enthaelt.
  const series = [];
  for (const line of lines) {
    const match = line.match(/^"?(\d{4}-\d{2}(?:-\d{2})?)"?\s*[;,]\s*"?(-?[\d.,]+)"?/);
    if (!match) continue;
    const date = normalizeDate(match[1]);
    const value = parseNumber(match[2]);
    if (date && value !== null) series.push({ date, value });
  }
  if (series.length === 0) throw new Error('keine Datenzeilen erkannt');
  return series;
}

/** Monatswerte (YYYY-MM) werden auf den Monatsersten gelegt. */
function normalizeDate(raw) {
  if (!raw) return null;
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  return null;
}

function parseNumber(raw) {
  if (raw === undefined || raw === null) return null;
  let value = String(raw).trim();
  if (value === '' || value === '.' || value === 'NaN' || /^na$/i.test(value)) return null;
  // Deutsche Schreibweise "3,21" bzw. "1.234,56" abfangen.
  if (/,\d{1,6}$/.test(value)) value = value.replace(/\./g, '').replace(',', '.');
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
