'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Start local static server. Serves the web UI, /data (analysis JSON) and
// /api/file?path= for reading source files. Local-only binding.
function startServer(rootDir, payload, model, opts = {}) {
  const webDir = path.join(__dirname, '..', 'web');
  const port = opts.port || 8787;
  const host = opts.host || '127.0.0.1';

  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/data') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(payload);
      return;
    }
    if (url.startsWith('/api/file')) {
      const q = new URL(req.url, 'http://x').searchParams;
      const rel = q.get('path') || '';
      const full = path.resolve(rootDir, rel);
      if (!full.startsWith(path.resolve(rootDir))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      try {
        const content = fs.readFileSync(full, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }
    if (url === '/' || url === '') url === '' ? null : null;
    let filePath = url === '/' ? path.join(webDir, 'index.html') : path.join(webDir, url);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(webDir, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      resolve(`http://${host}:${port}`);
    });
  });
}

module.exports = { startServer };
