/**
 * API-Keys aus URLs entfernen, bevor sie in Logs oder Fehlermeldungen landen.
 *
 * Ohne das steht der Schluessel im Klartext in jeder Fehlerzeile - und damit
 * in der Konsole, in /var/log und in jedem Screenshot, den man jemandem
 * schickt, um ein Problem zu zeigen.
 */

const SECRET_PARAMS = new Set([
  'apikey',
  'api_key',
  'key',
  'token',
  'access_token',
  'access_key',
  'auth',
  'password',
]);

export function redactUrl(url) {
  try {
    const parsed = new URL(url);
    for (const name of [...parsed.searchParams.keys()]) {
      if (SECRET_PARAMS.has(name.toLowerCase())) parsed.searchParams.set(name, '***');
    }
    return parsed.toString();
  } catch {
    return String(url);
  }
}
