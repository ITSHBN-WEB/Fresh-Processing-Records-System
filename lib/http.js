import { timingSafeEqual } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Wraps a route: method allow-list, JSON body parsing, uniform
 * { ok, ... } responses and error handling.
 */
export function route(methods, fn, { cors = false } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    }
    if (req.method === 'OPTIONS' && cors) { res.statusCode = 204; return res.end(); }
    try {
      if (!methods.includes(req.method)) throw new ApiError(405, 'Method not allowed.');
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new ApiError(400, 'Invalid JSON body.'); } }
      const query = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      const out = await fn({ req, query, body: body || {} });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, ...out }));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if (status === 500) console.error(err);
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: status === 500 ? 'Server error. Please try again.' : err.message }));
    }
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkAdminPassword(pw) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new ApiError(500, 'Server is not configured: ADMIN_PASSWORD is missing.');
  return typeof pw === 'string' && safeEqual(pw, expected);
}

export function requireAdmin(req) {
  if (!checkAdminPassword(req.headers['x-admin-password'])) throw new ApiError(401, 'Admin password required.');
}
