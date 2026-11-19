import { q } from '../lib/db.js';
import { route, requireAdmin, ApiError } from '../lib/http.js';

const mapItem = (r) => ({ type: r.type, plu: r.plu, description: r.description, material: r.material, cost: Number(r.cost), active: r.active });

export default route(['GET', 'POST', 'PATCH'], async ({ req, body }) => {
  if (req.method === 'GET') {
    // Costs are not secret; the app needs inactive items too (old entries may still reference them).
    const rows = await q(`select type, plu, description, material, cost, active from cc_items order by type, description, plu`);
    const items = rows.map(mapItem);
    return { items: { base: items.filter((i) => i.type === 'base'), cut: items.filter((i) => i.type === 'cut') } };
  }

  requireAdmin(req);
  const type = body.type;
  if (!['base', 'cut'].includes(type)) throw new ApiError(400, 'Type must be base or cut.');
  const plu = String(body.plu ?? '').trim();
  if (!plu) throw new ApiError(400, 'PLU is required.');

  if (req.method === 'POST') {
    const description = String(body.description ?? '').trim().toUpperCase();
    const material = String(body.material ?? '').trim();
    const cost = Number(body.cost);
    if (!description || !material || !Number.isFinite(cost) || cost <= 0) throw new ApiError(400, 'PLU, material, description and a cost above 0 are required.');
    const rows = await q(
      `insert into cc_items (type, plu, description, material, cost) values ($1,$2,$3,$4,$5)
       on conflict (type, plu) do nothing returning type, plu, description, material, cost, active`,
      [type, plu, description, material, cost]
    );
    if (!rows.length) throw new ApiError(409, `PLU ${plu} already exists in this list.`);
    return { item: mapItem(rows[0]) };
  }

  // PATCH: cost and/or active
  const sets = []; const params = [type, plu];
  if (body.cost !== undefined) {
    const cost = Number(body.cost);
    if (!Number.isFinite(cost) || cost < 0) throw new ApiError(400, 'Invalid cost.');
    params.push(cost); sets.push(`cost = $${params.length}`);
  }
  if (body.active !== undefined) { params.push(!!body.active); sets.push(`active = $${params.length}`); }
  if (!sets.length) throw new ApiError(400, 'Nothing to update.');
  const rows = await q(`update cc_items set ${sets.join(', ')} where type = $1 and plu = $2 returning type, plu, description, material, cost, active`, params);
  if (!rows.length) throw new ApiError(404, 'Item not found.');
  return { item: mapItem(rows[0]) };
});
