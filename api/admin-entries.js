import { q } from '../lib/db.js';
import { route, requireAdmin, ApiError } from '../lib/http.js';
import { adminUpdateEntry } from '../lib/entries.js';
import { adminUpdateFruit } from '../lib/fruit.js';

// Records Adjustment (Admin): edit or delete ANY entry, pending or completed.
//   PUT    /api/admin-entries?type=chicken|fruit&id=...   body = full edited entry
//   DELETE /api/admin-entries?type=chicken|fruit&id=...
export default route(['PUT', 'DELETE'], async ({ req, query, body }) => {
  requireAdmin(req);
  const id = String(query.id || '');
  const type = query.type;
  if (!id) throw new ApiError(400, 'Entry id is required.');
  if (!['chicken', 'fruit'].includes(type)) throw new ApiError(400, 'type must be chicken or fruit.');

  if (req.method === 'DELETE') {
    const rows = await q(`delete from ${type === 'chicken' ? 'cc_entries' : 'mf_entries'} where id = $1 returning id`, [id]);
    if (!rows.length) throw new ApiError(404, 'Entry not found.');
    return { deleted: id };
  }
  return { entry: type === 'chicken' ? await adminUpdateEntry(id, body) : await adminUpdateFruit(id, body) };
});
