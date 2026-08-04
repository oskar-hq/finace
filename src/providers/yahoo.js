import { fetchJson } from '../lib/http.js';
import { toIsoDate } from '../lib/dates.js';

/**
 * Yahoo Finance Chart-API - inoffiziell, kein Key, kann sich jederzeit aendern.
 *
 * Von Server-IPs antwortet Yahoo auf nackte Anfragen fast immer mit HTTP 429.
 * Der Grund ist nicht die Abfragerate, sondern die fehlende Sitzung: Yahoo
 * erwartet ein Consent-Cookie und einen dazu passenden "Crumb". Genau das baut
 * ensureSession() nach - erst Cookie holen, dann Crumb, dann die eigentliche
 * Abfrage mit beidem. Dieselbe Sitzung wird fuer alle Kennzahlen eines Laufs
 * wiederverwendet.
 *
 * Das ist ein Workaround fuer eine undokumentierte Schnittstelle und kann
 * jederzeit brechen - deshalb steht Yahoo nirgends an erster Stelle.
 *
 * Symbole: ^GDAXI, ^VIX, ^TNX, GC=F, BZ=F, DX-Y.NYB
 */
export const id = 'yahoo';
export const label = 'Yahoo Finance (inoffiziell)';
export const needsKey = false;

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SESSION_TTL_MS = 30 * 60 * 1000;
let session = null;

function readSetCookies(res) {
  // getSetCookie() gibt es ab Node 20; sonst der einzelne Header.
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

async function ensureSession() {
  if (session && Date.now() - session.at < SESSION_TTL_MS) return session;

  // 1. Cookie einsammeln. Die Seite antwortet mit 404 - das ist erwartet,
  //    entscheidend sind allein die Set-Cookie-Header.
  const jar = [];
  try {
    const res = await fetch('https://fc.yahoo.com/', {
      headers: { 'user-agent': UA, accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    for (const raw of readSetCookies(res)) jar.push(raw.split(';')[0]);
  } catch {
    // Ohne Cookie geht es oft trotzdem - unten wird es sich dann zeigen.
  }
  const cookie = jar.join('; ');

  // 2. Passenden Crumb zum Cookie holen.
  let crumb = '';
  const res = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'user-agent': UA, accept: 'text/plain,*/*', ...(cookie ? { cookie } : {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (res.ok) crumb = (await res.text()).trim();

  if (!crumb) {
    throw new Error(
      'Yahoo: konnte keine Sitzung aufbauen (kein Crumb) - Yahoo sperrt diese IP vermutlich',
    );
  }

  session = { cookie, crumb, at: Date.now() };
  return session;
}

export async function fetchSeries({ symbol }, { from, to }) {
  const { cookie, crumb } = await ensureSession();

  const p1 = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
  const p2 = Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${p1}&period2=${p2}&interval=1d&crumb=${encodeURIComponent(crumb)}`;

  let json;
  try {
    json = await fetchJson(url, {
      headers: {
        accept: 'application/json',
        'user-agent': UA,
        ...(cookie ? { cookie } : {}),
      },
    });
  } catch (err) {
    // Abgelaufene Sitzung: einmal neu aufbauen und erneut versuchen.
    session = null;
    if (!/429|401|403/.test(err.message)) throw err;
    const retry = await ensureSession();
    json = await fetchJson(
      `${url.replace(/crumb=[^&]*/, `crumb=${encodeURIComponent(retry.crumb)}`)}`,
      {
        headers: {
          accept: 'application/json',
          'user-agent': UA,
          ...(retry.cookie ? { cookie: retry.cookie } : {}),
        },
      },
    );
  }

  const err = json?.chart?.error;
  if (err) throw new Error(`Yahoo: ${err.code || 'Fehler'} - ${err.description || ''}`);

  const result = json?.chart?.result?.[0];
  const stamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(stamps) || !Array.isArray(closes)) {
    throw new Error(`Yahoo: keine Zeitreihe fuer "${symbol}"`);
  }

  const series = [];
  for (let i = 0; i < stamps.length; i++) {
    const value = closes[i];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    const date = toIsoDate(new Date(stamps[i] * 1000));
    if (date) series.push({ date, value });
  }
  return series;
}
