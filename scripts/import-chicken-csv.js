/**
 * Import the legacy "SHBN - Chicken Processing Log" CSV into Neon.
 *
 *   DATABASE_URL="postgres://..." node scripts/import-chicken-csv.js path/to/log.csv
 *   node scripts/import-chicken-csv.js path/to/log.csv --dry-run     (no database needed)
 *
 * - Safe to re-run: entries that already exist (same Entry ID) are skipped.
 * - Dates are read as Malaysia time (UTC+8).
 * - Totals are recalculated from the quantities; mismatches vs the CSV are reported.
 * - Imported entries have no valuation (the old sheet never stored it).
 */
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';


/* ---- minimal RFC4180 CSV parser ---- */
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

/** "1.10.2026 2.04PM" (d.M.yyyy h.mmAM) in Malaysia time -> ISO string */
export function parseLegacyDate(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2})\.(\d{2})\s*(AM|PM)$/i.exec(String(s || '').trim());
  if (!m) return null;
  let h = Number(m[4]) % 12; if (m[6].toUpperCase() === 'PM') h += 12;
  const p = (n) => String(n).padStart(2, '0');
  return `${m[3]}-${p(m[2])}-${p(m[1])}T${p(h)}:${m[5]}:00+08:00`;
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function groupEntries(rows) {
  const header = rows[0];
  const col = (name) => header.indexOf(name);
  const C = {
    date: col('Date'), staff: col('Staff'), sup: col('Supervisor'),
    bMat: col('Base Product Material'), bPlu: col('Base Product PLU Code'), bDesc: col('Base Product Description'), bQty: col('Base Product Quantity'),
    cMat: col('Cut Part Material'), cPlu: col('Cut Part PLU Code'), cDesc: col('Cut Part Description'), cQty: col('Cut Part Quantity'),
    diff: col('Difference Quantity'), docA: col('Material Document A'), docB: col('Material Document B'), wd: col('Weight Discrepancy Document'),
    by: col('Key By'), keyDate: col('Date Key In'), id: col('Entry ID'),
  };
  if (Object.values(C).some((i) => i < 0)) throw new Error('CSV header does not match the expected columns.');

  const map = new Map(); const warnings = [];
  for (const r of rows.slice(1)) {
    const id = r[C.id];
    if (!id) { warnings.push(`Row without Entry ID skipped: ${r.slice(0, 4).join(' | ')}`); continue; }
    if (!map.has(id)) map.set(id, { id, cuts: [], csvTotal: null, csvDiff: null });
    const e = map.get(id);
    if (r[C.date]) {
      e.dateStr = r[C.date]; e.staff = r[C.staff].trim().toUpperCase(); e.supervisor = r[C.sup].trim().toUpperCase();
      e.base = { material: r[C.bMat], plu: r[C.bPlu], description: r[C.bDesc], qty: Number(r[C.bQty]) };
    }
    if (r[C.cPlu]) e.cuts.push({ material: r[C.cMat], plu: r[C.cPlu], description: r[C.cDesc], qty: Number(r[C.cQty]) });
    if (r[C.bDesc] === 'Total Weight Cut Part:') {
      e.csvTotal = Number(r[C.cQty]); e.csvDiff = r[C.diff] === '' ? 0 : Number(r[C.diff]);
      e.docA = r[C.docA]; e.docB = r[C.docB]; e.wd = r[C.wd]; e.by = r[C.by].trim().toUpperCase(); e.keyDateStr = r[C.keyDate];
    }
  }

  const entries = [];
  for (const e of map.values()) {
    if (!e.base || !e.cuts.length) { warnings.push(`${e.id}: missing base or cut rows - skipped`); continue; }
    const idMs = Number((/^e_(\d{10,})_/.exec(e.id) || [])[1]);
    const createdAt = idMs ? new Date(idMs).toISOString() : parseLegacyDate(e.dateStr);
    if (!createdAt) { warnings.push(`${e.id}: unreadable date "${e.dateStr}" - skipped`); continue; }
    const totalCut = round2(e.cuts.reduce((s, c) => s + c.qty, 0));
    const diff = round2(e.base.qty - totalCut);
    if (e.csvTotal !== null && Math.abs(e.csvTotal - totalCut) > 0.001) warnings.push(`${e.id} (${e.dateStr}): CSV total ${e.csvTotal} != recalculated ${totalCut}`);
    if (e.csvDiff !== null && Math.abs(e.csvDiff - diff) > 0.001) warnings.push(`${e.id} (${e.dateStr}): CSV difference ${e.csvDiff} != recalculated ${diff}`);
    if (diff < 0) warnings.push(`${e.id} (${e.dateStr}): negative difference ${diff}`);
    const done = !!(e.docA || e.by);
    entries.push({
      id: e.id, createdAt, staff: e.staff, supervisor: e.supervisor, base: e.base, cuts: e.cuts,
      totalCut, diff, status: done ? 'completed' : 'pending',
      docA: e.docA || '', docB: e.docB || '', wd: e.wd || '', by: e.by || '',
      keyedAt: done ? parseLegacyDate(e.keyDateStr) : null,
    });
  }
  entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { entries, warnings };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  if (!file) { console.error('Usage: node scripts/import-chicken-csv.js <file.csv> [--dry-run]'); process.exit(1); }
  const { entries, warnings } = groupEntries(parseCsv(readFileSync(file, 'utf8')));
  console.log(`Parsed ${entries.length} entries (${entries.reduce((s, e) => s + e.cuts.length, 0)} cut lines).`);
  console.log(`  completed: ${entries.filter((e) => e.status === 'completed').length}, pending: ${entries.filter((e) => e.status === 'pending').length}`);
  if (entries.length) console.log(`  range: ${entries[0].createdAt} -> ${entries[entries.length - 1].createdAt}`);
  if (warnings.length) { console.log('\nWarnings:'); warnings.forEach((w) => console.log('  - ' + w)); }
  if (dryRun) { console.log('\nDry run - nothing written.'); return; }

  if (!process.env.DATABASE_URL) { console.error('\nDATABASE_URL is not set.'); process.exit(1); }
  const sql = neon(process.env.DATABASE_URL);
  let inserted = 0; let skipped = 0;
  for (const e of entries) {
    const cuts = e.cuts.map((c, i) => ({ position: i + 1, ...c }));
    const rows = await sql.query(
      `with e as (
         insert into cc_entries (id, created_at, staff, supervisor, base_plu, base_description, base_material, base_qty,
                                 total_cut_qty, difference, status, material_doc_a, material_doc_b, weight_discrepancy_doc,
                                 keyed_in_by, keyed_in_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         on conflict (id) do nothing returning id
       )
       insert into cc_entry_cuts (entry_id, position, plu, description, material, qty)
       select e.id, c.position, c.plu, c.description, c.material, c.qty
       from e, jsonb_to_recordset($17::jsonb) as c (position int, plu text, description text, material text, qty numeric)
       returning entry_id`,
      [e.id, e.createdAt, e.staff, e.supervisor, e.base.plu, e.base.description, e.base.material, e.base.qty,
       e.totalCut, e.diff, e.status, e.docA, e.docB, e.wd, e.by, e.keyedAt, JSON.stringify(cuts)]
    );
    rows.length ? inserted++ : skipped++;
  }
  console.log(`\nDone. Inserted ${inserted} entries, skipped ${skipped} that already existed.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
