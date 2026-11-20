import { q } from './db.js';
import { ApiError } from './http.js';

/** Scanned label 28 + 5-digit PLU + 11 digits (e.g. 285010600000000000) -> 50106. Anything else is unchanged. */
export function normalizePlu(raw) {
  const s = String(raw ?? '').trim();
  const m = /^28(\d{5})\d{11}$/.exec(s);
  return m ? m[1] : s;
}

export const FRUIT_SELECT = `
select e.id, e.created_at, e.recorded_by, e.supervisor,
       e.output_plu, e.output_description, e.output_material, e.output_uom, e.output_qty,
       e.status, e.material_doc_a, e.material_doc_b, e.keyed_in_by, e.keyed_in_at,
       coalesce((select json_agg(json_build_object(
                   'plu', i.plu, 'description', i.description, 'material', i.material, 'uom', i.uom, 'qty', i.qty
                 ) order by i.position)
                 from mf_entry_items i where i.entry_id = e.id), '[]'::json) as items
from mf_entries e`;

const ms = (v) => (v == null ? null : new Date(v).getTime());
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function mapFruit(r) {
  return {
    id: r.id,
    createdAt: ms(r.created_at),
    recordedBy: r.recorded_by,
    supervisor: r.supervisor,
    items: (r.items || []).map((i) => ({ plu: i.plu, description: i.description, material: i.material, uom: i.uom, qty: Number(i.qty) })),
    output: { plu: r.output_plu, description: r.output_description, material: r.output_material, uom: r.output_uom, qty: Number(r.output_qty) },
    status: r.status,
    materialDocA: r.material_doc_a,
    materialDocB: r.material_doc_b,
    keyedInBy: r.keyed_in_by,
    keyedInAt: ms(r.keyed_in_at),
  };
}

export async function getFruit(id) {
  const rows = await q(`${FRUIT_SELECT} where e.id = $1`, [id]);
  return rows[0] ? mapFruit(rows[0]) : null;
}

/* ------------------------- validation helpers ------------------------- */
function cleanName(v, label) {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) throw new ApiError(400, `${label} is required.`);
  if (s.length > 60) throw new ApiError(400, `${label} is too long.`);
  return s;
}
const cleanText = (v, max = 40) => String(v ?? '').trim().toUpperCase().slice(0, max);

function cleanQty(v, label, uom) {
  const n = round2(v);
  if (!Number.isFinite(n) || n <= 0) throw new ApiError(400, `${label} must be greater than 0.`);
  if (n > 99999) throw new ApiError(400, `${label} is too large.`);
  if (uom === 'EA' && !Number.isInteger(n)) throw new ApiError(400, `${label} must be a whole number (unit EA).`);
  return n;
}

/** merge duplicate PLUs (summing), keeping first-seen order */
function mergeItems(list) {
  if (!Array.isArray(list) || list.length === 0) throw new ApiError(400, 'Add at least one item.');
  if (list.length > 300) throw new ApiError(400, 'Too many items.');
  const map = new Map();
  for (const it of list) {
    const plu = normalizePlu(it?.plu);
    if (!plu) throw new ApiError(400, 'Every item needs a PLU code.');
    const qty = Number(it.qty);
    if (!Number.isFinite(qty)) throw new ApiError(400, `Invalid quantity for PLU ${plu}.`);
    map.set(plu, round2((map.get(plu) || 0) + qty));
  }
  return [...map].map(([plu, qty]) => ({ plu, qty }));
}

async function resolve(input, existing) {
  const master = await q(`select plu, material, description, uom, role, active from mf_items`);
  const merged = mergeItems(input.items);
  const items = merged.map((m, idx) => {
    const snap = existing?.items.find((x) => x.plu === m.plu);
    const it = snap || master.find((x) => x.plu === m.plu && x.role === 'input' && x.active);
    if (!it) throw new ApiError(400, `PLU ${m.plu} is not in the Mixed Fruit masterlist.`);
    return { position: idx + 1, plu: m.plu, description: it.description, material: it.material, uom: it.uom, qty: cleanQty(m.qty, `Quantity for PLU ${m.plu}`, it.uom) };
  });

  const outPlu = normalizePlu(input.outputPlu ?? existing?.output.plu);
  const outMaster = master.find((x) => x.plu === outPlu && x.role === 'output' && x.active);
  const outSnap = existing && existing.output.plu === outPlu ? existing.output : null;
  const out = outMaster || outSnap;
  if (!out) throw new ApiError(400, 'Select a Mixed Fruit BB product.');
  const outQty = cleanQty(input.outputQty ?? existing?.output.qty, 'Mixed Fruit BB quantity', out.uom);
  return { items, output: { plu: outPlu, description: out.description, material: out.material, uom: out.uom, qty: outQty } };
}

