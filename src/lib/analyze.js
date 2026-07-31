import { CHANGE_WINDOWS } from '../../config/metrics.js';
import { shiftDays, daysBetween, today } from './dates.js';

/** Ab wie vielen Tagen ohne neuen Wert eine Kennzahl als "veraltet" gilt. */
const STALE_AFTER_DAYS = 5;

/**
 * Berechnet aus zwei Zeitreihen eine abgeleitete Reihe (z.B. Gold in EUR aus
 * Gold-USD und EUR/USD). Verknuepft wird nur ueber Tage, an denen beide
 * Reihen einen Wert haben - so entstehen keine erfundenen Zwischenwerte.
 */
export function deriveSeries(op, rowsA, rowsB) {
  const mapB = new Map(rowsB.map((p) => [p.date, p]));
  const out = [];
  for (const a of rowsA) {
    const b = mapB.get(a.date);
    if (!b || !Number.isFinite(b.value)) continue;

    let value;
    if (op === 'divide') {
      if (b.value === 0) continue;
      value = a.value / b.value;
    } else if (op === 'multiply') {
      value = a.value * b.value;
    } else {
      throw new Error(`Unbekannte Rechenart "${op}"`);
    }

    out.push({
      date: a.date,
      value,
      // Zusammengesetzte Quelle: wechselt eine der beiden Basisquellen,
      // wird die Reihe ab da als eigene Quelle behandelt und nicht mehr
      // ueber den Bruch hinweg verglichen.
      source: `${a.source ?? '?'}|${b.source ?? '?'}`,
      variant: [a.variant, b.variant].filter(Boolean).join(' / ') || null,
    });
  }
  return out;
}

/**
 * Veraenderung ueber n Kalendertage.
 *
 * Referenzpunkt ist der juengste Wert, der hoechstens (Stichtag - n Tage) alt
 * ist. Dadurch landet "1 Tag" an einem Montag korrekt auf dem Freitagswert.
 *
 * Wichtig: verglichen wird nur innerhalb derselben Quelle. Wenn heute Yahoo
 * (DXY) und vor 30 Tagen FRED (Fed-Index) geliefert hat, waeren die Werte
 * nicht vergleichbar - dann gibt es hier bewusst kein Ergebnis.
 */
export function changeOver(series, days) {
  if (series.length < 2) return null;
  const latest = series.at(-1);
  const target = shiftDays(latest.date, -days);

  let ref = null;
  for (let i = series.length - 2; i >= 0; i--) {
    if (series[i].date <= target) {
      ref = series[i];
      break;
    }
  }
  if (!ref || !Number.isFinite(ref.value) || ref.value === 0) return null;

  return {
    abs: latest.value - ref.value,
    pct: ((latest.value - ref.value) / Math.abs(ref.value)) * 100,
    from_date: ref.date,
    from_value: ref.value,
  };
}

/**
 * Baut die Frontend-Darstellung einer Kennzahl aus ihrer Historie.
 * @param {object} metric  Eintrag aus config/metrics.js
 * @param {Array}  series  aufsteigend sortiert, Elemente {date, value, source?, variant?}
 * @param {{ historyDays: number, asOfToday?: string }} opts
 */
export function buildSnapshot(metric, series, opts = {}) {
  const historyDays = opts.historyDays ?? 90;
  const now = opts.asOfToday ?? today();

  const base = {
    id: metric.id,
    label: metric.label,
    group: metric.group,
    blurb: metric.blurb ?? null,
    format: metric.format ?? { style: 'decimal', digits: 2 },
  };

  if (!series || series.length === 0) {
    return { ...base, status: 'unavailable', value: null, changes: {}, history: [] };
  }

  const latest = series.at(-1);
  // Nur Werte derselben Quelle sind untereinander vergleichbar.
  const comparable = latest.source
    ? series.filter((p) => p.source === latest.source)
    : series;

  const changes = {};
  for (const win of CHANGE_WINDOWS) {
    const change = changeOver(comparable, win.days);
    changes[win.key] = change ? { ...change, label: win.label, days: win.days } : null;
  }

  const ageDays = daysBetween(latest.date, now);
  const historyStart = shiftDays(latest.date, -historyDays);

  return {
    ...base,
    status: ageDays > STALE_AFTER_DAYS ? 'stale' : 'ok',
    value: latest.value,
    as_of: latest.date,
    age_days: ageDays,
    source: latest.source ?? null,
    variant: latest.variant ?? null,
    changes,
    history: series
      .filter((p) => p.date >= historyStart)
      .map((p) => ({ d: p.date, v: Number(p.value.toFixed(6)) })),
  };
}
