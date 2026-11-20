import { q } from '../lib/db.js';
import { route } from '../lib/http.js';
import { ENTRY_SELECT, mapEntry } from '../lib/entries.js';
import { FRUIT_SELECT, mapFruit } from '../lib/fruit.js';

const LOCAL = `(now() at time zone 'Asia/Kuala_Lumpur')`;
const START = (unit) => `(date_trunc('${unit}', ${LOCAL}) at time zone 'Asia/Kuala_Lumpur')`;

export default route(['GET'], async () => {
  const [s] = await q(`
    select
      count(*) filter (where status = 'pending')                            as pending,
      min(created_at) filter (where status = 'pending')                      as oldest_pending,
      count(*) filter (where created_at >= ${START('day')})                  as today,
      count(*) filter (where created_at >= ${START('month')})                as month_entries,
      coalesce(sum(base_qty)      filter (where created_at >= ${START('month')}), 0) as month_base_kg,
      coalesce(sum(total_cut_qty) filter (where created_at >= ${START('month')}), 0) as month_cut_kg
    from cc_entries`);
  const recent = await q(`${ENTRY_SELECT} order by e.created_at desc limit 6`);
  const [f] = await q(`
    select
      count(*) filter (where status = 'pending')                            as pending,
      min(created_at) filter (where status = 'pending')                      as oldest_pending,
      count(*) filter (where created_at >= ${START('day')})                  as today,
      count(*) filter (where created_at >= ${START('month')})                as month_entries,
      coalesce(sum(output_qty) filter (where created_at >= ${START('month')}), 0) as month_bb_qty
    from mf_entries`);
  const fRecent = await q(`${FRUIT_SELECT} order by e.created_at desc limit 6`);
  const base = Number(s.month_base_kg); const cut = Number(s.month_cut_kg);
  return {
    chicken: {
      pending: Number(s.pending),
      oldestPendingAt: s.oldest_pending ? new Date(s.oldest_pending).getTime() : null,
      today: Number(s.today),
      monthEntries: Number(s.month_entries),
      monthBaseKg: base,
      monthCutKg: cut,
      monthYieldPct: base > 0 ? Math.round((cut / base) * 1000) / 10 : null,
      recent: recent.map(mapEntry),
    },
    fruit: {
      pending: Number(f.pending),
      oldestPendingAt: f.oldest_pending ? new Date(f.oldest_pending).getTime() : null,
      today: Number(f.today),
      monthEntries: Number(f.month_entries),
      monthBbQty: Number(f.month_bb_qty),
      recent: fRecent.map(mapFruit),
    },
  };
});
