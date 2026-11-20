import { q } from './db.js';
import { ApiError } from './http.js';

export const ENTRY_SELECT = `
select e.id, e.created_at, e.staff, e.supervisor,
       e.base_plu, e.base_description, e.base_material, e.base_qty,
       e.total_cut_qty, e.difference, e.status, e.system_amount, e.calculated,
       e.material_doc_a, e.material_doc_b, e.weight_discrepancy_doc,
       e.keyed_in_by, e.keyed_in_at,
       coalesce((select json_agg(json_build_object(
                   'plu', c.plu, 'description', c.description, 'material', c.material, 'qty', c.qty
                 ) order by c.position)
                 from cc_entry_cuts c where c.entry_id = e.id), '[]'::json) as cuts
from cc_entries e`;

const ms = (v) => (v == null ? null : new Date(v).getTime());
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function mapEntry(r) {
  return {
    id: r.id,
    createdAt: ms(r.created_at),
    staff: r.staff,
    supervisor: r.supervisor,
    base: { plu: r.base_plu, description: r.base_description, material: r.base_material, qty: Number(r.base_qty) },
    cutParts: (r.cuts || []).map((c) => ({ plu: c.plu, description: c.description, material: c.material, qty: Number(c.qty) })),
    totalCutQty: Number(r.total_cut_qty),
    difference: Number(r.difference),
    status: r.status,
    systemAmount: r.system_amount == null ? null : Number(r.system_amount),
    calculated: r.calculated || null,
    materialDocA: r.material_doc_a,
    materialDocB: r.material_doc_b,
    weightDiscrepancyDoc: r.weight_discrepancy_doc,
    keyedInBy: r.keyed_in_by,
    keyedInAt: ms(r.keyed_in_at),
  };
}

export async function getEntry(id) {
  const rows = await q(`${ENTRY_SELECT} where e.id = $1`, [id]);
  return rows[0] ? mapEntry(rows[0]) : null;
}

/* ------------------------- validation helpers ------------------------- */

function cleanName(v, label) {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) throw new ApiError(400, `${label} is required.`);
  if (s.length > 60) throw new ApiError(400, `${label} is too long.`);
  return s;
}
function cleanText(v, max = 40) {
  return String(v ?? '').trim().toUpperCase().slice(0, max);
}
function cleanQty(v, label) {
  const n = round2(v);
  if (!Number.isFinite(n) || n <= 0) throw new ApiError(400, `${label} must be greater than 0.`);
  if (n > 99999) throw new ApiError(400, `${label} is too large.`);
  return n;
}

/** Merge duplicate PLUs and validate qty. Returns [{plu, qty}] */
function normaliseCuts(list) {
  if (!Array.isArray(list) || list.length === 0) throw new ApiError(400, 'Add at least one cut part.');
  if (list.length > 40) throw new ApiError(400, 'Too many cut parts.');
  const map = new Map();
  for (const c of list) {
    const plu = String(c?.plu ?? '').trim();
    if (!plu) throw new ApiError(400, 'Every cut part needs a PLU.');
    const qty = cleanQty(c.qty, `Quantity for PLU ${plu}`);
    map.set(plu, round2((map.get(plu) || 0) + qty));
  }
  return [...map].map(([plu, qty]) => ({ plu, qty }));
}

function totals(baseQty, cuts) {
  const totalCutQty = round2(cuts.reduce((s, c) => s + c.qty, 0));
  const difference = round2(baseQty - totalCutQty);
  if (difference < 0) {
    throw new ApiError(400, 'Negative weight difference. Total cut parts quantity cannot exceed the base product quantity.');
  }
  return { totalCutQty, difference };
}

const CUT_COLS = `(position int, plu text, description text, material text, qty numeric)`;

/* ------------------------------ create ------------------------------- */

