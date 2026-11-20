/**
 * Import the Mixed Fruit BB masterlist CSV into Neon.
 *
 *   node scripts/import-fruit-masterlist.js "Mixed Fruit BB masterlist.csv" --dry-run
 *   npm run import:fruit -- "Mixed Fruit BB masterlist.csv"
 *
 * Expected columns: plu_code, material, description, uom, category
 *
 * - Safe to re-run: PLUs that already exist are skipped.
 * - Exact duplicate rows (same PLU and material) are collapsed.
 * - Rows whose PLU was damaged by Excel (scientific notation such as 9.555E+12) CANNOT be imported
 *   correctly - the real barcode digits are lost. They are written to "<file>.needs-fix.csv" so the
 *   correct PLU can be filled in and re-imported (or added in Admin > Master Data).
 * - BB FRUITS items become role "output" (the Mixed Fruit BB product); everything else is role "input".
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { parseCsv } from './import-chicken-csv.js';

export function readMasterlist(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const idx = (n) => h.indexOf(n);
  const C = { plu: idx('plu_code'), mat: idx('material'), desc: idx('description'), uom: idx('uom'), cat: idx('category') };
  if (Object.values(C).some((i) => i < 0)) throw new Error('CSV header must contain plu_code, material, description, uom, category.');

  const good = new Map(); const damaged = []; const warnings = [];
  rows.slice(1).forEach((r, n) => {
    const plu = (r[C.plu] || '').trim(); const material = (r[C.mat] || '').trim();
    const description = (r[C.desc] || '').trim().toUpperCase(); const uom = (r[C.uom] || '').trim().toUpperCase();
    const category = (r[C.cat] || '').trim() || 'Fruit';
    const line = n + 2;
    if (!plu || !material || !description) { warnings.push(`Line ${line}: missing PLU, material or description - skipped`); return; }
    if (!['EA', 'KG'].includes(uom)) { warnings.push(`Line ${line}: unit "${uom}" is not EA or KG - skipped (${description})`); return; }
    if (/e\+/i.test(plu) || !/^\d+$/.test(plu)) { damaged.push({ plu, material, description, uom, category }); return; }
    if (good.has(plu)) {
      const g = good.get(plu);
      if (g.material !== material) warnings.push(`Line ${line}: PLU ${plu} already used by material ${g.material} - skipped`);
      return;
    }
    good.set(plu, { plu, material, description, uom, category, role: /^BB FRUITS\b/.test(description) ? 'output' : 'input' });
  });
  return { items: [...good.values()], damaged, warnings };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  if (!file) { console.error('Usage: node scripts/import-fruit-masterlist.js <file.csv> [--dry-run]'); process.exit(1); }

  const { items, damaged, warnings } = readMasterlist(readFileSync(file, 'utf8'));
  console.log(`Usable items: ${items.length} (${items.filter((i) => i.role === 'output').length} output, ${items.filter((i) => i.uom === 'KG').length} KG, ${items.filter((i) => i.uom === 'EA').length} EA)`);
  if (warnings.length) { console.log('\nWarnings:'); warnings.forEach((w) => console.log('  - ' + w)); }
  if (damaged.length) {
    const out = file.replace(/\.csv$/i, '') + '.needs-fix.csv';
    const q = (v) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
    writeFileSync(out, 'plu_code,material,description,uom,category,damaged_plu_in_original\n' +
      damaged.map((d) => ['', d.material, d.description, d.uom, d.category, d.plu].map(q).join(',')).join('\n') + '\n');
    console.log(`\n${damaged.length} rows have a damaged PLU (scientific notation) and were NOT imported.`);
    console.log(`They are listed in: ${out}\nFill in plu_code (format the column as Text in Excel) and import that file.`);
  }
  if (dryRun) { console.log('\nDry run - nothing written.'); return; }

  if (!process.env.DATABASE_URL) { console.error('\nDATABASE_URL is not set.'); process.exit(1); }
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql.query(
    `insert into mf_items (plu, material, description, uom, category, role)
     select plu, material, description, uom, category, role
     from jsonb_to_recordset($1::jsonb) as t (plu text, material text, description text, uom text, category text, role text)
     on conflict (plu) do nothing returning plu`, [JSON.stringify(items)]);
  console.log(`\nDone. Inserted ${rows.length} items, skipped ${items.length - rows.length} that already existed.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
