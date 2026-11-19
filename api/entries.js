import { q } from '../lib/db.js';
import { route, ApiError } from '../lib/http.js';
import { ENTRY_SELECT, mapEntry, getEntry, createEntry, updateEntry } from '../lib/entries.js';

const TZ_OFFSET = '+08:00'; // Malaysia

export default route(['GET', 'POST', 'PATCH'], async ({ req, query, body }) => {
  if (req.method === 'POST') return { entry: await createEntry(body) };

  if (req.method === 'PATCH') {
    if (!query.id) throw new ApiError(400, 'Entry id is required.');
    return { entry: await updateEntry(String(query.id), body) };
  }

  if (query.id) {
    const entry = await getEntry(String(query.id));
    if (!entry) throw new ApiError(404, 'Entry not found.');
    return { entry };
  }

  const where = []; const params = [];
  if (query.status === 'pending' || query.status === 'completed') { params.push(query.status); where.push(`e.status = $${params.length}`); }
  if (query.month) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(query.month));
    if (!m) throw new ApiError(400, 'month must be YYYY-MM.');
    const y = Number(m[1]); const mo = Number(m[2]);
    if (mo < 1 || mo > 12) throw new ApiError(400, 'month must be YYYY-MM.');
    const ny = mo === 12 ? y + 1 : y; const nm = mo === 12 ? 1 : mo + 1;
    const pad = (n) => String(n).padStart(2, '0');
    params.push(`${y}-${pad(mo)}-01T00:00:00${TZ_OFFSET}`); where.push(`e.created_at >= $${params.length}::timestamptz`);
    params.push(`${ny}-${pad(nm)}-01T00:00:00${TZ_OFFSET}`); where.push(`e.created_at < $${params.length}::timestamptz`);
  }
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 500, 1), 2000);
  const rows = await q(`${ENTRY_SELECT} ${where.length ? 'where ' + where.join(' and ') : ''} order by e.created_at desc limit ${limit}`, params);
  return { entries: rows.map(mapEntry) };
});