export async function createEntry(input) {
  const id = String(input.id || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new ApiError(400, 'Invalid entry id.');
  const staff = cleanName(input.staff, 'Staff name');
  const supervisor = cleanName(input.supervisor, 'Supervisor name');
  const basePlu = String(input.basePlu || '').trim();
  const baseQty = cleanQty(input.baseQty, 'Base product quantity');
  const cuts = normaliseCuts(input.cutParts);
  const { totalCutQty, difference } = totals(baseQty, cuts);

  // Descriptions and material codes always come from the masterlist, never the client.
  const items = await q(`select type, plu, description, material from cc_items where active`);
  const base = items.find((i) => i.type === 'base' && i.plu === basePlu);
  if (!base) throw new ApiError(400, 'Base product PLU not found in the masterlist.');
  const cutRows = cuts.map((c, idx) => {
    const it = items.find((i) => i.type === 'cut' && i.plu === c.plu);
    if (!it) throw new ApiError(400, `Cut part PLU ${c.plu} not found in the masterlist.`);
    return { position: idx + 1, plu: it.plu, description: it.description, material: it.material, qty: c.qty };
  });

  // One statement = atomic. ON CONFLICT makes a double-submit harmless.
  await q(
    `with e as (
       insert into cc_entries (id, staff, supervisor, base_plu, base_description, base_material,
                               base_qty, total_cut_qty, difference)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (id) do nothing
       returning id
     )
     insert into cc_entry_cuts (entry_id, position, plu, description, material, qty)
     select e.id, c.position, c.plu, c.description, c.material, c.qty
     from e, jsonb_to_recordset($10::jsonb) as c ${CUT_COLS}`,
    [id, staff, supervisor, base.plu, base.description, base.material, baseQty, totalCutQty, difference, JSON.stringify(cutRows)]
  );
  return getEntry(id);
}

/* ------------------------------ update ------------------------------- */

/**
 * Corrections and/or final IT sign-off for a PENDING entry.
 * input: { baseQty, cutParts:[{plu, qty}], complete?: {...} }
 */
export async function updateEntry(id, input) {
  const existing = await getEntry(id);
  if (!existing) throw new ApiError(404, 'Entry not found.');
  if (existing.status === 'completed') throw new ApiError(409, 'This entry has already been processed and is locked.');

  const baseQty = cleanQty(input.baseQty ?? existing.base.qty, 'Base product quantity');
  const cuts = normaliseCuts(input.cutParts);
  const { totalCutQty, difference } = totals(baseQty, cuts);

  // Resolve descriptions: keep the entry's own snapshot, otherwise use the masterlist.
  const items = await q(`select plu, description, material from cc_items where type = 'cut' and active`);
  const cutRows = cuts.map((c, idx) => {
    const it = existing.cutParts.find((x) => x.plu === c.plu) || items.find((i) => i.plu === c.plu);
    if (!it) throw new ApiError(400, `Cut part PLU ${c.plu} not found in the masterlist.`);
    return { position: idx + 1, plu: c.plu, description: it.description, material: it.material, qty: c.qty };
  });

  let set = `base_qty = $2, total_cut_qty = $3, difference = $4, updated_at = now()`;
  const params = [id, baseQty, totalCutQty, difference];

  if (input.complete) {
    const k = input.complete;
    const matA = cleanText(k.materialDocA);
    const matB = cleanText(k.materialDocB);
    const wd = difference !== 0 ? cleanText(k.weightDiscrepancyDoc) : '';
    const by = cleanText(k.keyedInBy, 60);
    if (!matA || !matB) throw new ApiError(400, 'Both Material Document fields are required.');
    if (difference !== 0 && !wd) throw new ApiError(400, 'Weight discrepancy material document is required.');
    if (!by) throw new ApiError(400, 'Key in by is required.');
    if (!k.calculated || typeof k.calculated !== 'object') throw new ApiError(400, 'Run Calculate before submitting.');
    const sys = Number(k.systemAmount);
    if (!Number.isFinite(sys)) throw new ApiError(400, 'System amount is required.');
    params.push(matA, matB, wd, by, round2(sys), JSON.stringify(k.calculated));
    set += `, status = 'completed', keyed_in_at = now(),
             material_doc_a = $5, material_doc_b = $6, weight_discrepancy_doc = $7,
             keyed_in_by = $8, system_amount = $9, calculated = $10::jsonb`;
  }

  params.push(JSON.stringify(cutRows));
  const rows = await q(
    `with u as (
       update cc_entries set ${set} where id = $1 and status = 'pending' returning id
     ), d as (
       delete from cc_entry_cuts where entry_id in (select id from u) returning 1
     )
     insert into cc_entry_cuts (entry_id, position, plu, description, material, qty)
     select u.id, c.position, c.plu, c.description, c.material, c.qty
     from u, jsonb_to_recordset($${params.length}::jsonb) as c ${CUT_COLS}
     returning entry_id`,
    params
  );
  if (!rows.length) throw new ApiError(409, 'This entry was processed by someone else just now. Refresh the list.');
  return getEntry(id);
}

/* --------------------- admin: Records Adjustment --------------------- */
/**
 * Admin edit of ANY entry (pending or completed). input: { staff, supervisor, basePlu?, baseQty,
 * cutParts:[{plu, qty}], materialDocA/B, weightDiscrepancyDoc, keyedInBy, reopen? }
 * The stored valuation is cleared when quantities or the base product change (it would be stale).
 */
export async function adminUpdateEntry(id, input) {
  const existing = await getEntry(id);
  if (!existing) throw new ApiError(404, 'Entry not found.');

  const staff = cleanName(input.staff ?? existing.staff, 'Staff name');
  const supervisor = cleanName(input.supervisor ?? existing.supervisor, 'Supervisor name');
  const baseQty = cleanQty(input.baseQty ?? existing.base.qty, 'Base product quantity');
  const cuts = normaliseCuts(input.cutParts);
  const { totalCutQty, difference } = totals(baseQty, cuts);

  const items = await q(`select type, plu, description, material, active from cc_items`);
  const basePlu = String(input.basePlu ?? existing.base.plu).trim();
  const base = basePlu === existing.base.plu
    ? { plu: existing.base.plu, description: existing.base.description, material: existing.base.material }
    : items.find((i) => i.type === 'base' && i.plu === basePlu && i.active);
  if (!base) throw new ApiError(400, 'Base product PLU not found in the masterlist.');
  const cutRows = cuts.map((c, idx) => {
    const it = existing.cutParts.find((x) => x.plu === c.plu) || items.find((i) => i.type === 'cut' && i.plu === c.plu && i.active);
    if (!it) throw new ApiError(400, `Cut part PLU ${c.plu} not found in the masterlist.`);
    return { position: idx + 1, plu: c.plu, description: it.description, material: it.material, qty: c.qty };
  });

  const sameQty = baseQty === existing.base.qty && base.plu === existing.base.plu &&
    cutRows.length === existing.cutParts.length && cutRows.every((c, i) => c.plu === existing.cutParts[i].plu && c.qty === existing.cutParts[i].qty);

  const params = [id];
  const p = (v) => { params.push(v); return '$' + params.length; };
  const set = [
    `staff = ${p(staff)}`, `supervisor = ${p(supervisor)}`, `base_plu = ${p(base.plu)}`, `base_description = ${p(base.description)}`,
    `base_material = ${p(base.material)}`, `base_qty = ${p(baseQty)}`, `total_cut_qty = ${p(totalCutQty)}`, `difference = ${p(difference)}`, `updated_at = now()`,
  ];
  if (!sameQty || input.reopen) set.push('calculated = null');

  if (input.reopen) {
    set.push(`status = 'pending'`, `keyed_in_at = null`, `material_doc_a = ''`, `material_doc_b = ''`, `weight_discrepancy_doc = ''`,
      `keyed_in_by = ''`, `system_amount = null`);
  } else if (existing.status === 'completed') {
    const a = cleanText(input.materialDocA ?? existing.materialDocA), b = cleanText(input.materialDocB ?? existing.materialDocB);
    const by = cleanText(input.keyedInBy ?? existing.keyedInBy, 60);
    const wd = difference !== 0 ? cleanText(input.weightDiscrepancyDoc ?? existing.weightDiscrepancyDoc) : '';
    if (!a || !b) throw new ApiError(400, 'Both Material Document fields are required.');
    if (difference !== 0 && !wd) throw new ApiError(400, 'Weight discrepancy material document is required.');
    if (!by) throw new ApiError(400, 'Key in by is required.');
    set.push(`material_doc_a = ${p(a)}`, `material_doc_b = ${p(b)}`, `weight_discrepancy_doc = ${p(wd)}`, `keyed_in_by = ${p(by)}`);
  }

  const cutsParam = p(JSON.stringify(cutRows));
  await q(
    `with u as (
       update cc_entries set ${set.join(', ')} where id = $1 returning id
     ), d as (
       delete from cc_entry_cuts where entry_id in (select id from u) returning 1
     )
     insert into cc_entry_cuts (entry_id, position, plu, description, material, qty)
     select u.id, c.position, c.plu, c.description, c.material, c.qty
     from u, jsonb_to_recordset(${cutsParam}::jsonb) as c ${CUT_COLS}`,
    params
  );
  return getEntry(id);
}
