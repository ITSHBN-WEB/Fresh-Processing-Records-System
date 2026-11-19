import { q } from '../lib/db.js';
import { route } from '../lib/http.js';

// Public, read-only count for the SHBN Control Tower notice (CORS enabled).
// Same response shape as the old Apps Script endpoint: { ok, pendingCount }
export default route(['GET', 'OPTIONS'], async () => {
  const [r] = await q(`select count(*)::int as n from cc_entries where status = 'pending'`);
  return { pendingCount: r.n };
}, { cors: true });
