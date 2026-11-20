import { q } from '../lib/db.js';
import { route, requireAdmin, ApiError } from '../lib/http.js';

const map = (r) => ({ plu: r.plu, material: r.material, description: r.description, uom: r.uom, category: r.category, role: r.role, active: r.active });
const COLS = 'plu, material, description, uom, category, role, active';

export default route(['GET', 'POST', 'PATCH'], async ({ req, body }) => {
  if (req.method === 'GET') {
    const rows = await q(`select ${COLS} from mf_items order by role desc, description, plu`);
    return { items: rows.map(map) };
  }
  requireAdmin(req);
  const plu = String(body.plu ?? '').trim();
  if (!plu) throw new ApiError(400, 'PLU is required.');

  if (req.method === 'POST') {
    const material = String(body.material ?? '').trim();
    const description = String(body.description ?? '').trim().toUpperCase();
    const uom = String(body.uom ?? '').toUpperCase();
    const role = body.role === 'output' ? 'output' : 'input';
    if (!material || !description || !['EA', 'KG'].includes(uom)) throw new ApiError(400, 'PLU, material, description and unit (EA or KG) are required.');
    const rows = await q(
      `insert into mf_items (plu, material, description, uom, role) values ($1,$2,$3,$4,$5) on conflict (plu) do nothing returning ${COLS}`,
      [plu, material, description, uom, role]);
    if (!rows.length) throw new ApiError(409, `PLU ${plu} already exists.`);
    return { item: map(rows[0]) };
  }

  const sets = []; const params = [plu];
  const add = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (body.active !== undefined) add('active', !!body.active);
  if (body.description !== undefined) { const d = String(body.description).trim().toUpperCase(); if (!d) throw new ApiError(400, 'Description cannot be empty.'); add('description', d); }
  if (body.material !== undefined) { const m = String(body.material).trim(); if (!m) throw new ApiError(400, 'Material cannot be empty.'); add('material', m); }
  if (!sets.length) throw new ApiError(400, 'Nothing to update.');
  const rows = await q(`update mf_items set ${sets.join(', ')} where plu = $1 returning ${COLS}`, params);
  if (!rows.length) throw new ApiError(404, 'Item not found.');
  return { item: map(rows[0]) };
});
