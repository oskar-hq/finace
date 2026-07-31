import { CHANGE_WINDOWS } from '../../config/metrics.js';

export const SYSTEM_PROMPT = `Du bist ein nuechterner Finanzjournalist und erklaerst einem interessierten Einsteiger ein persoenliches Markt-Dashboard auf Deutsch.

Fuer JEDE Kennzahl schreibst du 2 bis 4 Saetze, die genau drei Dinge leisten:
1. Was ist passiert (die Bewegung in Worten, mit Bezug auf die genannten Zahlen).
2. Der wahrscheinliche Mechanismus dahinter - also warum so eine Bewegung typischerweise zustande kommt.
3. Was diese Kennzahl grundsaetzlich aussagt, damit der Leser dazulernt.

Absolut verbindliche Regeln:
- Du hast KEINEN Zugriff auf aktuelle Nachrichten und kennst die Ereignisse dieser Woche nicht. Erfinde deshalb NIEMALS konkrete Ausloeser (keine erfundenen Notenbanksitzungen, Konjunkturdaten, Kriege, Unternehmensmeldungen, Zitate oder Termine).
- Trenne sauber zwischen Gesichertem und Vermutung. Gesichert sind nur die dir uebergebenen Zahlen und allgemeine oekonomische Zusammenhaenge. Alles andere formulierst du als Moeglichkeit: "typischerweise steckt dahinter ...", "das passt zu einem Umfeld, in dem ...", "koennte damit zusammenhaengen, dass ...".
- Wenn eine Bewegung klein ist (unter etwa 0,5 Prozent), nenne sie beim Namen: Seitwaertsbewegung, Marktrauschen - und suche keine Erklaerung dafuer.
- Nutze die anderen Kennzahlen des Tages, wenn sie zusammenpassen (z.B. Dollar und Gold, Oel und Zinsen). Behaupte aber keine Kausalitaet, wo nur Gleichlauf zu sehen ist.
- Klar, konkret, keine Floskeln, keine Anlageberatung, keine Kauf- oder Verkaufsempfehlungen, keine Prognosen ueber kuenftige Kurse.
- Deutsch, Sie-Form vermeiden - schreibe sachlich ohne direkte Anrede. Zahlen im deutschen Format (Komma als Dezimaltrennzeichen).
- Keine Ueberschriften, keine Aufzaehlungszeichen, kein Markdown - reiner Fliesstext.`;

const nf = (digits) =>
  new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function formatValue(value, format) {
  if (!Number.isFinite(value)) return 'n/a';
  const digits = format?.digits ?? 2;
  const text = nf(digits).format(value);
  if (format?.style === 'currency') {
    return `${text} ${format.currency === 'EUR' ? 'EUR' : format.currency ?? 'USD'}`;
  }
  return `${text}${format?.suffix ?? ''}`;
}

function formatChanges(snapshot) {
  const parts = [];
  for (const win of CHANGE_WINDOWS) {
    const c = snapshot.changes?.[win.key];
    if (!c) {
      parts.push(`${win.label}: keine Vergleichsdaten`);
      continue;
    }
    const sign = c.pct >= 0 ? '+' : '';
    parts.push(
      `${win.label}: ${sign}${nf(2).format(c.pct)} % ` +
        `(${sign}${nf(snapshot.format?.digits ?? 2).format(c.abs)}, seit ${c.from_date})`,
    );
  }
  return parts.join('; ');
}

/**
 * Baut den User-Prompt: alle Kennzahlen in einem Call, damit pro Tag genau
 * eine Anfrage an die API geht.
 */
export function buildUserPrompt(snapshots, metricsById, glossaryTerm, dateLabel) {
  const lines = [
    `Datum des Dashboards: ${dateLabel}.`,
    '',
    'Kennzahlen (nur diese Zahlen sind gesichert):',
    '',
  ];

  for (const snap of snapshots) {
    const metric = metricsById.get(snap.id);
    lines.push(`[${snap.id}] ${snap.label}`);
    if (snap.status === 'unavailable') {
      lines.push('  Status: Daten heute nicht verfuegbar.');
      lines.push('  -> Schreibe hier KEINE Marktanalyse, sondern nur 2 Saetze dazu, was diese');
      lines.push('     Kennzahl grundsaetzlich aussagt und warum sie fuer das Gesamtbild wichtig ist.');
    } else {
      lines.push(`  Aktueller Wert: ${formatValue(snap.value, snap.format)} (Stand ${snap.as_of})`);
      lines.push(`  Veraenderung: ${formatChanges(snap)}`);
      if (snap.variant) lines.push(`  Datenbasis: ${snap.variant}`);
      if (snap.status === 'stale') {
        lines.push(`  Hinweis: Der Wert ist ${snap.age_days} Tage alt (evtl. Feiertage/Quellenverzug).`);
      }
    }
    if (metric?.aiHint) lines.push(`  Fachlicher Kontext: ${metric.aiHint}`);
    lines.push('');
  }

  lines.push(
    'Aufgaben:',
    '1. Schreibe zu jeder Kennzahl oben eine Erklaerung (2-4 Saetze) nach den Systemregeln.',
    '2. Schreibe eine Gesamteinschaetzung ("summary") von 3-5 Saetzen: Welches Bild ergeben die',
    '   Kennzahlen zusammen? Welche Zusammenhaenge sind heute sichtbar (Zinsen, Inflation,',
    '   Waehrung, Risikoneigung)? Auch hier: keine erfundenen Ereignisse, keine Prognosen.',
    `3. Erklaere den Begriff des Tages: "${glossaryTerm}". 3-5 Saetze, verstaendlich fuer einen`,
    '   Einsteiger, gern mit einem Bezug zu den Kennzahlen oben. Feld "glossary".',
  );

  return lines.join('\n');
}

export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Gesamteinschaetzung, 3-5 Saetze, deutsch.' },
    glossary: { type: 'string', description: 'Erklaerung des Begriffs des Tages, 3-5 Saetze.' },
    metrics: {
      type: 'array',
      description: 'Genau ein Eintrag je uebergebener Kennzahl.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Die id in eckigen Klammern aus dem Prompt.' },
          text: { type: 'string', description: 'Erklaerung, 2-4 Saetze, deutscher Fliesstext.' },
        },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'glossary', 'metrics'],
  additionalProperties: false,
};
