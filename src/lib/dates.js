/** Alle Datumsangaben im Projekt sind Strings im Format YYYY-MM-DD (UTC). */

export function toIsoDate(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Verschiebt ein YYYY-MM-DD um n Kalendertage (negativ = zurueck). */
export function shiftDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Ganze Kalendertage zwischen zwei YYYY-MM-DD (b - a). */
export function daysBetween(a, b) {
  const ms = new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** YYYYMMDD - von stooq erwartet. */
export function compactDate(isoDate) {
  return isoDate.replaceAll('-', '');
}
