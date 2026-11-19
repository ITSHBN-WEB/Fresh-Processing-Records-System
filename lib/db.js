import { neon } from '@neondatabase/serverless';
import { ApiError } from './http.js';

let sql = null;

/** Neon HTTP client (one per warm function instance). */
export function db() {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new ApiError(500, 'Server is not configured: DATABASE_URL is missing.');
    sql = neon(url);
  }
  return sql;
}

/** Test hook: inject any object with query(text, params) => Promise<rows[]>. */
export function __setDb(client) { sql = client; }

export const q = (text, params = []) => db().query(text, params);
