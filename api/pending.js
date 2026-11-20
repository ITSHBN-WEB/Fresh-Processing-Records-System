import { q } from '../lib/db.js';
import { route } from '../lib/http.js';

// Public, read-only counts for the SHBN Control Tower notice (CORS enabled).
// pendingCount keeps the old Apps Script meaning (Chicken Cut Parts), so the existing
// Control Tower card only needs its URL changed. fruitPendingCount is the Mixed Fruit BB count.
export default route(['GET', 'OPTIONS'], async () => {
  const [r] = await q(`select (select count(*) from cc_entries where status = 'pending')::int as chicken,
                              (select count(*) from mf_entries where status = 'pending')::int as fruit`);
  return { pendingCount: r.chicken, fruitPendingCount: r.fruit, totalPendingCount: r.chicken + r.fruit };
}, { cors: true });