/* ------------------------------ create ------------------------------- */
export async function createFruit(input) {
  const id = String(input.id || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new ApiError(400, 'Invalid entry id.');
  const recordedBy = cleanName(input.recordedBy, 'Record by');
  const supervisor = cleanName(input.supervisor, 'Supervisor');
  const { items, output } = await resolve(input, null);

  await q(
    `with e as (
       insert into mf_entries (id, recorded_by, supervisor, output_plu, output_description, output_material, output_uom, output_qty)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do nothing returning id
     )
     insert into mf_entry_items (entry_id, position, plu, description, material, uom, qty)
     select e.id, c.position, c.plu, c.description, c.material, c.uom, c.qty
     from e, jsonb_to_recordset($9::jsonb) as c (position int, plu text, description text, material text, uom text, qty numeric)`,
    [id, recordedBy, supervisor, output.plu, output.description, output.material, output.uom, output.qty, JSON.stringify(items)]
  );
  return getFruit(id);
}

/* ------------------- update (IT processing and admin) ------------------- */
/**
 * admin=false: IT processing of a PENDING entry (corrections and/or sign-off via input.complete)
 * admin=true : Records Adjustment - any status; docs editable; input.reopen sets it back to pending
 */
async function saveFruit(id, input, admin) {
  const existing = await getFruit(id);
  if (!existing) throw new ApiError(404, 'Entry not found.');
  if (!admin && existing.status === 'completed') throw new ApiError(409, 'This entry has already been processed and is locked.');

  const { items, output } = await resolve(input, existing);
  const params = [id];
  const p = (v) => { params.push(v); return '$' + params.length; };
  const set = [
    `output_plu = ${p(output.plu)}`, `output_description = ${p(output.description)}`, `output_material = ${p(output.material)}`,
    `output_uom = ${p(output.uom)}`, `output_qty = ${p(output.qty)}`, `updated_at = now()`,
  ];
  if (admin) {
    set.push(`recorded_by = ${p(cleanName(input.recordedBy ?? existing.recordedBy, 'Record by'))}`);
    set.push(`supervisor = ${p(cleanName(input.supervisor ?? existing.supervisor, 'Supervisor'))}`);
  }

  const docs = (src, label = true) => {
    const a = cleanText(src.materialDocA), b = cleanText(src.materialDocB), by = cleanText(src.keyedInBy, 60);
    if (!a || !b) throw new ApiError(400, 'Both Material Document fields are required.');
    if (!by) throw new ApiError(400, 'Key in by is required.');
    return { a, b, by };
  };
  if (!admin && input.complete) {
    const d = docs(input.complete);
    set.push(`status = 'completed'`, `keyed_in_at = now()`, `material_doc_a = ${p(d.a)}`, `material_doc_b = ${p(d.b)}`, `keyed_in_by = ${p(d.by)}`);
  } else if (admin && input.reopen) {
    set.push(`status = 'pending'`, `keyed_in_at = null`, `material_doc_a = ''`, `material_doc_b = ''`, `keyed_in_by = ''`);
  } else if (admin && existing.status === 'completed') {
    const d = docs({ materialDocA: input.materialDocA ?? existing.materialDocA, materialDocB: input.materialDocB ?? existing.materialDocB, keyedInBy: input.keyedInBy ?? existing.keyedInBy });
    set.push(`material_doc_a = ${p(d.a)}`, `material_doc_b = ${p(d.b)}`, `keyed_in_by = ${p(d.by)}`);
  }

  const itemsParam = p(JSON.stringify(items));
  const rows = await q(
    `with u as (
       update mf_entries set ${set.join(', ')} where id = $1 ${admin ? '' : `and status = 'pending'`} returning id
     ), d as (
       delete from mf_entry_items where entry_id in (select id from u) returning 1
     )
     insert into mf_entry_items (entry_id, position, plu, description, material, uom, qty)
     select u.id, c.position, c.plu, c.description, c.material, c.uom, c.qty
     from u, jsonb_to_recordset(${itemsParam}::jsonb) as c (position int, plu text, description text, material text, uom text, qty numeric)
     returning entry_id`,
    params
  );
  if (!rows.length) throw new ApiError(409, 'This entry was processed by someone else just now. Refresh the list.');
  return getFruit(id);
}
export const updateFruit = (id, input) => saveFruit(id, input, false);
export const adminUpdateFruit = (id, input) => saveFruit(id, input, true);
