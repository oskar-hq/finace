/**
 * Frontend. Liest ausschliesslich die vorbereitete JSON-Datei -
 * keine API-Aufrufe, keine Secrets, kein Build-Schritt.
 */

const DATA_URL = './data/latest.json';

/* --- Formatierung --------------------------------------------------------- */

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const numberCache = new Map();
function numberFormat(options) {
  const key = JSON.stringify(options);
  if (!numberCache.has(key)) numberCache.set(key, new Intl.NumberFormat('de-DE', options));
  return numberCache.get(key);
}

function formatValue(value, format = {}) {
  if (!Number.isFinite(value)) return '–';
  const digits = format.digits ?? 2;
  if (format.style === 'currency') {
    return numberFormat({
      style: 'currency',
      currency: format.currency ?? 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }
  const text = numberFormat({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  return `${text}${format.suffix ?? ''}`;
}

function formatPercent(pct) {
  const text = numberFormat({
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  }).format(pct);
  return `${text} %`;
}

function formatDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

/** Richtung fuer die Farbgebung. Die Zahl mit Vorzeichen steht immer daneben,
 *  die Farbe traegt die Aussage also nie allein. */
function direction(pct) {
  const rounded = Math.round(pct * 100) / 100;
  if (rounded > 0) return 'up';
  if (rounded < 0) return 'down';
  return 'flat';
}

/* --- kleine DOM-Helfer ---------------------------------------------------- */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/* --- Sparkline ------------------------------------------------------------ */

/**
 * Eine Reihe, 2px Linie, kein Gitter, keine Achsen - nur der Verlauf.
 * Der Zeichenbereich ist 0..100 in beiden Richtungen und wird per
 * preserveAspectRatio="none" auf die Kartenbreite gezogen;
 * vector-effect="non-scaling-stroke" haelt dabei alle Strichstaerken konstant.
 * Beim Ueberfahren (Maus oder Finger) zeigt die Bildunterschrift den Wert.
 */
function buildSparkline(metric) {
  const points = metric.history ?? [];
  const caption = el('p', { class: 'spark-caption' });

  if (points.length < 2) {
    caption.textContent = 'Zu wenig Historie fuer einen Verlauf.';
    return { svg: null, caption };
  }

  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 8; // Rand oben/unten, damit die Linie nicht am Rahmen klebt
  const x = (i) => (i / (points.length - 1)) * 100;
  const y = (v) => 100 - pad - ((v - min) / span) * (100 - 2 * pad);

  const svg = svgEl('svg', {
    class: 'spark',
    viewBox: '0 0 100 100',
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label':
      `Verlauf ${metric.label}, ${points.length} Werte von ${formatDate(points[0].d)} ` +
      `bis ${formatDate(points.at(-1).d)}. Tiefstwert ${formatValue(min, metric.format)}, ` +
      `Hoechstwert ${formatValue(max, metric.format)}. Werte in der Tabelle unter der Karte.`,
  });

  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(3)} ${y(p.v).toFixed(3)}`).join(' ');
  svg.append(svgEl('path', { class: 'spark-line', d, 'vector-effect': 'non-scaling-stroke' }));

  const crosshair = svgEl('line', {
    class: 'spark-crosshair',
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 100,
    'vector-effect': 'non-scaling-stroke',
    opacity: 0,
  });
  svg.append(crosshair);

  // Endpunkt: Null-Laengen-Pfad mit runder Kappe = exakt runder Punkt,
  // unabhaengig von der horizontalen Streckung. Erst der Ring in
  // Flaechenfarbe, dann der Punkt - so bleibt er vor der Linie sichtbar.
  const last = points.at(-1);
  const dot = `M${x(points.length - 1).toFixed(3)} ${y(last.v).toFixed(3)} l0 0`;
  svg.append(
    svgEl('path', {
      d: dot,
      stroke: 'var(--surface-raised)',
      'stroke-width': 12,
      'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke',
    }),
  );
  svg.append(
    svgEl('path', {
      d: dot,
      stroke: 'var(--series)',
      'stroke-width': 8,
      'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke',
    }),
  );

  svg.append(svgEl('rect', { class: 'spark-hit', x: 0, y: 0, width: 100, height: 100 }));

  const defaultCaption = `${points.length} Werte seit ${formatDate(points[0].d)}`;
  caption.textContent = defaultCaption;

  const showAt = (clientX) => {
    const box = svg.getBoundingClientRect();
    if (box.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    const i = Math.round(ratio * (points.length - 1));
    const p = points[i];
    crosshair.setAttribute('x1', x(i).toFixed(3));
    crosshair.setAttribute('x2', x(i).toFixed(3));
    crosshair.setAttribute('opacity', '1');
    caption.textContent = `${formatDate(p.d)} · ${formatValue(p.v, metric.format)}`;
  };
  const reset = () => {
    crosshair.setAttribute('opacity', '0');
    caption.textContent = defaultCaption;
  };

  svg.addEventListener('pointermove', (e) => showAt(e.clientX));
  svg.addEventListener('pointerdown', (e) => showAt(e.clientX));
  svg.addEventListener('pointerleave', reset);
  svg.addEventListener('pointercancel', reset);

  return { svg, caption };
}

/* --- Karten --------------------------------------------------------------- */

function buildChanges(metric, windows) {
  const box = el('div', { class: 'changes' });

  for (const win of windows) {
    const change = metric.changes?.[win.key];
    const row = el('span', { class: 'change' });
    row.append(el('span', { class: 'change-label', text: win.label }));

    if (!change) {
      row.append(
        el('span', {
          class: 'change-value',
          'data-dir': 'none',
          text: '–',
          title: 'Kein vergleichbarer Wert in diesem Zeitraum',
        }),
      );
    } else {
      row.append(
        el('span', {
          class: 'change-value',
          'data-dir': direction(change.pct),
          text: formatPercent(change.pct),
          title: `${formatValue(change.abs, metric.format)} seit ${formatDate(change.from_date)}`,
        }),
      );
    }
    box.append(row);
  }
  return box;
}

function buildTableView(metric) {
  const points = (metric.history ?? []).slice(-14).reverse();
  if (points.length === 0) return null;

  const rows = points.map((p) =>
    el('tr', {}, [
      el('td', { text: formatDate(p.d) }),
      el('td', { text: formatValue(p.v, metric.format) }),
    ]),
  );

  return el('details', { class: 'table-view' }, [
    el('summary', { text: 'Letzte Werte als Tabelle' }),
    el('table', {}, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Datum' }), el('th', { text: 'Wert' })])]),
      el('tbody', {}, rows),
    ]),
  ]);
}

function buildCard(metric, windows) {
  const unavailable = metric.status === 'unavailable';
  const card = el('article', { class: `card${unavailable ? ' is-unavailable' : ''}` });

  card.append(
    el('div', { class: 'card-head' }, [
      el('h3', { text: metric.label }),
      metric.blurb ? el('p', { class: 'card-blurb', text: metric.blurb }) : null,
    ]),
  );

  card.append(
    unavailable
      ? el('div', { class: 'card-value is-empty', text: 'Daten aktuell nicht verfuegbar' })
      : el('div', { class: 'card-value', text: formatValue(metric.value, metric.format) }),
  );

  if (!unavailable) {
    card.append(buildChanges(metric, windows));
    const { svg, caption } = buildSparkline(metric);
    if (svg) card.append(svg);
    card.append(caption);
  }

  // Bei "nicht verfuegbar" steht der Hinweis schon als Wert - nicht doppeln.
  if (metric.note && !unavailable) card.append(el('p', { class: 'card-note', text: metric.note }));
  if (metric.explanation) card.append(el('p', { class: 'explanation', text: metric.explanation }));

  const footParts = [];
  if (metric.as_of) footParts.push(`Stand ${formatDate(metric.as_of)}`);
  if (metric.variant) footParts.push(metric.variant);
  else if (metric.source) footParts.push(metric.source);

  const foot = el('div', { class: 'card-foot' });
  if (footParts.length > 0) foot.append(el('div', { text: footParts.join(' · ') }));
  const table = unavailable ? null : buildTableView(metric);
  if (table) foot.append(table);
  if (foot.childNodes.length > 0) card.append(foot);

  return card;
}

/* --- Seite zusammenbauen --------------------------------------------------- */

function showStatus(message) {
  const box = document.getElementById('status');
  box.textContent = message;
  box.hidden = false;
}

function render(data) {
  const windows = data.windows ?? [
    { key: 'd1', label: '1 Tag' },
    { key: 'd5', label: '5 Tage' },
    { key: 'd30', label: '30 Tage' },
  ];

  const generated = new Date(data.generated_at);
  const metaParts = [`Stand ${dateTimeFmt.format(generated)} Uhr`];
  if (data.demo) metaParts.push('DEMO-DATEN – nicht echt');
  document.getElementById('header-meta').textContent = metaParts.join(' · ');

  // Hinweise, wenn etwas nicht rund gelaufen ist.
  const ageHours = (Date.now() - generated.getTime()) / 3600000;
  const problems = [];
  if (ageHours > 30) {
    problems.push(
      `Die Daten sind ${Math.floor(ageHours / 24)} Tage alt – laeuft der taegliche Cronjob noch?`,
    );
  }
  if (data.ai?.status === 'error') {
    problems.push(`Die Erklaerungen fehlen heute (${data.ai.error ?? 'unbekannter Fehler'}).`);
  } else if (data.ai?.status === 'skipped' && !data.demo) {
    problems.push('Die Erklaerungen wurden uebersprungen (kein API-Key oder SKIP_AI=1).');
  }
  const failed = (data.metrics ?? []).filter((m) => m.status === 'unavailable');
  if (failed.length > 0) {
    problems.push(`Ohne Daten: ${failed.map((m) => m.label).join(', ')}.`);
  }
  if (problems.length > 0) showStatus(problems.join(' '));

  if (data.ai?.summary) {
    document.getElementById('summary-text').textContent = data.ai.summary;
    document.getElementById('summary').hidden = false;
  }

  // Karten nach Gruppen aus der Konfiguration.
  const groups = new Map();
  for (const metric of data.metrics ?? []) {
    const name = metric.group ?? 'Kennzahlen';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(metric);
  }

  const container = document.getElementById('groups');
  container.replaceChildren();
  for (const [name, metrics] of groups) {
    const cards = el('div', { class: 'cards' });
    for (const metric of metrics) cards.append(buildCard(metric, windows));
    container.append(el('section', { class: 'group' }, [el('h2', { class: 'group-title', text: name }), cards]));
  }

  if (data.glossary?.term) {
    document.getElementById('glossary-title').textContent = data.glossary.term;
    document.getElementById('glossary-text').textContent =
      data.glossary.text ?? 'Fuer diesen Begriff liegt heute keine Erklaerung vor.';
    document.getElementById('glossary').hidden = false;
  }

  document.getElementById('disclaimer').textContent = data.ai?.disclaimer ?? '';
}

/* --- Design-Umschalter ----------------------------------------------------- */

function initThemeToggle() {
  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.dataset.theme = stored;
  }
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const current = document.documentElement.dataset.theme || (prefersDark ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  });
}

/* --- Start ---------------------------------------------------------------- */

initThemeToggle();

fetch(DATA_URL, { cache: 'no-cache' })
  .then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then(render)
  .catch((err) => {
    document.getElementById('header-meta').textContent = 'Keine Daten geladen';
    showStatus(
      `Die Datei data/latest.json konnte nicht geladen werden (${err.message}). ` +
        'Zuerst "npm run update" ausfuehren – oder "npm run demo" fuer Beispieldaten.',
    );
  });
