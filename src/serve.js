/**
 * Minimaler statischer Server:  npm run serve
 *
 * Liefert ausschliesslich den Ordner public/ aus - kein Framework, keine
 * Abhaengigkeit. Reicht fuer den LXC hinter einem Cloudflare Tunnel.
 *
 * Wer lieber nginx oder Caddy nutzt: einfach public/ als Document-Root setzen,
 * dieser Server wird dann nicht gebraucht.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './lib/env.js';
import { log } from './lib/log.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const ROOT_DIR = fs.realpathSync(config.publicDir);

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }

  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const target = path.resolve(ROOT_DIR, relative);

  // Pfad-Traversal blocken: alles muss unterhalb von public/ liegen.
  if (target !== ROOT_DIR && !target.startsWith(ROOT_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(target, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(
        relative === 'data/latest.json'
          ? 'Noch keine Daten. Erst "npm run update" (oder "npm run demo") ausfuehren.'
          : 'Not Found',
      );
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      // Die JSON-Datei aendert sich taeglich und darf nicht im Browser haengen bleiben.
      'cache-control': ext === '.json' ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
});

server.listen(config.port, config.host, () => {
  log.info(`Dashboard laeuft auf http://${config.host}:${config.port}  (Ordner: ${ROOT_DIR})`);
});
