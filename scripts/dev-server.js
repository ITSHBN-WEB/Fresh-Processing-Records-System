/**
 * Local test server - runs the real frontend and API on your PC against your
 * Neon database, so you can test BEFORE pushing and avoid wasting Vercel deployments.
 *
 *   1. Copy .env.example to .env and fill it in
 *   2. npm run dev
 *   3. open http://localhost:3000
 */
import http from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const port = Number(process.env.PORT) || 3000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const handlers = {};
for (const f of readdirSync(join(root, 'api')).filter((f) => f.endsWith('.js'))) {
  handlers[f.slice(0, -3)] = (await import(pathToFileURL(join(root, 'api', f)).href)).default;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/api/')) {
    const h = handlers[u.pathname.slice(5)];
    if (!h) { res.statusCode = 404; return res.end('{"ok":false,"error":"Not found"}'); }
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    req.query = Object.fromEntries(u.searchParams);
    try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = raw; }
    return h(req, res);
  }
  const rel = u.pathname === '/' ? '/index.html' : u.pathname;
  const file = join(root, 'public', rel);
  if (!file.startsWith(join(root, 'public')) || !existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(port, () => console.log(`FPRS running at http://localhost:${port}`));
