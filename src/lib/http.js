/** HTTP-Helfer mit Timeout und Retry - bewusst ohne externe Abhaengigkeit. */

import { redactUrl } from './redact.js';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0 Safari/537.36 finance-dashboard/1.0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, retries?: number, headers?: Record<string,string> }} opts
 * @returns {Promise<string>} Response-Body als Text
 */
export async function fetchText(url, opts = {}) {
  const { timeoutMs = 15000, retries = 2, headers = {} } = opts;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: '*/*', ...headers },
      });
      const body = await res.text();
      if (!res.ok) {
        // 4xx sind in aller Regel dauerhaft - nicht weiter probieren.
        const err = new Error(`HTTP ${res.status} ${res.statusText}`);
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw Object.assign(err, { fatal: true });
        throw err;
      }
      return body;
    } catch (err) {
      lastErr = err.name === 'AbortError' ? new Error(`Timeout nach ${timeoutMs} ms`) : err;
      if (lastErr.fatal) break;
    } finally {
      clearTimeout(timer);
    }
  }
  // Niemals die rohe URL - sie kann einen API-Key als Query-Parameter tragen.
  throw new Error(`${lastErr.message} (${redactUrl(url)})`);
}

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Antwort ist kein gueltiges JSON (${redactUrl(url)})`);
  }
}
